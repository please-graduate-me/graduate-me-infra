#!/usr/bin/env bash
set -euo pipefail

deployment_root="${1:?배포 디렉터리를 지정하세요}"
stage="${2:?적용할 환경을 지정하세요}"
revision="${3:?적용할 infra 커밋 SHA를 지정하세요}"
source "$(dirname "$0")/deployment-common.sh"
require_revision "$revision"
case "$stage" in production|development|shared) ;; *) exit 1 ;; esac
lock_deployment "$deployment_root"
release="$deployment_root/releases/$revision"
test -s "$release/compose.$stage.yaml"
export GRADUATE_ME_DEPLOY_ROOT="$deployment_root"
export GRADUATE_ME_ENV_DIR="${GRADUATE_ME_ENV_DIR:-$HOME/.config/graduate-me}"
export GRADUATE_ME_IMAGE_FILE="$deployment_root/state/images/$stage.env"

# 이미지 버전은 수신한 infra 파일 대신 홈서버의 마지막 성공 기록을 사용한다.
options=(--without-worker --local-images)
if [[ "$stage" == shared ]]; then options=(); fi
bash "$release/scripts/deploy.sh" "$stage" "${options[@]}"
activate_link "$deployment_root" "active-$stage" "$revision"
if [[ "$stage" == production ]]; then
  activate_link "$deployment_root" control "$revision"
fi
printf 'infra 운영 적용 완료: %s, 커밋: %s\n' "$stage" "$revision"
