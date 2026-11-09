# graduate-me-infra

사용자 웹, 관리자 웹과 백엔드를 함께 실행하고 홈서버의 개발·운영 환경을 관리하는 저장소입니다. 앱 소스와 Dockerfile은 각 앱 저장소에 유지합니다. 실제 비밀값과 DB 데이터는 Git에 저장하지 않습니다.

## 파일과 책임

| 파일 | 용도 |
| --- | --- |
| `compose.yaml` + `compose.local.yaml` | 개발자 PC에서 모든 서비스를 함께 실행하고 소스 변경 반영 |
| `compose.development.yaml` | 홈서버의 개발 API, worker, 개발 PostgreSQL |
| `compose.production.yaml` | 홈서버의 운영 프론트, API, worker, 운영 PostgreSQL |
| `compose.shared.yaml` | 공용 Caddy와 환경별 진입 네트워크 |
| `Caddyfile` | Tunnel 내부 HTTP 요청을 운영 웹과 개발 API로 전달 |
| `images/*.env` | 실제 배포할 이미지 버전 기록, 비밀값 없음 |
| `env/*.env.example` | 환경별 비밀 설정의 빈 양식 |
| `.github/workflows/check.yaml` | GitHub 제공 runner에서 인프라 구성 검사 |
| `.github/workflows/deploy.yaml` | 홈서버 전용 runner에서 선택한 환경 수동 배포 |

`development`는 팀원이 사용하는 홈서버의 개발 API입니다. 개인 PC에서 전체 스택을 실행하는 `local`과 다릅니다. 운영 프론트만 홈서버에 두고, 프론트 개발자는 로컬 개발 서버를 사용합니다.

## 로컬 전체 실행

```text
codding/
├── graduate-me-infra/
├── graduate-me-frontend/
├── graduate-me-admin/
└── graduate-me-backend/
```

Node.js 22, pnpm 10.33.0, Docker Compose가 필요합니다. 기존 저장소의 코드를 직접 참조하는 곳은 Docker 빌드 컨텍스트와 소스 감시뿐입니다.

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

사용자 웹은 `http://localhost:3000`, 관리자 웹은 `http://localhost:3001`, API는 `http://localhost:4000`입니다. DB 포트는 로컬의 `15432`입니다. 이 포트들은 모두 `127.0.0.1`에만 연결합니다.

기존 개별 Compose에서 전환할 때는 해당 파일 감시와 컨테이너를 먼저 종료합니다. 각 앱 폴더의 `docker compose -f compose.yaml -f compose.dev.yaml down`을 사용합니다. 볼륨 삭제 옵션은 사용하지 않습니다.

기존 DB를 이어 쓰려면 `.env`에 `LOCAL_POSTGRES_VOLUME=graduate-me_postgres_data`를 설정합니다. 새 환경은 기본적으로 `graduate-me-local_postgres_data`를 사용합니다. 한 볼륨에 PostgreSQL 두 개를 동시에 실행하지 않습니다. 기존 Compose와 통합 Compose를 같은 포트로 함께 실행하지 않습니다.

## 홈서버 구성

홈서버는 Ubuntu 24.04의 Intel 맥미니이며 `linux/amd64` 이미지를 사용합니다. SSH 관리는 Tailscale의 `ssh jaejoon-server`로 접속합니다. 재부팅 후 Docker와 cloudflared가 자동으로 시작되는지 확인합니다. GitHub의 Linux runner에서 빌드하고 홈서버는 이미지를 실행하는 역할만 맡깁니다.

- 운영: 프론트 1개, API 1개, worker 1개, PostgreSQL 1개
- 개발: API 1개, worker 1개, PostgreSQL 1개
- 공용: Caddy 1개

개발과 운영의 DB 컨테이너, 볼륨, 내부 네트워크를 분리했습니다. DB에는 호스트 공개 포트가 없습니다. Caddy는 호스트의 `127.0.0.1:8080`에만 연결합니다. 홈서버의 cloudflared 서비스가 이 주소로 요청을 전달하며 공유기 포트 포워딩은 사용하지 않습니다. 공개 HTTPS는 Cloudflare에서 처리하고 Tunnel 뒤 Caddy는 HTTP로 실행합니다. 인증 콜백과 보안 쿠키가 HTTPS를 기준으로 동작하도록 Caddy가 업스트림에 `X-Forwarded-Proto: https`를 전달합니다. DB 내부 네트워크는 외부 연결을 차단하고, API와 worker는 각각 필요한 네트워크에 추가로 연결합니다.

