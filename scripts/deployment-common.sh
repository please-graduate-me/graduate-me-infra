#!/usr/bin/env bash

# 서로 다른 저장소의 배포도 홈서버의 같은 잠금을 사용한다.
lock_deployment() {
  local deployment_root="$1"
  mkdir -p "$deployment_root/state"
  if [[ "${GRADUATE_ME_LOCK_ROOT:-}" != "$deployment_root" ]]; then
    exec 9>"$deployment_root/state/deploy.lock"
    flock -w 1800 9 || exit 1
    export GRADUATE_ME_LOCK_ROOT="$deployment_root"
  fi
}

# 링크를 한 번에 교체해 앱 배포가 불완전한 infra 경로를 읽지 않게 한다.
activate_link() {
  local deployment_root="$1" name="$2" revision="$3"
  ln -s "releases/$revision" "$deployment_root/.$name.next"
  if [[ "$OSTYPE" == darwin* ]]; then
    mv -fh "$deployment_root/.$name.next" "$deployment_root/$name"
  else
    mv -Tf "$deployment_root/.$name.next" "$deployment_root/$name"
  fi
}

require_revision() {
  if [[ ! "$1" =~ ^[a-f0-9]{40}$ ]]; then
    echo '전체 Git 커밋 SHA 40자리를 지정하세요.' >&2
    return 1
  fi
}
