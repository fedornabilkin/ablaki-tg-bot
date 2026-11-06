#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $(id -un) == deploy ]] || { echo 'Run as deploy (sudo -u deploy bash docker/configure-env.sh).' >&2; exit 1; }
root=/opt/ablaki-tg-bot
[[ $(realpath "$root") == "$root" && ! -L "$root/.env" ]] || exit 1
read -r -p 'Public HTTPS API base URL (without /auth/telegram): ' api_url
[[ "$api_url" =~ ^https://[A-Za-z0-9._:-]+(/[A-Za-z0-9._/-]*)?$ ]] || { echo 'Use a public HTTPS API URL.' >&2; exit 1; }
read -r -s -p 'Telegram BotFather token: ' bot_token; printf '\n'
[[ "$bot_token" =~ ^[0-9]+:[A-Za-z0-9_-]{30,}$ ]] || { echo 'Invalid bot token format.' >&2; exit 1; }
read -r -s -p 'Shared TELEGRAM_AUTH_API_KEY (same as backend): ' api_key; printf '\n'
[[ ${#api_key} -ge 32 && ${#api_key} -le 512 && "$api_key" != *[[:space:]]* ]] || { echo 'Shared key must be 32–512 characters without spaces.' >&2; exit 1; }
temporary=$(mktemp "$root/.env.XXXXXX")
trap 'rm -f -- "$temporary"; unset bot_token api_key' EXIT
printf 'TELEGRAM_BOT_TOKEN=%s\nABL_API_BASE_URL=%s\nTELEGRAM_AUTH_API_KEY=%s\n' "$bot_token" "${api_url%/}" "$api_key" > "$temporary"
chmod 0600 "$temporary"
if [[ -f "$root/.env" ]]; then cp -p "$root/.env" "$root/.env.backup.$(date +%Y%m%d-%H%M%S)"; fi
mv -f -- "$temporary" "$root/.env"
echo 'Three settings saved, owner deploy, mode 600. Secrets were not printed.'