공급자 설정은 로컬 `graduate-me-infra/.env`, 홈서버 `development.env` 또는 `production.env`에서 관리합니다. 일반 AI는 `AI_PROVIDER=anthropic|naver`, OCR은 `OCR_PROVIDER=anthropic|clova`로 독립 선택합니다. 공급자를 변경할 때 해당 공급자의 키와 모델도 함께 설정합니다. 자동으로 다른 공급자로 전환하지 않습니다.

로컬과 개발 환경 기본값은 `AI_PROVIDER=anthropic`, `OCR_PROVIDER=anthropic`, `ANTHROPIC_MODEL=claude-sonnet-5-5`입니다. `.env`에 `ANTHROPIC_API_KEY`를 설정하면 API와 영상 번역·빈칸 준비를 담당하는 worker에만 주입됩니다. 학생 웹·관리자 웹·공용 gateway에는 공급자 키를 전달하지 않습니다. 키를 비워도 저장된 자료와 결과를 조회할 수 있습니다. 운영 기본값은 기존 Naver·CLOVA OCR 설정을 유지합니다.

Naver로 전환할 때는 `CLOVA_STUDIO_API_KEY`, `CLOVA_TEXT_MODEL=HCX-007`, `CLOVA_IMAGE_MODEL=HCX-005`, `CLOVA_STUDIO_BASE_URL`을 설정합니다. CLOVA OCR은 `CLOVA_OCR_INVOKE_URL`, `CLOVA_OCR_SECRET_KEY`, 선택적인 `OCR_ESTIMATED_USD_PER_PAGE`를 API 서버에만 주입합니다. CLOVA OCR은 영어, Claude OCR은 영어·태국어 경로를 제공합니다. Claude OCR에는 토큰 단가를 적용하고 페이지 단가를 중복 적용하지 않습니다.

새 영상 전사는 `VIDEO_TRANSCRIPTION_PROVIDER=gemini|disabled`로 제어합니다. 로컬·개발 기본값인 `disabled`에서는 준비된 영상은 재사용하고 새 분석은 접수하지 않습니다. Claude로 YouTube 영상 전사를 대체하지 않습니다. 운영 기본값은 `gemini`이며 `GEMINI_API_KEY`, `YOUTUBE_API_KEY`, `GEMINI_MODEL`은 worker에만 주입합니다. 별도 허가 없이 worker를 시작하거나 실제 모델을 호출하지 않습니다.

`AI_DAILY_REQUEST_LIMIT`, `AI_DAILY_TOKEN_LIMIT`, `AI_CONCURRENT_REQUEST_LIMIT`는 계정별 UTC 한도이며 `AI_PREPARATION_PAGE_LIMIT`는 PDF 최초 준비 페이지 수입니다. `AI_DAILY_BUDGET_USD=0`은 추정 비용 제한을 끕니다. 비용 제한을 켜려면 선택한 공급자의 `AI_ANTHROPIC_*_USD_PER_MILLION`, `AI_NAVER_*_USD_PER_MILLION`, `AI_GEMINI_*_USD_PER_MILLION` 입력·출력 단가를 설정합니다. 단가 미설정 비용과 실청구 비용은 미집계로 표시합니다. 검증에는 모의 응답을 사용합니다.

초기 메모리 제한은 환경별 DB 1GiB, API·worker 각각 768MiB, 운영 프론트 1GiB, Caddy 256MiB입니다. 실제 동시 요청으로 측정해 조정해야 하며 Docker VM과 호스트 OS의 여유도 필요합니다.

## 홈서버 설정과 최초 배포

홈서버 SSH 주소는 `jaejoon-server`, 운영 도메인은 `pleasegraduate.me`, 개발 API 도메인은 `dev-api.pleasegraduate.me`입니다. 실제 이미지 버전과 배포 runner는 별도로 준비해야 합니다. `configure-me` 이미지 값이 남아 있으면 배포 스크립트가 중단됩니다. 이 저장소를 만드는 것만으로 운영 서비스가 배포되지는 않습니다.

