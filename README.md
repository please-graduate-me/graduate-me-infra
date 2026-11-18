# graduate-me-infra

사용자 웹, 관리자 웹과 백엔드를 함께 실행하고 홈서버의 개발·운영 환경을 관리하는 저장소입니다. 앱 소스와 Dockerfile은 각 앱 저장소에 유지합니다. 실제 비밀값과 DB 데이터는 Git에 저장하지 않습니다.

## 파일과 책임

| 파일 | 용도 |
| --- | --- |
| `compose.yaml` + `compose.local.yaml` | 개발자 PC에서 모든 서비스를 함께 실행하고 소스 변경 반영 |
| `compose.development.yaml` | 홈서버의 개발 API, worker, 개발 PostgreSQL |
| `compose.production.yaml` | 홈서버의 학생·관리자 앱, API, worker, 운영 PostgreSQL |
| `compose.shared.yaml` | 공용 Caddy와 환경별 진입 네트워크 |
| `Caddyfile` | Tunnel 내부 HTTP 요청을 운영 웹과 개발 API로 전달 |
| `images/*.env` | 최초 설치용 이미지 버전, 운영 배포 기록은 홈서버 `state/images/*.env`에 보관 |
| `env/*.env.example` | 환경별 비밀 설정의 빈 양식 |
| `.github/workflows/check.yaml` | GitHub 제공 runner에서 인프라 구성 검사 |
| `.github/workflows/deploy.yaml` | GitHub 제공 runner에서 수신한 infra 버전을 환경별로 수동 적용 |
| `.github/workflows/deploy-app.yaml` | 각 앱의 검사가 통과한 후 호출하는 이미지 빌드·전송·앱별 배포 절차 |
| `.github/workflows/infra-operation.yaml` | Tailscale·SSH를 통한 infra 수신과 수동 적용 |

`development`는 팀원이 사용하는 홈서버의 개발 API입니다. 개인 PC에서 전체 스택을 실행하는 `local`과 다릅니다. 운영 프론트만 홈서버에 두고, 프론트 개발자는 로컬 개발 서버를 사용합니다.

## 로컬 전체 실행

```text
codding/
├── graduate-me-infra/
├── graduate-me-frontend/
├── graduate-me-admin/
└── graduate-me-backend/
```

Node.js 22, pnpm 10.33.0, Docker Compose가 필요합니다. Compose는 CI와 동일한 `v5.1.0`으로 검증했습니다. 기존 저장소의 코드를 직접 참조하는 곳은 Docker 빌드 컨텍스트와 소스 감시뿐입니다.

```sh
pnpm install --frozen-lockfile
test -f .env || cp .env.example .env
# .env에 인증 정보와 사용할 공급자 키를 설정합니다.
pnpm dev
```

`pnpm dev` 한 번으로 사용자 웹, 관리자 웹, API, DB, worker를 실행하고 코드 변경을 반영합니다. 백그라운드 실행만 필요하면 `pnpm dev:up`을 사용합니다. 이 명령은 파일 감시를 켜지 않으므로 필요한 경우 아래 명령을 별도 터미널에서 실행합니다.

```sh
docker compose -f compose.yaml -f compose.local.yaml watch --no-up
pnpm dev:logs
pnpm dev:down
```

사용자 웹은 `http://localhost:3000`, 관리자 웹은 `http://localhost:3001`, API는 `http://localhost:4000`입니다. 관리자 포트가 사용 중이면 `.env`의 `ADMIN_PORT`를 다른 값으로 바꿉니다. DB 포트는 로컬의 `15432`입니다. 이 포트들은 모두 `127.0.0.1`에만 연결합니다.

기존 개별 Compose에서 전환할 때는 해당 파일 감시와 컨테이너를 먼저 종료합니다. 각 앱 폴더의 `docker compose -f compose.yaml -f compose.dev.yaml down`을 사용합니다. 볼륨 삭제 옵션은 사용하지 않습니다.

기존 DB를 이어 쓰려면 `.env`에 `LOCAL_POSTGRES_VOLUME=graduate-me_postgres_data`를 설정합니다. 새 환경은 기본적으로 `graduate-me-local_postgres_data`를 사용합니다. 한 볼륨에 PostgreSQL 두 개를 동시에 실행하지 않습니다. 기존 Compose와 통합 Compose를 같은 포트로 함께 실행하지 않습니다.

## 홈서버 구성

홈서버는 Ubuntu 24.04의 Intel 맥미니이며 `linux/amd64` 이미지를 사용합니다. SSH 관리는 Tailscale의 `ssh jaejoon-server`로 접속합니다. 재부팅 후 Docker와 cloudflared가 자동으로 시작되는지 확인합니다. GitHub의 Linux runner에서 빌드하고 홈서버는 이미지를 실행하는 역할만 맡깁니다.

