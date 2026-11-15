#!/usr/bin/env bash
set -euo pipefail

deployment_root="${1:?홈서버 배포 디렉터리를 지정하세요}"
key_directory="${2:?배포 공개 키 디렉터리를 지정하세요}"
ssh_directory="${3:-$HOME/.ssh}"
[[ "$deployment_root" =~ ^/[-a-zA-Z0-9_/]+$ ]] || exit 1
test -x "$deployment_root/bin/ssh-command"
umask 077
mkdir -p "$ssh_directory"
chmod 700 "$ssh_directory"
touch "$ssh_directory/authorized_keys"
key_file="$(mktemp "$ssh_directory/graduate-me-keys.XXXXXX")"
trap 'rm -f "$key_file"' EXIT

# 개인 로그인 키를 남기고 이 프로젝트의 배포 키만 교체한다.
awk '$NF !~ /^graduate-me-ci-(infra|web|api|admin)$/' "$ssh_directory/authorized_keys" > "$key_file"
for scope in infra web api admin; do
  public_key="$key_directory/$scope.pub"
  ssh-keygen -l -f "$public_key" >/dev/null
  read -r key_type key_value key_comment < "$public_key"
  [[ "$key_type" == ssh-ed25519 && "$key_comment" == "graduate-me-ci-$scope" ]] || exit 1
  printf 'restrict,command="%s/bin/ssh-command %s" %s %s %s\n' "$deployment_root" "$scope" "$key_type" "$key_value" "$key_comment" >> "$key_file"
done
chmod 600 "$key_file"
mv "$key_file" "$ssh_directory/authorized_keys"