1. Cloudflare에서 도메인을 활성화하고 `graduate-me` Tunnel을 생성합니다. 홈서버에 Linux amd64용 cloudflared를 서비스로 설치합니다. Published application route에서 `pleasegraduate.me`와 `dev-api.pleasegraduate.me`를 각각 `http://127.0.0.1:8080`에 연결합니다. Caddy의 호스트별 분기를 위해 HTTP Host Header를 별도 주소로 덮어쓰지 않습니다. Tunnel이 DNS 레코드를 만들므로 홈서버 공인 IP를 가리키는 A 레코드는 필요하지 않습니다. 토큰은 서버에서만 사용하고 Git에 넣지 않습니다.
2. 홈서버에 저장소 밖의 비밀 설정 디렉터리를 만들고 접근 권한을 제한합니다. `env/shared.env.example`, `env/development.env.example`, `env/production.env.example`을 각각 `shared.env`, `development.env`, `production.env`로 복사해 채웁니다.
3. DB 비밀번호와 AUTH_SECRET은 환경별로 `openssl rand -hex 32`로 생성합니다. DB 비밀번호는 연결 URL에서 사용하므로 이 형식을 유지합니다. OAuth 클라이언트도 환경별로 나눕니다. 초기화 후 DB 비밀번호 변경은 PostgreSQL 계정 변경 절차가 별도로 필요합니다.
4. GitHub 이미지 빌드에서 생성한 실제 커밋 태그나 digest를 `images/*.env`에 기록하고 커밋합니다. 백엔드 이미지 하나를 API와 worker가 서로 다른 시작 명령으로 사용합니다.
5. runner를 실행할 사용자로 GHCR 읽기 인증을 설정합니다. 인증 정보는 Git에 넣지 않습니다.
6. `GRADUATE_ME_ENV_DIR`에 비밀 설정 디렉터리의 절대 경로를 지정하고 아래 순서로 배포합니다.

```sh
export GRADUATE_ME_ENV_DIR=/실제/비밀설정/경로
bash scripts/deploy.sh shared
bash scripts/deploy.sh development
bash scripts/deploy.sh production
```

비밀 설정 파일에는 해당 예시의 키만 넣습니다. 이미지 버전은 `images/*.env`에서 관리합니다. 운영 `AUTH_URL`은 `https://pleasegraduate.me`로 설정합니다. Google OAuth 리디렉션 URI는 `https://pleasegraduate.me/api/auth/callback/google`로 등록합니다. 운영 프론트는 내부 운영 API만 사용합니다.

배포 스크립트는 이미지 다운로드, DB 기동, API·worker 및 운영 웹 중단, DB 백업, 마이그레이션, 서비스 시작과 상태 확인을 순서대로 수행합니다. 짧은 중단 시간이 있으며 무중단 배포를 제공하지 않습니다. 마이그레이션에 실패하면 앱은 중단된 상태로 남겨 원인을 확인하게 합니다. 운영에서 `down -v`를 실행하지 않습니다.

백업 위치는 `GRADUATE_ME_BACKUP_DIR`로 지정하며 기본값은 비밀 설정 디렉터리의 `backups`입니다. 정기 백업, 별도 장치로의 복사, 보존 기간과 복원 검증은 실제 운영 전 추가해야 합니다. 이미지 버전을 되돌려도 DB 마이그레이션은 자동으로 되돌아가지 않습니다.

## 운영 데모만 배포

로그인과 신규 영상 처리를 사용하지 않을 때는 Caddy, 운영 프론트, 운영 API와 운영 DB만 실행합니다. 개발 환경, worker는 시작하지 않습니다. 운영 환경변수의 Google OAuth 항목은 비워 둡니다. 데모 자료는 별도로 준비해 DB에 넣으며 배포 과정에서 자동 등록하지 않습니다.

외부 빌드 장비에서 검증한 `linux/amd64` 이미지를 `docker save`와 `docker load`로 서버에 전달한 경우, 이미지 파일에 전달된 이미지의 digest를 기록하고 다음처럼 실행합니다.

```sh
bash scripts/deploy.sh shared --demo --local-images
bash scripts/deploy.sh production --demo --local-images
```

`--local-images`는 레지스트리 다운로드만 생략합니다. DB 백업, 마이그레이션과 상태 확인은 그대로 수행합니다. 로그인과 신규 처리를 공개하기 전에는 OAuth와 환경별 CLOVA·Gemini·YouTube 키 설정을 완료해야 합니다.

## 팀원의 로컬 프론트와 개발 API