- 운영: 학생 웹 1개, 관리자 웹 1개, API 1개, worker 1개, PostgreSQL 1개
- 개발: API 1개, worker 1개, PostgreSQL 1개
- 공용: Caddy 1개

개발과 운영의 DB 컨테이너, 볼륨, 내부 네트워크를 분리했습니다. DB에는 호스트 공개 포트가 없습니다. Caddy는 호스트의 `127.0.0.1:8080`에만 연결합니다. 홈서버의 cloudflared 서비스가 이 주소로 요청을 전달하며 공유기 포트 포워딩은 사용하지 않습니다. 공개 HTTPS는 Cloudflare에서 처리하고 Tunnel 뒤 Caddy는 HTTP로 실행합니다. 인증 콜백과 보안 쿠키가 HTTPS를 기준으로 동작하도록 Caddy가 업스트림에 `X-Forwarded-Proto: https`를 전달합니다. DB 내부 네트워크는 외부 연결을 차단하고, API와 worker는 각각 필요한 네트워크에 추가로 연결합니다.

개발 환경은 `MATERIAL_POLICY_PROFILE=mvp`를 사용하고 운영 기본값은 `standard`입니다. 현재 자료·AI 한도는 인증된 `/api/learning/policy` 응답에서 확인합니다. MVP의 파일·페이지·영상·AI 상한은 기존 환경 파일의 큰 한도보다 우선합니다. 정책을 바꾸면 API와 worker 환경을 함께 갱신합니다. 실제 기획 기준과 검증 결과는 Notion 구현 현황에서 관리합니다.

공급자 설정은 로컬 `graduate-me-infra/.env`, 홈서버 `development.env` 또는 `production.env`에서 관리합니다. 일반 AI는 `AI_PROVIDER=anthropic|naver`, OCR은 `OCR_PROVIDER=anthropic|clova`로 독립 선택합니다. 공급자를 변경할 때 해당 공급자의 키와 모델도 함께 설정합니다. 자동으로 다른 공급자로 전환하지 않습니다.

로컬과 개발 환경 기본값은 `AI_PROVIDER=anthropic`, `OCR_PROVIDER=anthropic`, `ANTHROPIC_MODEL=claude-sonnet-5-5`입니다. `.env`에 `ANTHROPIC_API_KEY`를 설정하면 API와 영상 번역·빈칸 준비를 담당하는 worker에만 주입됩니다. 학생 웹·관리자 웹·공용 gateway에는 공급자 키를 전달하지 않습니다. 키를 비워도 저장된 자료와 결과를 조회할 수 있습니다. 운영 기본값은 기존 Naver·CLOVA OCR 설정을 유지합니다.

Naver로 전환할 때는 `CLOVA_STUDIO_API_KEY`, `CLOVA_TEXT_MODEL=HCX-007`, `CLOVA_IMAGE_MODEL=HCX-005`, `CLOVA_STUDIO_BASE_URL`을 설정합니다. CLOVA OCR은 `CLOVA_OCR_INVOKE_URL`, `CLOVA_OCR_SECRET_KEY`, 선택적인 `OCR_ESTIMATED_USD_PER_PAGE`를 API 서버에만 주입합니다. CLOVA OCR은 영어, Claude OCR은 영어·태국어 경로를 제공합니다. Claude OCR에는 토큰 단가를 적용하고 페이지 단가를 중복 적용하지 않습니다.

새 영상 전사는 `VIDEO_TRANSCRIPTION_PROVIDER=gemini|disabled`로 제어합니다. 로컬·개발 기본값인 `disabled`에서는 준비된 영상은 재사용하고 새 분석은 접수하지 않습니다. Claude로 YouTube 영상 전사를 대체하지 않습니다. 운영 기본값은 `gemini`이며 `GEMINI_API_KEY`, `YOUTUBE_API_KEY`, `GEMINI_MODEL`은 worker에만 주입합니다. 별도 허가 없이 worker를 시작하거나 실제 모델을 호출하지 않습니다.

`AI_DAILY_REQUEST_LIMIT`, `AI_DAILY_TOKEN_LIMIT`, `AI_CONCURRENT_REQUEST_LIMIT`는 계정별 UTC 한도이며 `AI_PREPARATION_PAGE_LIMIT`는 PDF 최초 준비 페이지 수입니다. `AI_DAILY_BUDGET_USD=0`은 추정 비용 제한을 끕니다. 비용 제한을 켜려면 선택한 공급자의 `AI_ANTHROPIC_*_USD_PER_MILLION`, `AI_NAVER_*_USD_PER_MILLION`, `AI_GEMINI_*_USD_PER_MILLION` 입력·출력 단가를 설정합니다. 단가 미설정 비용과 실청구 비용은 미집계로 표시합니다. 검증에는 모의 응답을 사용합니다.

