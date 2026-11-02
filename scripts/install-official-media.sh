#!/usr/bin/env bash
# X1-owned CI candidate; do not execute on production.
set -euo pipefail
trap 'printf "media supply check failed at line %s\n" "$LINENO" >&2' ERR
. /etc/os-release
printf 'Verifying media supply platform\n'
[[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 ]]
[[ "$(dpkg --print-architecture)" == amd64 ]]
# GitHub runner-images makes /usr/share writable; restore only the packaged public keyring.
keyring=/usr/share/keyrings/ubuntu-archive-keyring.gpg
[[ -f "$keyring" && ! -L "$keyring" ]]
[[ "$(stat -c %u "$keyring")" == 0 ]]
[[ "$(dpkg-query -S "$keyring")" == "ubuntu-keyring: $keyring" ]]
# Package-database integrity guard; apt signature validation remains mandatory.
[[ -z "$(dpkg --verify --verify-format rpm ubuntu-keyring)" ]]
sudo chmod 0644 "$keyring"
[[ "$(stat -c '%u %a' "$keyring")" == '0 644' ]]
printf 'packaged_public_keyring_mode_restored=true\n'
printf 'Refreshing signed package metadata\n'
sudo apt-get update -qq
packages=(
  ffmpeg=7:6.1.1-3ubuntu5
  libavcodec60=7:6.1.1-3ubuntu5
  libavdevice60=7:6.1.1-3ubuntu5
  libavfilter9=7:6.1.1-3ubuntu5
  libavformat60=7:6.1.1-3ubuntu5
  libavutil58=7:6.1.1-3ubuntu5
  libpostproc57=7:6.1.1-3ubuntu5
  libswresample4=7:6.1.1-3ubuntu5
  libswscale7=7:6.1.1-3ubuntu5
)
# Fail closed on an unavailable fixed version; never substitute latest/PPA.
for item in "${packages[@]}"; do
  name=${item%%=*}; version=${item#*=}
  printf 'Checking fixed official package %s\n' "$name"
  apt-cache madison "$name" | python3 scripts/check-media-source.py "$name" "$version"
done
sudo apt-get install -y --no-install-recommends --no-remove "${packages[@]}"
for item in "${packages[@]}"; do
  [[ "$(dpkg-query -W -f='${Version}' "${item%%=*}")" == "${item#*=}" ]]
done
[[ "$(dpkg-query -S /usr/bin/ffmpeg)" == 'ffmpeg: /usr/bin/ffmpeg' ]]
[[ "$(dpkg-query -S /usr/bin/ffprobe)" == 'ffmpeg: /usr/bin/ffprobe' ]]
[[ -z "$(dpkg --verify ffmpeg)" ]]
export QTALENT_TEST_FFMPEG_PATH=/usr/bin/ffmpeg
export QTALENT_TEST_FFPROBE_PATH=/usr/bin/ffprobe
python3 scripts/verify-media.py
if [[ -n "${GITHUB_ENV:-}" ]]; then
  printf '%s\n' "QTALENT_TEST_FFMPEG_PATH=$QTALENT_TEST_FFMPEG_PATH" "QTALENT_TEST_FFPROBE_PATH=$QTALENT_TEST_FFPROBE_PATH" >> "$GITHUB_ENV"
fi
