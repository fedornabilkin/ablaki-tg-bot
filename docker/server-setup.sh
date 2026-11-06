#!/usr/bin/env bash
set -euo pipefail
umask 077
die() { echo "ERROR: $*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die 'Run through sudo or as root.'
[[ $# -eq 1 && -f $1 ]] || die 'Usage: sudo bash server-setup.sh /path/to/deploy-key.pub'
key_file=$(realpath -- "$1")
ssh-keygen -lf "$key_file" >/dev/null || die 'Invalid SSH public key.'
[[ $(grep -c '^ssh-ed25519 ' "$key_file") == 1 && $(wc -l < "$key_file") -le 1 ]] || die 'Supply one Ed25519 public key.'
# shellcheck source=/dev/null
source /etc/os-release
case "$ID" in ubuntu|debian) ;; *) die 'Supported OS: Ubuntu or Debian with systemd.' ;; esac
[[ $(uname -m) == x86_64 ]] || die 'This deployment currently publishes linux/amd64. Use an x86_64 VPS.'
command -v systemctl >/dev/null || die 'systemd is required.'

# Do not uninstall/replace an existing Docker installation or restart other containers.
if ! command -v docker >/dev/null; then
  for package in docker.io podman-docker containerd runc; do
    if dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'install ok installed'; then
      die "Existing $package must be reviewed before installing Docker CE; nothing was removed."
    fi
  done
  apt-get update
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl --fail --silent --show-error --location "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/$ID
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
docker info >/dev/null
compose_version=$(docker compose version --short) || die 'Install the Docker Compose plugin for the existing Docker installation.'
[[ $(printf '%s\n' 2.30.0 "${compose_version#v}" | sort -V | head -n1) == 2.30.0 ]] || die 'Docker Compose >= 2.30.0 is required.'
for command in flock tar stat realpath openssl; do command -v "$command" >/dev/null || die "Missing $command"; done

deploy_user=ablakin-bot
deploy_root=/opt/ablaki-tg-bot
if ! id "$deploy_user" >/dev/null 2>&1; then useradd --create-home --shell /bin/bash "$deploy_user"; fi
[[ $(getent passwd "$deploy_user" | cut -d: -f6) == /home/ablakin-bot ]] || die 'Existing deployment user has an unexpected home.'
[[ $(getent passwd "$deploy_user" | cut -d: -f7) == /bin/bash ]] || die 'Deployment user needs /bin/bash.'
usermod -aG docker "$deploy_user"
for directory in /home/ablakin-bot /home/ablakin-bot/.ssh "$deploy_root" "$deploy_root/releases" "$deploy_root/docker"; do
  [[ ! -L "$directory" ]] || die "Refusing symbolic link: $directory"
  install -d -o "$deploy_user" -g "$(id -gn "$deploy_user")" -m 0700 "$directory"
done
[[ $(realpath "$deploy_root") == "$deploy_root" ]] || die 'Deployment path resolves elsewhere.'
# The administrator's temporary upload directory is private; the bot user cannot read it.
configure_script="$(dirname -- "$(realpath "${BASH_SOURCE[0]}")")/configure-env.sh"
[[ -f "$configure_script" && ! -L "$deploy_root/docker/configure-env.sh" ]] || die 'configure-env.sh must accompany server-setup.sh.'
install -o "$deploy_user" -g "$(id -gn "$deploy_user")" -m 0700 "$configure_script" "$deploy_root/docker/configure-env.sh"
keys=/home/ablakin-bot/.ssh/authorized_keys
[[ ! -L $keys ]] || die 'authorized_keys must not be a symlink.'
touch "$keys"
public_key=$(tr -d '\r\n' < "$key_file")
if ! grep -Fq -- "$(awk '{print $2}' "$key_file")" "$keys"; then printf 'restrict %s\n' "$public_key" >> "$keys"; fi
chown "$deploy_user:$(id -gn "$deploy_user")" "$keys"
chmod 0600 "$keys"
if [[ -f "$deploy_root/.env" && ! -L "$deploy_root/.env" ]]; then
  chown "$deploy_user:$(id -gn "$deploy_user")" "$deploy_root/.env"
  chmod 0600 "$deploy_root/.env"
fi
runuser -u "$deploy_user" -- docker info >/dev/null
runuser -u "$deploy_user" -- test -w "$deploy_root/releases"
echo 'SETUP OK. Docker access and deployment directory are ready. SSH settings/firewall were not changed.'
echo 'Server Ed25519 host key fingerprint (compare with the Windows setup):'
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
