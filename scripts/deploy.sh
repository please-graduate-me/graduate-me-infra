#!/usr/bin/env bash
set -euo pipefail

stage="${1:-}"
case "$stage" in
  development|production|shared) ;;
  *) echo '사용법: bash scripts/deploy.sh development|production|shared' >&2; exit 1 ;;
esac

demo=0
local_images=0
for option in "${@:2}"; do
  case "$option" in
    --demo) demo=1 ;;
    --local-images) local_images=1 ;;
    *) echo "지원하지 않는 옵션: $option" >&2; exit 1 ;;
  esac
done
if [[ "$demo" == 1 && "$stage" == development ]]; then
  echo '체험 배포는 shared와 production에만 사용합니다.' >&2
  exit 1
fi

infra_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$infra_root"
: "${GRADUATE_ME_ENV_DIR:?홈서버의 비밀 설정 디렉터리를 지정하세요}"
secret_file="$GRADUATE_ME_ENV_DIR/$stage.env"
image_file="$infra_root/images/$stage.env"
if [[ ! -f "$secret_file" ]]; then
  echo "환경 설정 파일이 없습니다: $secret_file" >&2
  exit 1
fi
if grep -Eq '^[A-Z_]+=.*(configure-me|:latest([[:space:]]|$))' "$image_file"; then
  echo 'images 파일에 실제 검증한 이미지 버전을 먼저 기록하세요.' >&2
  exit 1
fi

# 설정 파일을 실행하지 않고 Compose의 환경변수 파서로만 읽는다.
compose=(docker compose --env-file "$image_file" --env-file "$secret_file" -f "compose.$stage.yaml")
"${compose[@]}" config --quiet
if [[ "$local_images" == 0 ]]; then
  "${compose[@]}" pull
fi

if [[ "$stage" != shared ]]; then
  networks=("graduate-me-$stage-edge")
  docker network inspect "${networks[@]}" >/dev/null
  "${compose[@]}" up -d --wait db
  services=(worker api)
  if [[ "$stage" == production ]]; then services+=(web); fi
  # 이전 앱이 변경 중인 스키마를 사용하지 않도록 잠시 중단한다.
  "${compose[@]}" stop "${services[@]}"
  backup_dir="${GRADUATE_ME_BACKUP_DIR:-$GRADUATE_ME_ENV_DIR/backups}"
  mkdir -p "$backup_dir"
  chmod 700 "$backup_dir"
  backup_file="$backup_dir/$stage-$(date -u +%Y%m%dT%H%M%SZ).dump"
  umask 077
  "${compose[@]}" exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup_file"
  test -s "$backup_file"
  "${compose[@]}" run --rm --no-deps api sh -c 'pnpm db:migrate && pnpm db:seed'
  if [[ "$demo" == 1 ]]; then
    test -s "$GRADUATE_ME_ENV_DIR/demo.json"
    "${compose[@]}" run --rm --no-deps -T api pnpm exec tsx src/database/seed-demo.ts < "$GRADUATE_ME_ENV_DIR/demo.json"
  fi
fi

services=()
if [[ "$demo" == 1 ]]; then
  if [[ "$stage" == shared ]]; then services=(gateway); else services=(api web); fi
fi
"${compose[@]}" up -d --wait --remove-orphans --wait-timeout 180 "${services[@]}"
"${compose[@]}" ps
