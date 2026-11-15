#!/usr/bin/env bash
set -euo pipefail

deployment_root="${1:?홈서버 배포 디렉터리를 지정하세요}"
scope="${2:?SSH 키의 배포 대상을 지정하세요}"
script_root="$(cd "$(dirname "$0")" && pwd)"
source "$script_root/deployment-common.sh"

# SSH 원문을 셸 코드로 실행하지 않고 허용한 명령과 인자만 해석한다.
read -r -a arguments <<< "${SSH_ORIGINAL_COMMAND:-}"
if [[ "${SSH_ORIGINAL_COMMAND:-}" == *$'\n'* ]]; then exit 1; fi
command="${arguments[0]:-}"
case "$scope:$command" in
  web:status|admin:status|api:status|infra:status)
    [[ "${#arguments[@]}" == 1 ]] || exit 1
    printf '배포 연결 정상: %s\n' "$scope"
    ;;
  web:deploy|admin:deploy|api:deploy)
    [[ "${#arguments[@]}" == 2 ]] || exit 1
    require_revision "${arguments[1]}" || exit 1
    lock_deployment "$deployment_root"
    exec bash "$deployment_root/active-production/scripts/deploy-app.sh" "$deployment_root" "$scope" "${arguments[1]}"
    ;;
  infra:sync)
    [[ "${#arguments[@]}" == 2 ]] || exit 1
    require_revision "${arguments[1]}" || exit 1
    lock_deployment "$deployment_root"
    exec bash "$script_root/receive-infra.sh" "$deployment_root" "${arguments[1]}"
    ;;
  infra:apply)
    [[ "${#arguments[@]}" == 3 ]] || exit 1
    require_revision "${arguments[2]}" || exit 1
    lock_deployment "$deployment_root"
    exec bash "$script_root/apply-infra.sh" "$deployment_root" "${arguments[1]}" "${arguments[2]}"
    ;;
  *) echo '이 SSH 키로 허용되지 않은 배포 명령입니다.' >&2; exit 1 ;;
esac
