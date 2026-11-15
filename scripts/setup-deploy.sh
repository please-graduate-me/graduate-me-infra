#!/usr/bin/env bash
set -euo pipefail

server_alias="${1:-jaejoon-server}"
infra_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$infra_root"
if [[ -n "$(git status --porcelain)" ]]; then
  echo 'pnpm check를 통과하고 infra 변경을 커밋한 뒤 설정 도구를 실행하세요.' >&2
  exit 1
fi
revision="$(git rev-parse HEAD)"
remote_revision="$(git ls-remote origin refs/heads/main | cut -f1)"
if [[ "$(git branch --show-current)" != main || "$revision" != "$remote_revision" ]]; then
  echo '검사한 infra 변경을 main에 push한 뒤 최초 연결을 설정하세요.' >&2
  exit 1
fi
task_directory="$(mktemp -d)"
trap 'rm -rf "$task_directory"' EXIT
chmod 700 "$task_directory"

# 기존 개인 SSH 연결로 서버의 공개 키를 읽어 최초 인증도 확인된 경로를 사용한다.
deploy_host="$(ssh -o BatchMode=yes "$server_alias" 'tailscale ip -4 | head -n 1')"
deploy_user="$(ssh -o BatchMode=yes "$server_alias" 'id -un')"
deployment_root="$(ssh -o BatchMode=yes "$server_alias" 'printf "%s/graduate-me-infra" "$HOME"')"
host_key="$(ssh -o BatchMode=yes "$server_alias" 'cat /etc/ssh/ssh_host_ed25519_key.pub')"
[[ "$deploy_host" =~ ^100\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 1
[[ "$deploy_user" =~ ^[a-z_][a-z0-9_-]*$ ]] || exit 1
[[ "$deployment_root" =~ ^/[-a-zA-Z0-9_/]+$ ]] || exit 1
[[ "$host_key" == ssh-ed25519\ * ]] || exit 1
printf '%s %s\n' "$deploy_host" "$host_key" > "$task_directory/known_hosts"
mkdir -p "$task_directory/source/setup-keys"
git archive HEAD compose.production.yaml compose.development.yaml compose.shared.yaml Caddyfile scripts images | tar -xf - -C "$task_directory/source"
for scope in infra web api admin; do
  ssh-keygen -q -t ed25519 -N '' -C "graduate-me-ci-$scope" -f "$task_directory/$scope"
  cp "$task_directory/$scope.pub" "$task_directory/source/setup-keys/$scope.pub"
done

# 활성화는 Tailscale 인증 등록과 최종 확인 후 따로 수행한다.
for repository in graduate-me-infra graduate-me-frontend graduate-me-backend graduate-me-admin; do
  gh variable set DEPLOY_ENABLED --repo "please-graduate-me/$repository" --body false
done

tar -cf - -C "$task_directory/source" . | gzip -1 > "$task_directory/infra.tar.gz"
remote_script="$(cat <<'SCRIPT'
set -euo pipefail
task_directory=$(mktemp -d)
trap 'rm -rf "$task_directory"' EXIT
gzip -dc | tar -xf - -C "$task_directory"
bash "$task_directory/scripts/bootstrap-deploy.sh" "$HOME/graduate-me-infra" "$revision"
bash "$task_directory/scripts/install-deploy-keys.sh" "$HOME/graduate-me-infra" "$task_directory/setup-keys"
SCRIPT
)"
ssh -o BatchMode=yes "$server_alias" "revision=$revision; $remote_script" < "$task_directory/infra.tar.gz"

for item in infra:graduate-me-infra web:graduate-me-frontend api:graduate-me-backend admin:graduate-me-admin; do
  scope="${item%%:*}"
  repository="please-graduate-me/${item#*:}"
  key_file="$task_directory/$scope"
  ssh -i "$key_file" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$task_directory/known_hosts" "$deploy_user@$deploy_host" status
  gh secret set DEPLOY_SSH_KEY --repo "$repository" < "$key_file"
  gh secret set DEPLOY_KNOWN_HOSTS --repo "$repository" < "$task_directory/known_hosts"
  gh variable set DEPLOY_HOST --repo "$repository" --body "$deploy_host"
  gh variable set DEPLOY_USER --repo "$repository" --body "$deploy_user"
  printf '배포 전용 SSH 인증 등록 완료: %s\n' "$repository"
done
echo 'Tailscale OIDC 인증을 각 저장소에 등록한 뒤 DEPLOY_ENABLED를 true로 설정하세요.'
