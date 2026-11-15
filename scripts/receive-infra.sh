#!/usr/bin/env bash
set -euo pipefail

deployment_root="${1:?배포 디렉터리를 지정하세요}"
revision="${2:?infra 커밋 SHA를 지정하세요}"
source "$(dirname "$0")/deployment-common.sh"
require_revision "$revision"
lock_deployment "$deployment_root"
mkdir -p "$deployment_root/releases"
task_directory="$(mktemp -d "$deployment_root/state/infra.XXXXXX")"
trap 'rm -rf "$task_directory"' EXIT
cat > "$task_directory/infra.tar.gz"
gzip -t "$task_directory/infra.tar.gz"
tar -tzf "$task_directory/infra.tar.gz" > "$task_directory/entries"
while IFS= read -r entry; do
  case "$entry" in
    /*|*../*|../*|*/..) echo 'infra 묶음에 허용되지 않은 경로가 있습니다.' >&2; exit 1 ;;
    compose.production.yaml|compose.development.yaml|compose.shared.yaml|Caddyfile|scripts/|scripts/*|images/|images/*.env) ;;
    *) echo 'infra 묶음에 운영 설정 외의 파일이 있습니다.' >&2; exit 1 ;;
  esac
done < "$task_directory/entries"
# 링크나 장치 파일이 압축 해제 경로 밖을 가리키지 못하게 한다.
if tar -tvzf "$task_directory/infra.tar.gz" | awk 'substr($1,1,1) != "-" && substr($1,1,1) != "d" { invalid=1 } END { exit !invalid }'; then
  echo 'infra 묶음에는 일반 파일과 디렉터리만 넣을 수 있습니다.' >&2
  exit 1
fi
mkdir "$task_directory/release"
tar --no-same-owner --no-same-permissions -xzf "$task_directory/infra.tar.gz" -C "$task_directory/release"
for file in compose.production.yaml compose.development.yaml compose.shared.yaml Caddyfile scripts/deploy.sh scripts/deploy-app.sh scripts/server-command.sh; do
  test -s "$task_directory/release/$file"
done
destination="$deployment_root/releases/$revision"
if [[ -d "$destination" ]]; then
  diff -qr "$destination" "$task_directory/release" >/dev/null
else
  mv "$task_directory/release" "$destination"
fi
activate_link "$deployment_root" pending "$revision"
printf 'infra 수신 완료: %s. 운영 적용은 수동으로 실행하세요.\n' "$revision"