초기 메모리 제한은 환경별 DB 1GiB, API·worker 각각 768MiB, 운영 프론트 1GiB, Caddy 256MiB입니다. 실제 동시 요청으로 측정해 조정해야 하며 Docker VM과 호스트 OS의 여유도 필요합니다.

## 앱별 자동 배포

각 앱의 `main`에 push하거나 merge하면 해당 저장소의 GitHub Actions가 포맷·린트·타입·테스트·빌드를 검사합니다. 백엔드 CI는 `_test`로 끝나는 별도 PostgreSQL DB에 마이그레이션을 적용하고 DB 통합 테스트도 실행합니다. PR에서는 검사만 수행하며 홈서버와 연결하지 않습니다.

검사가 통과한 `main`은 이 저장소의 재사용 workflow `deploy-app.yaml`을 호출합니다. 앱 소스와 Dockerfile은 해당 앱 저장소에서 받고, GitHub의 일반 Ubuntu runner에서 `linux/amd64` 이미지를 빌드합니다. 전체 앱 커밋 SHA를 이미지 태그와 revision label에 기록합니다. 학생 웹은 React + Vite 정적 파일을 빌드하며 `VITE_ADMIN_APP_URL=https://admin.pleasegraduate.me`를 빌드 시 주입합니다. API 내부 주소는 빌드 인자가 아니라 실행 시 Nginx의 `API_INTERNAL_URL=http://production-api:4000`으로 전달합니다. 관리자 웹은 `VITE_STUDENT_URL=https://app.pleasegraduate.me`를 빌드 시 주입합니다.

이미지를 압축한 뒤에 Tailscale에 임시로 연결하고, SSH로 홈서버에 전달합니다. 이미지 저장소와 홈서버 self-hosted runner는 사용하지 않습니다. 전송받은 이미지의 압축·플랫폼·revision label을 확인하고 운영에 적용한 Compose로 해당 앱만 교체합니다. 마지막 상태 확인까지 성공해야 홈서버의 이미지 버전 기록을 갱신합니다. 작업 후 Tailscale에서 즉시 로그아웃하며 GitHub 임시 묶음과 키 파일을 지웁니다.

| 저장소 | 배포 대상 | 다른 앱에 미치는 영향 |
| --- | --- | --- |
| `graduate-me-frontend` | `web` | API·DB·관리자·worker 유지 |
| `graduate-me-admin` | `admin` | API·DB·학생 웹·worker 유지 |
| `graduate-me-backend` | `api` | worker 중지, DB 백업·마이그레이션 후 API 교체, 학생 웹·관리자 컨테이너 유지 |

백엔드 교체 중 API 요청에는 짧은 중단이 생깁니다. 앱 간 API 계약과 스키마는 배포 순서에 맞게 호환해야 합니다. 마이그레이션이나 상태 확인이 실패하면 workflow가 실패하며 성공 버전 기록은 유지합니다. 컨테이너와 DB 변경을 자동으로 되돌리지는 않습니다. 마이그레이션 실패 시 API는 중지된 상태일 수 있으므로 백업과 로그를 확인합니다.

서로 다른 앱 저장소의 GitHub concurrency는 서로 묶이지 않습니다. 홈서버의 `state/deploy.lock`을 `flock`으로 잡아 이미지 수신·앱 배포·infra 적용을 순서대로 실행합니다. 학생·관리자 배포는 운영 API가 healthy이고 설정 해시가 일치하는지도 먼저 확인합니다. 자동 배포와 infra 수동 적용은 worker를 시작하지 않습니다.

## infra 수신과 운영 적용

infra `main`의 검사가 통과하면 새 버전을 `releases/<infra SHA>/`에 받아두고 `pending` 링크만 바꿉니다. 수신 작업은 컨테이너와 운영 설정 링크, 실제 이미지 버전 기록을 변경하지 않습니다. 앱 배포는 항상 `active-production`의 설정과 스크립트를 사용하므로 대기 중인 Compose 변경이 앱 배포에 섞이지 않습니다.

```text
~/graduate-me-infra/
├── releases/<infra SHA>/       # 수신한 버전별 Compose·Caddyfile·배포 스크립트
├── pending                    # 최근 수신 버전
├── active-production          # 운영 앱 배포에 사용하는 infra 버전
├── active-development         # 수동 적용한 개발 환경 버전
├── active-shared              # 수동 적용한 Caddy 구성 버전
├── control                    # SSH 명령을 처리하는 적용된 제어 스크립트 버전
├── bin/ssh-command            # SSH 키에 연결하는 고정 진입점
└── state/
    ├── images/*.env           # 홈서버의 마지막 성공 이미지 버전
    └── deploy.lock            # 저장소를 가로질러 공유하는 배포 잠금
```

