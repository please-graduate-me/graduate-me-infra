# 랜딩과 서비스 도메인 전환

이 문서는 실제 배포 시 실행할 절차다. 파일을 추가하거나 예시를 수정한 것만으로 홈서버·DNS·Cloudflare Pages가 변경되지는 않는다. 학생 앱을 먼저 확인하고 루트 도메인을 마지막에 전환한다.

## 목표

| 주소 | 연결 대상 | 역할 |
| --- | --- | --- |
| `pleasegraduate.me` | 새 랜딩 Pages 프로젝트 | 소개와 정적 체험 |
| `app.pleasegraduate.me` | 기존 Tunnel → `http://127.0.0.1:8080` → Caddy | 학생 서비스와 `/api` |
| `admin.pleasegraduate.me` | 기존 Tunnel → Caddy | 관리자 서비스와 `/api` |
| `dev-api.pleasegraduate.me` | 기존 Tunnel → Caddy | 개발 API용 서버 설정 유지 |

2026-11-18 홈서버의 공개 설정을 조회했을 때 `production.env`의 `AUTH_URL=https://pleasegraduate.me`, `shared.env`의 `PRODUCTION_DOMAIN=pleasegraduate.me`였다. 새 값은 아래 표에 정리한다. 비밀값은 이 문서에 기록하지 않는다.

같은 날 Chrome에서 확인한 `graduate-me` 터널은 정상이며 공개 경로는 루트와 `admin` 두 개였다. 두 경로의 서비스는 `http://127.0.0.1:8080`, 추가 설정은 기본값이다. DNS에는 루트·admin의 터널 연결과 Resend용 `rsend`, `send`, `resend._domainkey` 세 레코드가 있다. `app` DNS와 경로는 아직 없고 랜딩 Pages 프로젝트도 아직 없다. `dev-api`는 서버 예시와 설정만 확인했으며 해당 계정 DNS·터널 경로에는 표시되지 않았다. 이번 전환에서 새 개발 API를 공개하지 않는다.

## 코드와 이미지 준비

- 자동 배포가 켜져 있다면 앱 코드를 `main`에 push할 때 배포가 시작될 수 있다. 한 번에 전환할 준비가 되기 전에는 push·workflow 실행을 하지 않는다. 필요하면 배포 작업에서 `DEPLOY_ENABLED`를 조정한다.
- frontend·backend·admin 이미지와 새 infra를 함께 준비한다. 기존 Next.js 이미지와 새 Nginx 상태 검사를 섞어서 배포하지 않는다. 기존 infra의 Node.js 상태 검사로 새 Nginx 이미지만 단독 배포하는 것도 실패한다.
- 이미지는 기존 배포 방식대로 GitHub의 Linux runner 등 홈서버 외부에서 `linux/amd64`로 빌드한다. 커밋 SHA를 태그와 revision label에 기록한다. 홈서버에서는 빌드하지 않는다.
- frontend 빌드 인자: `VITE_ADMIN_APP_URL=https://admin.pleasegraduate.me`.
- admin 빌드 인자: `ADMIN_BASE_PATH=/`, `VITE_STUDENT_URL=https://app.pleasegraduate.me`.
- 랜딩은 `pnpm build`, 출력 `out`, `NEXT_PUBLIC_APP_URL=https://app.pleasegraduate.me`다. 먼저 임시 `*.pages.dev` 주소로 확인한다. 새 원격 저장소와 Pages 프로젝트는 아직 생성하지 않았다. Git 연동 대신 Direct Upload를 선택하면 정적 산출물을 직접 올릴 수 있다.

## 홈서버 설정과 앱 적용

배포 직전 두 환경 파일을 권한 600으로 별도 백업하고 필요한 공개 항목만 편집한다. 파일 내용 전체를 채팅이나 로그로 출력하지 않는다. SMTP 비밀번호, DB 비밀번호, 인증 비밀값 등 기존 항목은 유지한다.

| 파일 | 항목 | 전환 값 |
| --- | --- | --- |
| `~/.config/graduate-me/production.env` | `AUTH_URL` | `https://app.pleasegraduate.me` |
| `~/.config/graduate-me/production.env` | `ADMIN_APP_URL` | `https://admin.pleasegraduate.me/` |
| `~/.config/graduate-me/production.env` | `AUTH_EMAIL_FROM` | `noreply@pleasegraduate.me` 유지 |
| `~/.config/graduate-me/shared.env` | `PRODUCTION_DOMAIN` | `app.pleasegraduate.me` |
| `~/.config/graduate-me/shared.env` | `ADMIN_DOMAIN` | 기존 유지 |
| `~/.config/graduate-me/shared.env` | `DEVELOPMENT_API_DOMAIN` | 기존 유지 |

새 이미지와 infra는 같은 전환 작업에서 적용한다. 기존 운영 이미지 버전 기록을 백업하고, 새 이미지가 모두 홈서버에 적재·플랫폼·revision 검증된 상태에서 검증한 후보 이미지 목록으로 `scripts/deploy.sh production --without-worker --local-images`를 실행한다. 준비된 후보 목록은 `GRADUATE_ME_IMAGE_FILE`로 전달할 수 있다. 모든 상태 검사가 통과한 뒤 성공 이미지 기록과 활성 infra를 갱신한다. 기존 앱별 자동 배포만 순서대로 실행하면 이미지와 상태 검사 버전이 엇갈릴 수 있으므로 최초 전환은 조율해서 진행한다.

