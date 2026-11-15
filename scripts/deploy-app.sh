#!/usr/bin/env bash
set -euo pipefail

deployment_root="${1:?배포 디렉터리를 지정하세요}"
service="${2:?배포할 앱을 지정하세요}"
revision="${3:?앱 커밋 SHA를 지정하세요}"
script_root="$(cd "$(dirname "$0")" && pwd)"
source "$script_root/deployment-common.sh"
require_revision "$revision"
case "$service" in
  web) image="graduate-me-frontend:$revision"; image_key=WEB_IMAGE ;;
  admin) image="graduate-me-admin:$revision"; image_key=ADMIN_IMAGE ;;
  api) image="graduate-me-backend:$revision"; image_key=API_IMAGE ;;
  *) echo '지원하지 않는 앱입니다.' >&2; exit 1 ;;
esac
lock_deployment "$deployment_root"
export GRADUATE_ME_DEPLOY_ROOT="$deployment_root"
export GRADUATE_ME_ENV_DIR="${GRADUATE_ME_ENV_DIR:-$HOME/.config/graduate-me}"
image_file="$deployment_root/state/images/production.env"
test -s "$image_file"

# 압축 전송의 실패를 확인한 뒤 이미지를 읽어 부분 수신으로 배포하지 않는다.
task_directory="$(mktemp -d "$deployment_root/state/app.XXXXXX")"
trap 'rm -rf "$task_directory"' EXIT
cat > "$task_directory/image.tar.gz"
gzip -t "$task_directory/image.tar.gz"
gzip -dc "$task_directory/image.tar.gz" | docker load
image_platform="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")"
image_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")"
if [[ "$image_platform" != linux/amd64 || "$image_revision" != "$revision" ]]; then
  echo '전달된 이미지의 플랫폼 또는 커밋이 배포 요청과 다릅니다.' >&2
  exit 1
fi

# 운영 이미지 기록은 상태 확인이 성공한 뒤 교체한다.
candidate="$task_directory/production.env"
awk -v key="$image_key" -v value="$image" '
  index($0, key "=") == 1 { found=1; print key "=" value; next }
  { print }
  END { if (!found) print key "=" value }
' "$image_file" > "$candidate"
GRADUATE_ME_IMAGE_FILE="$candidate" bash "$script_root/deploy.sh" production --service "$service" --without-worker --local-images
mv "$candidate" "$image_file"
printf '앱 배포 완료: %s, 커밋: %s\n' "$service" "$revision"
