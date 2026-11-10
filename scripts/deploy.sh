#!/usr/bin/env bash
set -euo pipefail

stage="${1:-}"
case "$stage" in
  development|production|shared) ;;
  *) echo '사용법: bash scripts/deploy.sh development|production|shared' >&2; exit 1 ;;
esac

demo=0
local_images=0
without_worker=0
web_only=0
for option in "${@:2}"; do
  case "$option" in
    --without-worker) without_worker=1 ;;
    --web-only) web_only=1 ;;
    --demo) demo=1 ;;
    --local-images) local_images=1 ;;
    *) echo "지원하지 않는 옵션: $option" >&2; exit 1 ;;
  esac
done
if [[ "$web_only" == 1 && ( "$stage" != production || "$demo" == 1 ) ]]; then
  echo '학생 화면 단독 배포는 production에서만 사용하며 체험 배포와 함께 실행하지 않습니다.' >&2
  exit 1
fi
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
if [[ "$web_only" == 1 ]]; then
  api_container="$("${compose[@]}" ps -q api)"
  if [[ -z "$api_container" ]]; then
    echo 'API가 실행 중이어야 학생 화면만 배포할 수 있습니다.' >&2
    exit 1
  fi
  desired_api_hash="$("${compose[@]}" config --hash api | awk '$1 == "api" { print $2 }')"
  running_api_hash="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.config-hash"}}' "$api_container")"
  api_health="$(docker inspect --format '{{.State.Health.Status}}' "$api_container")"
  # API 이미지나 비밀 설정이 달라진 배포를 화면 단독 갱신으로 오인하지 않게 한다.
  if [[ -z "$desired_api_hash" || "$running_api_hash" != "$desired_api_hash" || "$api_health" != healthy ]]; then
    echo 'API 설정 변경 또는 비정상 상태가 있습니다. 일반 배포 경로를 먼저 사용해 주세요.' >&2
    exit 1
  fi
  if [[ "$local_images" == 0 ]]; then "${compose[@]}" pull web; fi
  if [[ "$without_worker" == 1 ]]; then "${compose[@]}" stop worker; fi
  # DB와 API를 유지해 학생 스타일 변경 중 기존 학습 요청을 끊지 않는다.
  "${compose[@]}" up -d --no-deps --wait --wait-timeout 180 web
  "${compose[@]}" ps web
  exit 0
fi
if [[ "$local_images" == 0 ]]; then
  "${compose[@]}" pull
fi

if [[ "$stage" != shared ]]; then
  networks=("graduate-me-$stage-edge")
  docker network inspect "${networks[@]}" >/dev/null
  "${compose[@]}" up -d --wait db
  services=(worker api)
  if [[ "$stage" == production ]]; then services+=(web admin); fi
  # 이전 앱이 변경 중인 스키마를 사용하지 않도록 잠시 중단한다.
  "${compose[@]}" stop "${services[@]}"
  backup_dir="${GRADUATE_ME_BACKUP_DIR:-$GRADUATE_ME_ENV_DIR/backups}"
  mkdir -p "$backup_dir"
  chmod 700 "$backup_dir"
  backup_file="$backup_dir/$stage-$(date -u +%Y%m%dT%H%M%SZ).dump"
  umask 077
  "${compose[@]}" exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup_file"
  test -s "$backup_file"
  "${compose[@]}" run --rm --no-deps api pnpm db:migrate
fi

case "$stage" in
  shared) services=(gateway) ;;
  production) services=(api web admin worker) ;;
  development) services=(api worker) ;;
esac
if [[ "$demo" == 1 ]]; then
  if [[ "$stage" == shared ]]; then services=(gateway); else services=(api web admin); fi
fi
if [[ "$without_worker" == 1 && "$stage" != shared ]]; then
  # 명시한 서비스만 시작해 대기 작업의 외부 모델 호출을 막는다.
  services=(api)
  if [[ "$stage" == production ]]; then services+=(web admin); fi
fi
start_options=(--wait-timeout 180)
if [[ "$stage" == shared ]]; then
  # 구성 파일 교체 후 이전 inode를 가리키는 bind mount도 새로 연결한다.
  start_options+=(--force-recreate)
fi
"${compose[@]}" up -d --wait --remove-orphans "${start_options[@]}" "${services[@]}"
"${compose[@]}" ps