GitHub Actions의 **수신한 infra 설정 수동 적용**에서 `main`, 적용할 환경, 이미 수신한 전체 infra SHA 40자리를 선택합니다. `production`은 DB 백업·마이그레이션 후 API·학생·관리자를 새 구성으로 시작합니다. `shared`는 Caddy 구성을 반영하며 `development`는 개발 API 구성을 반영합니다. 지정한 환경의 배포가 성공해야 해당 `active-*` 링크를 교체합니다. 운영 적용이 성공하면 SSH 제어 스크립트의 `control`도 그 버전으로 전환합니다.

환경별로 적용하므로 Caddy 변경은 `shared`, 운영 Compose 변경은 `production`에 각각 적용합니다. 아직 적용하지 않은 환경은 기존 버전을 유지합니다. Caddy 설정 파일은 버전별 경로에서 연결하며 적용 시 Caddy를 다시 생성해 이전 파일 마운트가 남지 않게 합니다. 비밀 설정은 Git과 release 디렉터리 밖인 `~/.config/graduate-me/{production,development,shared}.env`에 유지합니다.

`images/*.env`는 최초 설치용 기록입니다. 앱 배포 때 Git에 버전 커밋을 만들지 않으며 infra 수신으로 홈서버의 실제 이미지 버전을 덮어쓰지 않습니다. 기존 개발 이미지나 Caddy 이미지의 버전을 바꾸려면 홈서버의 `state/images/<환경>.env`를 명시적으로 수정한 후 해당 환경을 수동 적용합니다. `latest`와 `configure-me`는 배포 스크립트가 거절합니다.

## 최초 연결 준비

기존 Cloudflare Tunnel·Caddy·운영 DB·비밀 설정은 유지합니다. 홈서버는 Ubuntu와 Docker Compose, `flock`, `tar`, `gzip`, OpenSSH를 사용하며 Node.js나 pnpm을 호스트에 설치할 필요가 없습니다. GitHub에서는 일반 Ubuntu runner만 사용합니다.

1. 네 저장소의 `pnpm check`와 테스트·빌드를 확인하고 변경을 커밋합니다. 재사용 workflow가 존재하도록 infra를 앱 저장소보다 먼저 push합니다. `DEPLOY_ENABLED`를 등록하기 전에는 자동 배포가 실행되지 않습니다.
2. 로컬에서 기존 개인 SSH 연결 `ssh jaejoon-server`와 `gh`의 저장소 관리 권한을 확인합니다.
3. 커밋한 infra 디렉터리에서 `bash scripts/setup-deploy.sh jaejoon-server`를 실행합니다. 이 명령은 네 저장소의 자동 배포를 비활성화한 뒤, 홈서버 디렉터리 준비와 배포 전용 SSH 키 네 개의 등록, GitHub Secrets·Variables 설정, SSH 연결 확인을 수행합니다. 컨테이너를 시작하거나 변경하지 않습니다. 개인 SSH 키는 교체하거나 GitHub에 올리지 않습니다. 재실행하면 이 도구로 만든 배포 키만 교체합니다.
4. 기존 홈서버 Compose·Caddyfile과 설치할 버전이 다르면 최초 전환을 거절합니다. 기존 운영 파일과 동일한 기준 버전으로 먼저 전환한 후 변경 버전을 수신·수동 적용합니다. 기존 `images/*.env`를 `state/images/*.env`로 복사하며 실제 실행 중인 이미지와 일치하는지 확인합니다. 이미 상태 파일이 있으면 덮어쓰지 않습니다.
5. 아래 Tailscale OIDC 인증을 등록하고 저장소별 Secrets를 채웁니다. `TS_OAUTH_CLIENT_ID`, `TS_AUDIENCE`는 개인 비밀번호가 아닌 발급된 연결 식별값입니다.
6. infra부터 `DEPLOY_ENABLED=true`로 설정합니다. infra의 `main`에 새 커밋을 push해 검사와 수신을 확인합니다. 각 앱 저장소도 활성화하고 **검사와 앱별 배포** workflow를 `main`에서 수동 실행해 최초 배포를 확인합니다. 이후에는 `main` push·merge가 배포를 시작합니다.

설정 도구는 커밋되지 않은 파일을 전송하지 않습니다. 설치 중 실패하면 `DEPLOY_ENABLED=false`를 유지하고 문제를 해결한 뒤 재실행합니다. 이 도구가 만든 개인키는 임시 디렉터리에서 생성해 각 저장소 Secret에 입력하며 작업 후 로컬 임시 사본을 지웁니다. 기존 홈서버의 루트 Compose·스크립트는 자동 삭제하지 않지만 전환 후 배포는 `active-*`를 통해 수행합니다. 이전 루트 배포 스크립트를 병행 실행하지 않습니다.

