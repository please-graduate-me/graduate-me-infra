# graduate-me-infra

프론트엔드, 백엔드, 음성 처리기를 함께 실행하고 홈서버의 개발·운영 환경을 관리하는 저장소입니다. 앱 소스와 Dockerfile은 각 앱 저장소에 유지합니다. 실제 비밀값과 DB 데이터는 Git에 저장하지 않습니다.

## 파일과 책임

| 파일 | 용도 |
| --- | --- |
| `compose.yaml` + `compose.local.yaml` | 개발자 PC에서 모든 서비스를 함께 실행하고 소스 변경 반영 |
| `compose.development.yaml` | 홈서버의 개발 API, worker, 개발 PostgreSQL |
| `compose.production.yaml` | 홈서버의 운영 프론트, API, worker, 운영 PostgreSQL |
| `compose.shared.yaml` | 공용 Caddy와 audio-processor, 환경 간 연결 네트워크 |
| `Caddyfile` | 운영 웹과 개발 API의 HTTPS 진입점 |
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
├── graduate-me-backend/
└── audio-processor/
```

Node.js 22, pnpm 10.33.0, Docker Compose가 필요합니다. 기존 저장소의 코드를 직접 참조하는 곳은 Docker 빌드 컨텍스트와 소스 감시뿐입니다.

```sh
pnpm install --frozen-lockfile
test -f .env || cp .env.example .env
# .env에 인증 정보, 음성 API 키와 32자 이상의 PROCESSOR_API_TOKEN을 설정합니다.
pnpm dev
```

`pnpm dev` 한 번으로 웹, API, DB, worker, 음성 처리기를 실행하고 코드 변경을 반영합니다. 백그라운드 실행만 필요하면 `pnpm dev:up`을 사용합니다. 이 명령은 파일 감시를 켜지 않으므로 필요한 경우 아래 명령을 별도 터미널에서 실행합니다.

```sh
docker compose -f compose.yaml -f compose.local.yaml watch --no-up
pnpm dev:logs
pnpm dev:down
```

웹은 `http://localhost:3000`, API는 `http://localhost:4000`, 처리기 상태는 `http://localhost:8000/health`입니다. DB 포트는 로컬의 `15432`입니다. 이 포트들은 모두 `127.0.0.1`에만 연결합니다.

기존 개별 Compose에서 전환할 때는 해당 파일 감시와 컨테이너를 먼저 종료합니다. 각 앱 폴더의 `docker compose -f compose.yaml -f compose.dev.yaml down`, 처리기의 `docker compose down`을 사용합니다. 볼륨 삭제 옵션은 사용하지 않습니다.

기존 DB를 이어 쓰려면 `.env`에 `LOCAL_POSTGRES_VOLUME=graduate-me_postgres_data`를 설정합니다. 새 환경은 기본적으로 `graduate-me-local_postgres_data`를 사용합니다. 한 볼륨에 PostgreSQL 두 개를 동시에 실행하지 않습니다. 기존 Compose와 통합 Compose를 같은 포트로 함께 실행하지 않습니다.

## 홈서버 구성

Intel 맥미니에서는 `linux/amd64` 이미지를 사용합니다. macOS를 유지하는 경우 지원되는 Docker Desktop 버전, 재부팅 후 Docker 및 runner의 시작, 절전 해제를 확인해야 합니다. GitHub의 Linux runner에서 빌드하고 홈서버는 이미지를 실행하는 역할만 맡깁니다.

- 운영: 프론트 1개, API 1개, worker 1개, PostgreSQL 1개
- 개발: API 1개, worker 1개, PostgreSQL 1개
- 공용: Caddy 1개, 음성 처리기 1개

개발과 운영의 DB 컨테이너, 볼륨, 내부 네트워크를 분리했습니다. DB와 처리기에는 호스트 공개 포트가 없습니다. Caddy만 80/443 포트를 공개합니다. DB 내부 네트워크는 외부 연결을 차단하고, API와 worker는 각각 필요한 네트워크에 추가로 연결합니다.

공용 처리기는 개발·운영의 처리기 연결용 네트워크에 각각 참여합니다. 두 환경의 토큰을 처리기와 같게 설정해야 하며 동시 처리 수는 기본 1입니다. 개발 작업도 운영과 동일한 처리 슬롯과 외부 API 사용량을 소비합니다. 처리기 업데이트는 양쪽에 영향을 주므로 검증한 버전만 올립니다. 이 구성은 단일 물리 서버 장애를 분리하지 않습니다.

초기 메모리 제한은 환경별 DB 1GiB, API·worker 각각 768MiB, 운영 프론트 1GiB, 처리기 3GiB, Caddy 256MiB입니다. 실제 동시 요청으로 측정해 조정해야 하며 Docker VM과 호스트 OS의 여유도 필요합니다.

## 홈서버 설정과 최초 배포

현재 홈서버 주소, 도메인, 실제 이미지와 runner는 설정되지 않았습니다. `configure-me` 이미지 값이 남아 있으면 배포 스크립트가 중단됩니다. 이 저장소를 만드는 것만으로 운영 서비스가 배포되지는 않습니다.

1. 실제 도메인 두 개와 홈서버까지 연결되는 HTTPS 진입 경로를 준비합니다. 기본 Caddy 구성은 80/443 연결이 가능해야 합니다. 포트 포워딩이 불가능한 네트워크라면 터널 방식으로 구성을 변경해야 합니다.
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

비밀 설정 파일에는 해당 예시의 키만 넣습니다. 이미지 버전은 `images/*.env`에서 관리합니다. 운영 `AUTH_URL`은 `https://운영도메인`과 일치해야 합니다. 운영 프론트는 내부 운영 API만 사용합니다.

배포 스크립트는 이미지 다운로드, DB 기동, API·worker 및 운영 웹 중단, DB 백업, 마이그레이션·seed, 서비스 시작과 상태 확인을 순서대로 수행합니다. 짧은 중단 시간이 있으며 무중단 배포를 제공하지 않습니다. 마이그레이션에 실패하면 앱은 중단된 상태로 남겨 원인을 확인하게 합니다. 운영에서 `down -v`를 실행하지 않습니다.

백업 위치는 `GRADUATE_ME_BACKUP_DIR`로 지정하며 기본값은 비밀 설정 디렉터리의 `backups`입니다. 정기 백업, 별도 장치로의 복사, 보존 기간과 복원 검증은 실제 운영 전 추가해야 합니다. 이미지 버전을 되돌려도 DB 마이그레이션은 자동으로 되돌아가지 않습니다.

## 팀원의 로컬 프론트와 개발 API

팀원은 홈서버 SSH나 DB 접속 권한 없이 개발 API의 HTTPS 주소를 사용합니다. 서버 API 주소를 프론트의 `API_INTERNAL_URL`에 주입하는 별도 프론트 개발용 Compose 구성이 필요합니다. 현재 앱 저장소의 기본 Compose는 로컬 API 주소로 고정되어 있습니다.

현재 백엔드의 인증된 변경 요청은 `Origin`과 `AUTH_URL`이 정확히 일치해야 합니다. 따라서 API 주소만 원격 개발 서버로 바꾼다고 로컬 프론트의 로그인·저장까지 바로 동작하지 않습니다. 개발 환경의 허용 출처, OAuth 리디렉션, 쿠키와 프록시 전달을 실제 도메인에서 검증하고 앱에 반영해야 합니다. 운영의 출처 검증을 해제하는 방식으로 해결하지 않습니다. 이 작업은 아직 포함하지 않았습니다.

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
