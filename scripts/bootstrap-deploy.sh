#!/usr/bin/env bash
set -euo pipefail

deployment_root="${1:?홈서버 배포 디렉터리를 지정하세요}"
revision="${2:?설치할 infra 커밋 SHA를 지정하세요}"
source_root="$(cd "$(dirname "$0")/.." && pwd)"
source "$source_root/scripts/deployment-common.sh"
require_revision "$revision"
lock_deployment "$deployment_root"
for file in compose.production.yaml compose.development.yaml compose.shared.yaml Caddyfile; do
  if [[ ! -L "$deployment_root/active-production" && -f "$deployment_root/$file" ]] && ! cmp -s "$deployment_root/$file" "$source_root/$file"; then
    echo '기존 홈서버 설정이 설치할 버전과 다릅니다. 차이를 확인한 뒤 최초 전환하세요.' >&2
    exit 1
  fi
done
mkdir -p "$deployment_root/releases" "$deployment_root/state/images" "$deployment_root/bin"
task_directory="$(mktemp -d "$deployment_root/state/bootstrap.XXXXXX")"
trap 'rm -rf "$task_directory"' EXIT
mkdir "$task_directory/release"

# 최초 전환 시 기존 이미지 버전 기록을 보존하고, 재실행으로 덮어쓰지 않는다.
for stage in production development shared; do
  if [[ ! -f "$deployment_root/state/images/$stage.env" ]]; then
    image_source="$deployment_root/images/$stage.env"
    if [[ ! -f "$image_source" ]]; then image_source="$source_root/images/$stage.env"; fi
    cp "$image_source" "$deployment_root/state/images/$stage.env"
  fi
done
for file in compose.production.yaml compose.development.yaml compose.shared.yaml Caddyfile; do
  cp "$source_root/$file" "$task_directory/release/$file"
done
cp -R "$source_root/scripts" "$source_root/images" "$task_directory/release/"
if [[ -d "$deployment_root/releases/$revision" ]]; then
  diff -qr "$deployment_root/releases/$revision" "$task_directory/release" >/dev/null
else
  mv "$task_directory/release" "$deployment_root/releases/$revision"
fi
for name in active-production active-development active-shared control; do
  if [[ ! -L "$deployment_root/$name" ]]; then
    activate_link "$deployment_root" "$name" "$revision"
  fi
done

# SSH 키마다 고정한 대상만 실행하고 개인 SSH 로그인은 그대로 유지한다.
cat > "$deployment_root/bin/ssh-command" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
deployment_root="$(cd "$(dirname "$0")/.." && pwd)"
exec bash "$deployment_root/control/scripts/server-command.sh" "$deployment_root" "${1:?배포 대상을 지정하세요}"
SCRIPT
chmod 700 "$deployment_root/bin/ssh-command"
printf '배포 디렉터리 준비 완료: %s. 실행 중인 컨테이너는 변경하지 않았습니다.\n' "$deployment_root"