팀원은 홈서버 SSH나 DB 접속 권한 없이 개발 API의 HTTPS 주소를 사용합니다. 서버 API 주소를 프론트의 `API_INTERNAL_URL`에 주입하는 별도 프론트 개발용 Compose 구성이 필요합니다. 현재 앱 저장소의 기본 Compose는 로컬 API 주소로 고정되어 있습니다.

인증된 변경 요청과 로그인 후 이동은 학생 앱의 `AUTH_URL`과 명시한 `ADMIN_APP_URL`의 출처만 허용합니다. Compose는 `ADMIN_APP_URL`을 API의 `ADMIN_URL`과 학생 웹의 `ADMIN_APP_URL`로 각각 전달합니다. 로컬에서는 비워 두면 `localhost`와 `ADMIN_PORT`로 구성합니다. 별도 호스트를 사용하는 경우 OAuth 콜백과 쿠키 공유 범위는 실제 배포 도메인에 맞춰 확인해야 합니다. 임의 팀원 주소나 출처 전체를 허용하지 않습니다.

개발 API도 테스트 사용자와 개발 데이터만 사용하며 운영 개인정보를 복제하지 않습니다. 팀원별 임의 버전을 동시에 제공하는 환경이 아니므로 개발 API 버전은 공유됩니다.

## GitHub와 배포 권한

이 저장소는 비공개로 만들고 배포 담당자만 쓰기 권한을 갖도록 설정합니다. 조직의 기본 권한과 팀 권한도 확인해야 합니다. 앱 저장소의 협업 권한과 별도로 관리합니다.

CI는 PR과 `main` 변경 때 GitHub 제공 runner에서 실행됩니다. CD는 `main`에서 수동 실행하는 workflow를 제공합니다. `self-hosted`, `graduate-me-deploy` 라벨의 홈서버 runner가 필요합니다. 이 runner는 이 저장소에만 연결하고 앱 PR 코드의 검사나 빌드에는 사용하지 않습니다. 배포들은 하나의 concurrency 그룹으로 순차 실행됩니다.

GitHub 저장소 Variables에 `GRADUATE_ME_ENV_DIR`와 필요하면 `GRADUATE_ME_BACKUP_DIR`를 설정합니다. 값은 홈서버의 절대 경로이며 실제 비밀값은 아닙니다. workflow는 환경별 비밀 파일을 홈서버에서 읽습니다.

앱 저장소의 이미지 빌드·GHCR 업로드 workflow, 개발 이미지 자동 승격, 홈서버 runner 등록은 아직 별도 작업입니다. 현재 CD는 배포 버전을 이 저장소에 기록한 후 수동 실행하는 방식입니다. GitHub 요금제에 따라 내장 승인 기능이 달라도 저장소 쓰기 권한으로 배포 담당자를 제한할 수 있습니다.

## 검증

```sh
pnpm check
pnpm check:ci
```

포맷과 ESLint 외에 모든 Compose를 실제 Docker Compose로 해석해 서비스 구성, 개발·운영 DB와 네트워크 분리, 공개 포트 제한, 홈서버의 소스 빌드 금지, 비밀값이 없는 예시를 검사합니다. 검사는 DB를 시작하거나 실제 서비스를 변경하지 않습니다. Caddy 설정 변경 시 `caddy validate`도 수행합니다.

참고: [Compose 운영 구성](https://docs.docker.com/compose/how-tos/production/), [Compose 환경변수 파일](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/), [Caddy 환경변수](https://caddyserver.com/docs/caddyfile/concepts), [GitHub self-hosted runner](https://docs.github.com/en/actions/reference/runners/self-hosted-runners).

## 로컬 시작 시 수행하는 작업

API는 DB 마이그레이션 후 시작하며 초기 영상, 추천 영상 레코드, 분석 작업과 데모 자료를 생성하지 않습니다. 데모 자료는 별도 준비 후 DB에 넣습니다. 기존 DB의 데이터와 대기 작업은 유지되므로 worker는 이미 등록된 작업을 처리할 수 있습니다.

API 서버와 worker는 같은 백엔드 저장소의 서로 다른 프로세스입니다. API는 HTTP 요청과 인증·저장을 담당하고 worker는 DB 큐의 영상 분석을 처리합니다. 영상 분석 중에도 API가 요청을 받을 수 있도록 나눕니다.

관리자 웹은 로컬 통합 실행에 포함되며 `http://api:4000`으로 프록시합니다. 홈서버 구성은 기존 배포 구성을 유지하며 관리자 웹의 운영 도메인·이미지 등록은 별도로 설정합니다.