기존 배포 스크립트가 DB 백업과 `1800000002300-school-email-auth`를 포함한 마이그레이션을 적용한다. 이후 `shared` 구성도 적용하여 Caddy가 새 앱 호스트를 처리하게 한다. Caddy가 새 호스트만 처리하도록 바뀌면 이전 루트의 서비스 응답은 중단될 수 있으므로 Pages의 임시 주소 검증까지 끝낸 뒤 같은 전환 시간에 진행한다. worker는 시작하지 않는다. 메일 실제 발송과 Gemini 호출은 별도 승인 없이 검증에 포함하지 않는다.

도메인 변경으로 기존 호스트 전용 세션은 새 앱에서 사용할 수 없으므로 사용자는 학교 이메일로 다시 로그인한다. 루트 도메인과 쿠키를 공유하도록 `Domain=.pleasegraduate.me`를 추가하지 않는다.

## Cloudflare에서 학생 앱 주소 추가

1. Cloudflare의 Tunnels 화면에서 현재 홈서버에 연결된 기존 터널을 연다. 커넥터 토큰·설치 명령·비밀키 화면을 열거나 복사하지 않는다.
2. 기존 Published application route의 서비스와 HTTP Host Header 설정을 먼저 확인한다. 기존 루트 경로를 삭제하거나 수정하지 않고 새 경로를 추가한다.
3. 공개 호스트는 `app.pleasegraduate.me`, 서비스는 기존 홈서버 Caddy 진입점 `http://127.0.0.1:8080`으로 지정한다. 경로 조건은 기존 앱과 동일한 전체 경로다. 서비스 포트 `3000`이나 API 포트 `4000`을 새로 공개하지 않는다.
4. HTTP Host Header를 `pleasegraduate.me`로 고정한 설정이 있으면 새 경로에는 복사하지 않는다. `app.pleasegraduate.me`가 Caddy와 API에 전달되어야 한다.
5. 저장 과정에서 안내하는 `app` CNAME이 같은 터널을 가리키는지 확인한다. UI가 생성한 대상 값을 사용하며 터널 ID를 임의로 만들지 않는다.
6. 새 앱의 `/login`, 정적 파일, `/api/health`, 학교 이메일 인증과 관리자 링크를 확인한다. 실제 메일 발송은 배포 시 명시적으로 허용된 범위에서 수행한다.

기존 Tunnel을 재사용하므로 새 터널을 설치하거나 홈서버 인증 토큰을 바꿀 필요는 없다. 기존 관리자 경로를 유지하고 다른 터널·개발 API 공개 설정은 변경하지 않는다.

## Cloudflare Pages와 루트 도메인 전환

1. Workers & Pages에서 랜딩의 정적 배포를 만들고 임시 `*.pages.dev` 주소가 정상인지 먼저 확인한다. Next.js 서버를 실행하는 Workers 배포가 아니라 정적 `out/` 배포다.
2. 프로젝트의 Custom domains에서 `pleasegraduate.me` 연결을 시작한다. Pages 프로젝트의 실제 주소가 정해지기 전에는 DNS 대상 값을 입력하지 않는다.
3. 기존 루트 `@` 레코드가 Tunnel을 가리키면 기존 값·프록시 상태·TTL을 기록한다. 새 앱 확인과 Pages 준비가 모두 끝난 전환 시점에 루트 레코드만 Pages가 안내하는 CNAME 대상으로 변경한다. 충돌 때문에 기존 레코드 제거를 요구하면 이 단계에서 해당 루트 레코드만 교체한다.
4. DNS 레코드만 수동 추가해서 Pages Custom domains 등록을 생략하지 않는다. 프로젝트와 사용자 지정 도메인 연결도 완료해야 한다.
5. 새 `app`과 기존 `admin`, 다른 개발 API 설정, Resend의 `rsend`·`send`·`resend._domainkey` 및 기존 SPF·MX·DMARC 레코드는 변경하지 않는다. 가비아의 구매 도메인이나 네임서버도 바꾸지 않는다.
6. 루트의 랜딩과 체험, 서비스 진입 링크, 앱 로그인과 로그아웃, 관리자 화면을 확인한다. Pages 도메인의 활성화와 HTTPS 인증서 상태도 확인한다.
7. 루트 전환이 확인된 뒤에만 예전 루트 Tunnel 경로를 정리한다. 새 `app` 경로와 기존 관리자·개발 경로는 유지한다.

구 서비스의 `/library` 같은 루트 경로가 랜딩 주소로 남으면 Pages에서 기본적으로 404가 될 수 있다. 이를 보존하려면 사용하던 서비스 경로만 새 앱으로 보내는 Pages `_redirects` 규칙을 별도로 준비한다. 정적 파일·루트 랜딩·체험 앵커를 통째로 서비스 앱으로 보내는 전체 경로 리디렉션은 추가하지 않는다.

## 확인과 복구

전환 전에는 기존 DNS 레코드, Tunnel 경로, 활성 infra SHA, 앱 이미지 SHA와 환경 파일 백업을 확보한다. Pages 연결에 문제가 있으면 루트 DNS를 기록한 기존 대상으로 되돌린다. 이전 학생 서비스 자체를 복구하려면 DNS만 바꾸는 것으로 끝나지 않으며 Caddy의 `PRODUCTION_DOMAIN`, API의 `AUTH_URL`, 앱 이미지·infra 조합도 함께 복구해야 한다. DB 마이그레이션은 자동으로 되돌리지 않고 백업과 호환성을 확인한다.

공식 안내: [Pages 사용자 지정 도메인](https://developers.cloudflare.com/pages/configuration/custom-domains/), [Tunnel 공개 애플리케이션](https://developers.cloudflare.com/tunnel/get-started/).