### GitHub 설정

모든 저장소에 다음 이름을 동일하게 사용하되 SSH 개인키는 저장소별로 다릅니다. 공개 저장소에서 재사용 workflow를 호출하는 구성이므로 infra의 Actions 접근 정책도 조직 내 호출을 허용해야 합니다.

| 종류 | 이름 | 값과 등록 주체 |
| --- | --- | --- |
| Variable | `DEPLOY_HOST` | 홈서버 Tailscale IPv4, 설정 도구가 등록 |
| Variable | `DEPLOY_USER` | 홈서버 Linux 계정, 설정 도구가 등록 |
| Variable | `DEPLOY_ENABLED` | 설정 도구는 `false`로 등록, 연결 확인 후 `true`로 전환 |
| Secret | `DEPLOY_SSH_KEY` | 저장소별 전용 개인키, 설정 도구가 등록 |
| Secret | `DEPLOY_KNOWN_HOSTS` | 기존 SSH 연결로 읽은 서버 공개 키, 설정 도구가 등록 |
| Secret | `TS_OAUTH_CLIENT_ID` | Tailscale에서 발급한 저장소별 OIDC Client ID |
| Secret | `TS_AUDIENCE` | 해당 OIDC 인증에 표시된 Audience |

SSH 키는 `restrict`와 강제 명령을 사용합니다. 앱 키는 자기 앱의 `deploy <SHA>`와 읽기 전용 `status`만 허용합니다. infra 키는 `sync <SHA>`, `apply <환경> <SHA>`, `status`만 허용합니다. 임의 셸·포트 포워딩·다른 앱 배포에는 사용할 수 없습니다. 배포할 수 있는 이미지는 앱 코드와 마찬가지로 운영 권한을 갖는 신뢰 대상이므로 `main` merge 권한을 배포 권한으로 관리합니다.

### Tailscale 최초 등록

Tailscale 관리자의 Trust credentials에서 GitHub Actions용 OIDC 연동을 저장소별로 만듭니다. 긴 수명의 Tailscale 비밀키를 저장하는 대신 GitHub가 실행마다 발급하는 OIDC 토큰으로 접속합니다. 발급 권한은 `Auth Keys: Write`, 태그는 `tag:graduate-me-ci`입니다.

Issuer는 `https://token.actions.githubusercontent.com`이며 Subject는 아래와 같이 `main`만 허용합니다. 네 저장소는 GitHub의 `use_immutable_subject=true` 설정을 사용하므로 조직·저장소 이름 뒤의 숫자 ID까지 포함해야 합니다. 이름만 넣은 이전 형식은 `Cannot validate subject`와 403 오류로 거절됩니다. 관리자 화면에서 발급된 Client ID와 Audience를 각각 해당 저장소의 `TS_OAUTH_CLIENT_ID`, `TS_AUDIENCE`에 등록합니다.

| 저장소 | Subject |
| --- | --- |
| 프론트 | `repo:please-graduate-me@351951192/graduate-me-frontend@1446594643:ref:refs/heads/main` |
| 백엔드 | `repo:please-graduate-me@351951192/graduate-me-backend@1446594895:ref:refs/heads/main` |
| 관리자 | `repo:please-graduate-me@351951192/graduate-me-admin@1450227319:ref:refs/heads/main` |
| infra | `repo:please-graduate-me@351951192/graduate-me-infra@1446623300:ref:refs/heads/main` |

숫자 ID나 Subject 형식을 추측하지 않고 다음처럼 저장소의 실제 설정을 조회합니다.

```sh
# 실제 Subject 앞부분에 main 브랜치 조건을 붙여 확인한다.
gh api repos/please-graduate-me/graduate-me-infra/actions/oidc/customization/sub \
  --jq '.sub_claim_prefix + ":ref:refs/heads/main"'
```

Tailscale의 인증 상세 화면에 표시되는 `Received ... from issuer`는 실제 받은 Subject입니다. 등록값과 일치하는지 확인합니다. Subject를 수정해 저장해도 지난 오류 표시는 다음 인증이 성공할 때까지 남습니다. 기존 인증의 Subject만 수정하면 Client ID와 Audience는 유지되므로 GitHub Secrets를 다시 등록하지 않습니다.

Tailscale 접근 정책에는 아래 항목을 기존 정책에 병합합니다. 전체 정책을 이 예시로 덮어쓰지 않습니다. 이 권한은 임시 runner가 홈서버 OpenSSH의 TCP 22번 포트로 접속하게 하며, Linux 로그인은 배포 전용 SSH 키가 담당합니다. Tailscale SSH 기능을 별도로 활성화할 필요는 없습니다.

