#!/usr/bin/env bash
# Validated values intentionally expand locally into the remote command.
# shellcheck disable=SC2029
set -euo pipefail
readonly deploy_root=/opt/ablaki-tg-bot

# All credentials are injected by Actions; application secrets remain on the VPS.
for name in BOT_HOST BOT_PORT BOT_USER BOT_SSH_KEY BOT_KNOWN_HOSTS GITHUB_ACTOR GHCR_TOKEN IMAGE_TAG DEPLOY_OPERATION; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing deployment setting: $name" >&2
    exit 1
  fi
done
[[ "$BOT_HOST" =~ ^[A-Za-z0-9][A-Za-z0-9.:-]*$ ]]
[[ "$BOT_PORT" =~ ^[0-9]{1,5}$ ]]
(( 10#$BOT_PORT >= 1 && 10#$BOT_PORT <= 65535 ))
[[ "$BOT_USER" == deploy ]]
[[ "$IMAGE_TAG" =~ ^[a-f0-9]{40}$ ]]
[[ "$GITHUB_ACTOR" =~ ^[A-Za-z0-9_-]+(\[bot\])?$ ]]
[[ "$DEPLOY_OPERATION" == check || "$DEPLOY_OPERATION" == deploy ]]

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ssh_dir="$(mktemp -d)"
chmod 700 "$ssh_dir"
printf '%s\n' "$BOT_SSH_KEY" | tr -d '\r' > "$ssh_dir/key"
printf '%s\n' "$BOT_KNOWN_HOSTS" | tr -d '\r' > "$ssh_dir/known_hosts"
chmod 600 "$ssh_dir/key" "$ssh_dir/known_hosts"
ssh_options=(-i "$ssh_dir/key" -p "$BOT_PORT" -o IdentitiesOnly=yes -o IdentityAgent=none -o BatchMode=yes -o ConnectTimeout=15
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$ssh_dir/known_hosts")
cleanup() {
  rm -f -- "$ssh_dir/key" "$ssh_dir/known_hosts"
  rmdir -- "$ssh_dir"
}
trap cleanup EXIT

remote="$deploy_root/releases/$IMAGE_TAG"
ssh "${ssh_options[@]}" "$BOT_USER@$BOT_HOST" \
  "test \"\$(id -un)\" = deploy && test \"\$(realpath '$deploy_root')\" = '$deploy_root' && test -w '$deploy_root/releases' && mkdir -p '$remote' && test \"\$(realpath '$remote')\" = '$remote'"
tar -C "$script_dir" -cf - compose.deploy.yaml server-release.sh | \
  ssh "${ssh_options[@]}" "$BOT_USER@$BOT_HOST" "umask 077; tar -xf - -C '$remote'"
printf '%s\n' "$GHCR_TOKEN" | ssh "${ssh_options[@]}" "$BOT_USER@$BOT_HOST" \
  "bash '$remote/server-release.sh' '$IMAGE_TAG' '$DEPLOY_OPERATION' '$GITHUB_ACTOR'"
