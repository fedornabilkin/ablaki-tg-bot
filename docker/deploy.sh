#!/usr/bin/env bash
set -euo pipefail

# All credentials are injected by Actions; no application secrets are copied.
for name in BOT_HOST BOT_PORT BOT_USER BOT_DEPLOY_PATH BOT_SSH_KEY BOT_KNOWN_HOSTS GITHUB_ACTOR GHCR_TOKEN IMAGE_TAG; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing deployment setting: $name" >&2
    exit 1
  fi
done
[[ "$BOT_HOST" =~ ^[A-Za-z0-9][A-Za-z0-9.:-]*$ ]]
[[ "$BOT_PORT" =~ ^[0-9]{1,5}$ ]]
(( 10#$BOT_PORT >= 1 && 10#$BOT_PORT <= 65535 ))
[[ "$BOT_USER" =~ ^[a-z_][a-z0-9_-]*$ ]]
[[ "$BOT_DEPLOY_PATH" =~ ^/[A-Za-z0-9._/-]+$ && "$BOT_DEPLOY_PATH" != *..* ]]
[[ "$IMAGE_TAG" =~ ^[a-f0-9]{40}$ ]]
[[ "$GITHUB_ACTOR" =~ ^[A-Za-z0-9_-]+(\[bot\])?$ ]]

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ssh_dir="$(mktemp -d)"
chmod 700 "$ssh_dir"
printf '%s\n' "$BOT_SSH_KEY" | tr -d '\r' > "$ssh_dir/key"
printf '%s\n' "$BOT_KNOWN_HOSTS" > "$ssh_dir/known_hosts"
chmod 600 "$ssh_dir/key" "$ssh_dir/known_hosts"
ssh_options=(-i "$ssh_dir/key" -p "$BOT_PORT" -o BatchMode=yes -o ConnectTimeout=15
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$ssh_dir/known_hosts")
cleanup() {
  ssh "${ssh_options[@]}" "$BOT_USER@$BOT_HOST" 'docker logout ghcr.io >/dev/null 2>&1 || true' || true
  rm -f -- "$ssh_dir/key" "$ssh_dir/known_hosts"
  rmdir -- "$ssh_dir"
}
trap cleanup EXIT

ssh "${ssh_options[@]}" "$BOT_USER@$BOT_HOST" \
  "mkdir -p '$BOT_DEPLOY_PATH/docker' && test -s '$BOT_DEPLOY_PATH/.env' && docker compose version >/dev/null"
scp_host="$BOT_HOST"
if [[ "$scp_host" == *:* ]]; then scp_host="[$scp_host]"; fi
scp -i "$ssh_dir/key" -P "$BOT_PORT" -o BatchMode=yes -o ConnectTimeout=15 \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$ssh_dir/known_hosts" \
  "$script_dir/compose.deploy.yaml" "$BOT_USER@$scp_host:$BOT_DEPLOY_PATH/docker/compose.deploy.yaml"
printf '%s' "$GHCR_TOKEN" | ssh "${ssh_options[@]}" "$BOT_USER@$BOT_HOST" \
  "docker login ghcr.io --username '$GITHUB_ACTOR' --password-stdin >/dev/null"
ssh "${ssh_options[@]}" "$BOT_USER@$BOT_HOST" \
  "cd '$BOT_DEPLOY_PATH' && IMAGE_TAG='$IMAGE_TAG' docker compose --env-file .env -f docker/compose.deploy.yaml pull && IMAGE_TAG='$IMAGE_TAG' docker compose --env-file .env -f docker/compose.deploy.yaml up -d --no-build --remove-orphans --wait --wait-timeout 90"