```json
{
  "tagOwners": {
    "tag:graduate-me-ci": ["autogroup:admin"]
  },
  "grants": [
    {
      "src": ["tag:graduate-me-ci"],
      "dst": ["100.83.33.109"],
      "ip": ["tcp:22"]
    }
  ]
}
```

홈서버 IP가 바뀌면 이 정책과 각 저장소의 `DEPLOY_HOST`, `DEPLOY_KNOWN_HOSTS`를 함께 갱신합니다. 기존 정책에 모든 연결을 허용하는 규칙이 있으면 새 규칙만 추가해도 다른 접근이 제한되지는 않으므로 실제 허용 범위를 확인합니다.

공식 안내: [Tailscale GitHub Action](https://tailscale.com/docs/integrations/github/github-action), [OIDC 연동](https://tailscale.com/docs/features/workload-identity-federation), [GitHub 재사용 workflow](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows).

## 수동 복구와 백업

백업 위치는 `GRADUATE_ME_BACKUP_DIR`로 지정하며 기본값은 비밀 설정 디렉터리의 `backups`입니다. 앱 배포와 infra 적용은 운영 DB를 초기화하거나 볼륨을 삭제하지 않습니다. 백업 보존 기간과 별도 장치 복사, 복원 검증은 별도로 운영합니다.

실패한 배포의 이미지는 서버에 남을 수 있고 `state/images/*.env`는 마지막 성공 버전을 나타냅니다. `docker inspect`로 실제 컨테이너 이미지와 상태를 확인합니다. 이미지나 infra 버전을 되돌려도 이미 적용한 DB 마이그레이션을 자동으로 되돌리지는 않습니다. 수정한 백엔드를 다시 배포하거나 백업 복원 절차를 선택합니다. 직접 전송한 이미지와 수신한 infra 버전은 자동 삭제하지 않으므로 디스크 사용량에 맞춰 보존 정책을 정합니다.

## 팀원의 로컬 프론트와 개발 API

팀원은 홈서버 SSH나 DB 접속 권한 없이 개발 API의 HTTPS 주소를 사용합니다. 서버 API 주소를 프론트의 `API_INTERNAL_URL`에 주입하는 별도 프론트 개발용 Compose 구성이 필요합니다. 현재 앱 저장소의 기본 Compose는 로컬 API 주소로 고정되어 있습니다.

인증된 변경 요청과 로그인 후 이동은 학생 앱의 `AUTH_URL`과 명시한 `ADMIN_APP_URL`의 출처만 허용합니다. Compose는 `ADMIN_APP_URL`을 API의 `ADMIN_URL`과 학생 개발 서버의 `VITE_ADMIN_APP_URL`로 전달합니다. 정적 학생 웹은 Docker 빌드 인자 `VITE_ADMIN_APP_URL`, 관리자 웹은 빌드 인자 `VITE_STUDENT_URL`을 사용하므로 운영 컨테이너의 환경변수만 바꿔서는 링크가 갱신되지 않습니다. 로컬에서는 비워 두면 `localhost`와 `ADMIN_PORT`로 구성합니다. 사용자 인증은 `AUTH_URL`과 일치하는 출처에서만 가능하며 학교 인증 쿠키는 해당 호스트에 한정합니다. 임의 팀원 주소나 출처 전체를 허용하지 않습니다.

개발 API도 테스트 사용자와 개발 데이터만 사용하며 운영 개인정보를 복제하지 않습니다. 팀원별 임의 버전을 동시에 제공하는 환경이 아니므로 개발 API 버전은 공유됩니다.

## GitHub와 배포 권한

CI와 CD는 GitHub 제공 runner에서 실행하며 홈서버 runner는 사용하지 않습니다. PR은 검사 전용이고 배포는 `main`만 허용합니다. 네 저장소 모두 merge 권한과 배포 권한의 관계를 팀에 공유합니다. 공개 저장소의 일반 Linux runner를 사용하며 유료 runner나 이미지 저장소를 요구하지 않습니다. Tailscale의 무료 적용 조건과 임시 장치 시간을 별도로 확인합니다.

## 검증

```sh
pnpm check
pnpm check:ci
```

포맷과 ESLint 외에 모든 Compose를 실제 Docker Compose로 해석해 서비스 구성, 개발·운영 DB와 네트워크 분리, 공개 포트 제한, 홈서버의 소스 빌드 금지, 비밀값이 없는 예시를 검사합니다. 검사는 DB를 시작하거나 실제 서비스를 변경하지 않습니다. Caddy 설정 변경 시 `caddy validate`도 수행합니다.

CI는 runner 기본 설치 버전에 의존하지 않고 Docker Compose `v5.1.0`을 설치하며, 사용 버전을 로그에 남깁니다. `compose.local.yaml`의 `develop.watch.initial_sync`를 지원하지 않는 버전에서는 `additional properties 'initial_sync' not allowed` 오류로 검사가 실패합니다. 같은 오류가 발생하면 `docker compose version`을 확인하고 CI와 동일한 버전으로 맞춥니다.

참고: [Compose 운영 구성](https://docs.docker.com/compose/how-tos/production/), [Compose 환경변수 파일](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/), [Caddy 환경변수](https://caddyserver.com/docs/caddyfile/concepts), [GitHub 재사용 workflow](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows).

## 로컬 시작 시 수행하는 작업

API는 DB 마이그레이션 후 시작하며 초기 영상, 추천 영상 레코드, 분석 작업과 데모 자료를 생성하지 않습니다. 데모 자료는 별도 준비 후 DB에 넣습니다. 기존 DB의 데이터와 대기 작업은 유지되므로 worker는 이미 등록된 작업을 처리할 수 있습니다.

API 서버와 worker는 같은 백엔드 저장소의 서로 다른 프로세스입니다. API는 HTTP 요청과 인증·저장을 담당하고 worker는 DB 큐의 영상 분석을 처리합니다. 영상 분석 중에도 API가 요청을 받을 수 있도록 나눕니다.

관리자 웹은 로컬 통합 실행에 포함되며 `http://api:4000`으로 프록시합니다. 홈서버에서는 `state/images/production.env`의 관리자 이미지를 별도 `admin.pleasegraduate.me` 호스트의 루트 경로로 제공합니다.

## worker를 중지한 MVP 운영 배포

운영 관리자 앱은 `https://admin.pleasegraduate.me/`에서 제공합니다. `production.env`의 `ADMIN_APP_URL`에도 이 주소를 지정하고 `shared.env`의 `ADMIN_DOMAIN=admin.pleasegraduate.me`를 설정합니다. 관리자 이미지는 `docker build --platform linux/amd64 --build-arg ADMIN_BASE_PATH=/ --build-arg VITE_STUDENT_URL=https://app.pleasegraduate.me`로 빌드합니다. 학생 도메인의 기존 `/admin`과 `/admin/*` 주소는 관리자 호스트의 대응 경로로 리디렉션합니다.

Cloudflare Tunnel의 관리자 Published application route는 서비스 `HTTP`, URL `127.0.0.1:8080`으로 연결하고 HTTP Host Header는 덮어쓰지 않습니다. Caddy가 호스트로 학생·관리자를 분기하며 각 호스트의 `/api`는 같은 운영 API에 전달합니다. 사용자 웹은 학교 이메일 인증 코드를 사용하고 운영 콘솔은 독립 아이디·비밀번호 세션을 사용합니다. Google OAuth 콜백 등록은 필요하지 않습니다. 운영 콘솔은 아래 운영자 인증 변경 절을 따릅니다.

자동 배포와 infra 수동 적용은 worker를 시작하지 않습니다. 백엔드 배포와 운영 infra 적용은 기존 worker를 중지하고 DB 백업·마이그레이션을 수행합니다. 영상 worker를 시작하려면 별도의 명시적인 운영 요청이 필요합니다.

MVP 비밀 설정에는 `MATERIAL_POLICY_PROFILE=mvp`, `AI_PROVIDER=anthropic`, `OCR_PROVIDER=anthropic`, `ANTHROPIC_MODEL=claude-sonnet-5-5`, `VIDEO_TRANSCRIPTION_PROVIDER=disabled`를 명시합니다. 운영 기본값은 이 설정을 대신하지 않습니다.

## 요청 로그와 학생 화면 단독 배포

운영 API의 요청 로그는 `ssh jaejoon-server 'docker logs -f --tail 100 graduate-me-production-api-1'`로 조회합니다. 각 완료 요청은 한국 시각(`+09:00`)·서버 요청 ID·HTTP 메서드·라우트 패턴·상태·소요 시간·안전한 오류 코드만 기록합니다. 원문·요청 본문·쿼리·쿠키·키·IP는 API 요청 로그에 기록하지 않습니다. 관리자 `/usage`는 AI 실행 원장과 영상 처리 이력이며 전체 HTTP 로그 화면과 구분합니다.

학생 웹 저장소의 자동 배포는 실행 중 API가 healthy이고 설정 해시가 일치하는지 먼저 검사하고 학생 컨테이너만 갱신합니다. DB 백업·마이그레이션·API 중단은 수행하지 않으며 worker도 시작하지 않습니다. API 설정이나 스키마를 바꾸면 백엔드 배포 또는 infra 수동 적용의 백업·마이그레이션 경로를 사용합니다.

## 운영자 인증 변경

운영 콘솔은 Google 로그인 대신 `ADMIN_LOGIN_ID`와 `ADMIN_PASSWORD_HASH`를 사용합니다. 기존 `ADMIN_EMAILS`는 운영 권한을 부여하지 않습니다. 사용자 웹은 학교 이메일 인증을 사용합니다. Google 인증 설정과 콜백 등록은 사용하지 않습니다.

백엔드 저장소에서 `pnpm admin:password`로 해시를 생성하고, 통합 로컬 `.env` 또는 환경별 비밀 파일에 아이디와 해시를 설정합니다. 해시는 `$` 확장을 피하도록 작은따옴표로 감쌉니다. 실제 값은 Git에 기록하지 않습니다. 아이디·해시 변경은 기존 운영 세션을 무효화합니다.

조교는 사용자 웹의 프로필 타이틀과 커뮤니티 태그 기능을 사용합니다. 관리자 콘솔의 조교 메뉴는 이 자격만 부여·회수합니다. 수업 관리도 사용자 웹에서 수행하며 기존 비공개 질문은 공개 게시글로 자동 전환하지 않습니다.

## 학교 이메일 인증 메일

Resend SMTP로 `noreply@pleasegraduate.me`에서 인증 메일을 보냅니다. API 환경 기본값은 `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER=resend`, `AUTH_EMAIL_FROM=noreply@pleasegraduate.me`입니다. `SMTP_PASSWORD`에는 Resend API 키, `AUTH_SECRET`에는 32자 이상의 무작위 비밀값을 주입합니다. 키는 `.env` 또는 서버 비밀 설정에만 보관하며 worker와 브라우저에 전달하지 않습니다.

Resend에서 `pleasegraduate.me`를 추가하고 도메인 화면의 SPF·DKIM 레코드로 DNS 인증을 완료해야 합니다. DNS 값은 Resend가 실제 도메인에 제시한 값을 그대로 사용합니다. 기존 수신용 루트 MX를 바꾸지 않고, Resend가 제시한 발송·반송용 MX가 있으면 안내한 서브도메인에 추가합니다. `noreply` 메일함 생성은 필요하지 않습니다. API 키는 가능하면 `pleasegraduate.me` 발송 권한으로 제한합니다. SMTP 비밀번호가 없으면 메일을 보내지 않으며 다른 발신 주소는 백엔드가 거부합니다. [Resend SMTP 안내](https://resend.com/docs/send-with-smtp), [도메인 인증 안내](https://resend.com/docs/dashboard/domains/introduction)를 따릅니다.

배포 전 백엔드의 `1800000002300-school-email-auth` 마이그레이션을 적용해야 합니다. 이후 학생은 `@hufs.ac.kr`로 받은 6자리 인증 코드로 로그인합니다. 같은 이메일의 기존 학습 계정은 유지하며 기존 Google 쿠키는 사용할 수 없습니다. 실제 SMTP 발송 검증은 명시적으로 요청받았을 때만 수행합니다.

## 랜딩과 서비스 도메인 분리

랜딩은 `pleasegraduate.me`의 Cloudflare Pages, 학생 앱은 `app.pleasegraduate.me`의 홈서버 Tunnel, 관리자는 `admin.pleasegraduate.me`를 사용합니다. 랜딩 저장소 `../graduate-me-landing`은 홈서버 Compose에 포함하지 않습니다. 정적 산출물은 `out/`이며 공개 서비스 URL은 빌드 시 `NEXT_PUBLIC_APP_URL=https://app.pleasegraduate.me`로 확정합니다.

홈서버 `production.env`의 `AUTH_URL`과 `shared.env`의 `PRODUCTION_DOMAIN`은 함께 새 앱 주소로 바꿔야 합니다. 예시 파일만 바꿔서는 현재 운영 설정이 변경되지 않습니다. 학생과 관리자는 각 호스트의 `/api`를 이용하며, 랜딩은 API와 인증 쿠키를 사용하지 않습니다. 발신 주소와 Resend DNS는 `noreply@pleasegraduate.me` 기준을 유지합니다.

웹 상태 검사는 운영 Nginx의 `/healthz`를 `wget`으로 확인하고, 최초 전환 중 기존 Node.js 이미지가 남아 있으면 `/api/health`를 Node.js로 검사합니다. 로컬 Vite 개발 서버는 Node.js로 `/`를 확인합니다. API 상태는 별도의 API healthcheck가 검사합니다.

실제 전환 순서와 Cloudflare 화면별 입력값, 기존 연결 복구 절차는 [도메인 전환 안내](docs/domain-cutover.md)를 따릅니다. 현재 단계는 코드·설정 준비이며, 원격 저장소 생성·push·배포·DNS·서버 비밀 파일 변경을 실행하지 않습니다.
