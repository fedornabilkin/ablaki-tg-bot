#!/usr/bin/env bash
set -euo pipefail
umask 077
die() { echo "ERROR: $*" >&2; exit 1; }
[[ $# -eq 3 ]] || die 'Expected commit SHA, check|deploy, registry user.'
sha=$1; operation=$2; registry_user=$3
[[ "$sha" =~ ^[a-f0-9]{40}$ && "$registry_user" =~ ^[A-Za-z0-9_-]+(\[bot\])?$ ]] || die 'Invalid deployment arguments.'
[[ "$operation" == check || "$operation" == deploy ]] || die 'Invalid operation.'
root=/opt/ablaki-tg-bot
[[ $(id -un) == deploy && $(id -u) != 0 ]] || die 'SSH must use deploy, not root.'
[[ $(realpath "$root") == "$root" && -w "$root/releases" ]] || die 'Wrong deployment path or directory permissions.'
[[ -f "$root/.env" && ! -L "$root/.env" && $(stat -c %a "$root/.env") == 600 && $(stat -c %u "$root/.env") == "$(id -u)" ]] || die '.env must be a regular file owned by deploy with mode 600.'
[[ $(uname -m) == x86_64 ]] || die 'The published image requires an x86_64 server.'
docker info >/dev/null || die 'Docker permission denied: check group membership in a fresh SSH session.'
version=$(docker compose version --short)
[[ $(printf '%s\n' 2.30.0 "${version#v}" | sort -V | head -n1) == 2.30.0 ]] || die 'Docker Compose >= 2.30.0 is required.'
exec 9>"$root/.deploy.lock"
flock -w 180 9 || die 'Another check/deployment is running.'
release="$root/releases/$sha"
[[ $(realpath "$release") == "$release" && -f "$release/compose.deploy.yaml" ]] || die 'Release files are missing or resolve elsewhere.'
export DOCKER_CONFIG
DOCKER_CONFIG=$(mktemp -d "$root/.registry.XXXXXX")
cleanup() { rm -f -- "$DOCKER_CONFIG/config.json"; rmdir -- "$DOCKER_CONFIG"; }
trap cleanup EXIT
IFS= read -r registry_token || die 'Registry token was not provided on stdin.'
printf '%s' "$registry_token" | docker login ghcr.io --username "$registry_user" --password-stdin >/dev/null
unset registry_token
export IMAGE_TAG=$sha
compose=(docker compose --env-file /dev/null -f "$release/compose.deploy.yaml")
"${compose[@]}" config --quiet
"${compose[@]}" pull
image="ghcr.io/fedornabilkin/ablaki-tg-bot:$sha"
volume=ablakin-telegram-bot_bot-data
docker volume create "$volume" >/dev/null
# Initialize only the mounted volume root; never recursively chmod host paths or discard state.
docker run --rm --network none --read-only --user 0:0 --cap-drop ALL --cap-add CHOWN --cap-add FOWNER \
  --security-opt no-new-privileges:true -v "$volume:/data" --entrypoint sh "$image" \
  -c 'chown 1000:1000 /data && chmod 700 /data'
"${compose[@]}" run --rm --no-deps -T telegram-bot node dist/preflight.js
if [[ "$operation" == check ]]; then
  echo 'READY: SSH, GHCR, Docker, Compose, env, container UID, volume, Telegram and API checked. The bot was not started.'
  echo 'Stop any local bot using the same token before deployment. Remote checks cannot detect every other poller.'
  exit 0
fi

previous=''
if [[ -f "$root/.current" ]]; then
  previous=$(cat "$root/.current")
  [[ "$previous" =~ ^[a-f0-9]{40}$ && -f "$root/releases/$previous/compose.deploy.yaml" ]] || die 'Invalid previous release marker.'
fi
# Capture an existing deployment made by the older script before replacing it.
if [[ -z "$previous" && -f "$root/docker/compose.deploy.yaml" ]]; then
  old_container=$("${compose[@]}" ps -a -q telegram-bot)
  if [[ -n "$old_container" ]]; then
    old_image=$(docker inspect --format '{{.Config.Image}}' "$old_container")
    previous=${old_image##*:}
    [[ "$old_image" == "ghcr.io/fedornabilkin/ablaki-tg-bot:$previous" && "$previous" =~ ^[a-f0-9]{40}$ ]] || die 'Existing container is not pinned to a commit; record its image before the first upgrade.'
    mkdir -p "$root/releases/$previous"
    # Use the new stable env/volume contract with the existing image for rollback.
    if [[ ! -f "$root/releases/$previous/compose.deploy.yaml" ]]; then cp "$release/compose.deploy.yaml" "$root/releases/$previous/compose.deploy.yaml"; fi
  fi
fi

# Explicit stop avoids briefly polling the same Telegram token in two containers.
"${compose[@]}" stop -t 45 telegram-bot
if ! "${compose[@]}" up -d --no-build --remove-orphans --wait --wait-timeout 150; then
  echo 'New container did not become healthy. Stopping it.' >&2
  "${compose[@]}" stop -t 45 telegram-bot || true
  if [[ -n "$previous" ]]; then
    IMAGE_TAG=$previous docker compose --env-file /dev/null -f "$root/releases/$previous/compose.deploy.yaml" up -d --no-build --wait --wait-timeout 150 \
      || die 'ROLLBACK FAILED. Inspect the previous container and API; data volume was preserved.'
    echo "Previous release restored: $previous" >&2
  else
    echo 'First deployment failed; no previous release exists. Data volume was preserved.' >&2
  fi
  exit 1
fi
printf '%s\n' "$sha" > "$root/.current.tmp"
mv -f "$root/.current.tmp" "$root/.current"
echo "DEPLOYED AND HEALTHY: $sha"
