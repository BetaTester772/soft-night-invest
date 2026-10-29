# 난 운석이 떨어진 줄 알았지

2026 소프트의 밤 공룡 모의투자 부스. 기존 공부장려 투자 시스템의 금융 계산·가격 산정·UI·운영 인프라를 재사용한다. 10월 30일 세 개 장에서 주식 6종목을 직접 거래하거나 규칙 기반 펀드 3종에 투자하고, 장별 수익률 1~3위를 시상한다.

| 장 | 한국 시간 | 시대 |
|---|---|---|
| 1장 | 16:00–16:50 | 트라이아스기 |
| 2장 | 17:00–17:50 | 쥐라기 |
| 3장 | 19:30–20:20 | 백악기 |

장마다 현금 100만원, 종목 가격, 펀드 기준가를 초기화한다. 이전 장의 결과는 보존한다. 가격과 펀드 운용은 30초, 화면 조회는 2초 간격이다. 90초(3회 갱신 주기) 이상 가격 갱신이 지연되면 거래를 중단하고 운영자가 재개한다.

학교 이메일·학번·비밀번호로 회원가입 후 로그인해야 참가할 수 있으며 직접 주식과 펀드를 함께 보유할 수 있다. 펀드는 공통 모델 포트폴리오의 기준가에 연동된다. 외부 AI 모델은 호출하지 않는다. 실제 금전 거래는 없다.

- 부스 API: [docs/dev/booth-api.md](docs/dev/booth-api.md)
- 승인 설계: [공룡 증시 전환 설계](docs/superpowers/specs/2026-10-27-dinosaur-booth-design.md)
- 검증 기록: [docs/dev/booth-validation.md](docs/dev/booth-validation.md)
- 화면: /, /funds, /portfolio, /ranking, /broadcast, /admin

기존 공부 이벤트는 STUDY_INVEST_EVENT_MODE=study로 실행한다. 기존 DB와 API는 유지하며, 아래 공부 이벤트 규격과 CLI는 이 호환 모드에 해당한다.

- 시스템 규격서: [docs/spec/README.md](docs/spec/README.md) (v0.4)
- API 계약: [docs/dev/api.md](docs/dev/api.md)
- 구현 해석·가정: [docs/dev/implementation-notes.md](docs/dev/implementation-notes.md)
- DB 연결 풀 설계: [docs/dev/db-pools.md](docs/dev/db-pools.md)
- 원본 규격서(docx): [docs/source/](docs/source/)

## 구성

| 디렉터리 | 내용 |
|---|---|
| `backend/` | FastAPI + SQLAlchemy + PostgreSQL. 가격 산정·정산 배치·인증 검수·시뮬레이터(F-13) |
| `frontend/` | React + TypeScript + Vite. 공용 컴포넌트 라이브러리(`src/components/ui`) 위에 페이지 구성 |
| `infra/` | PgBouncer(연결 풀) 이미지, pgAdmin·PostgreSQL 초기화 스크립트 |
| `docker-compose.yml` | PostgreSQL · PgBouncer · 백엔드 · 프론트엔드(Caddy) · pgAdmin |

## Docker Compose로 실행

```bash
cp .env.example .env        # 관리자 키와 DB 비밀번호, PUBLIC_URL(참가 QR 주소) 설정
docker compose up --build
```

- 웹: http://localhost:8080 (관리자 화면은 `/admin`, `.env`의 관리자 키로 접속)
- pgAdmin: http://localhost:5050 (이 PC에서만). 서버 "study_invest (pgAdmin 풀)"이 등록되어 있고, 비밀번호는 `.env`의 `PGADMIN_DB_PASSWORD`
- DB 연결은 PgBouncer를 거친다: api 풀 20, batch 풀 2, pgAdmin 풀 5. [docs/dev/db-pools.md](docs/dev/db-pools.md)
- API: http://localhost:8080/api (백엔드 직접 접근은 http://localhost:8000, 문서는 `/docs`)
- 백엔드 컨테이너는 시작할 때 `alembic upgrade head`를 실행하고, `STUDY_INVEST_SCHEDULER=1`이면 booth 모드에서 장 개장·30초 가격 갱신·마감을 자동 운영한다. study 모드에서는 기존 09:00 공시·18:00 정산을 실행한다.

### 도메인과 HTTPS

서버의 80·443 포트를 열고, DNS A 레코드를 서버 IP로 연결한 뒤 실행한다.
`.env`의 `SITE_DOMAIN`은 기본 `softnight.intelligentsw.com`이며,
`STUDY_INVEST_PUBLIC_URL`과 `VITE_SITE_URL`도 같은 HTTPS 주소로 설정한다.

```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d --build --wait
```

전용 Caddy가 프론트엔드로 연결하고 TLS 인증서를 자동 발급·갱신한다.
인증서는 이 프로젝트의 `caddy_data` 볼륨에 보관한다.

## CI · 의존성 업데이트

[`.github/workflows/ci.yml`](.github/workflows/ci.yml)이 PR과 `main` 푸시마다 바뀐 영역만 검사한다.

| 작업 | 내용 |
|---|---|
| `backend-lint` | ruff, mypy(strict). 모든 백엔드 작업은 `backend/uv.lock` 버전 그대로 설치(lock이 낡으면 실패) |
| `backend-test` | pytest를 SQLite · PostgreSQL · PgBouncer 경유(운영과 같은 transaction 풀, pgAdmin 풀 상한 포함) 세 구성으로 |
| `migrations` | `alembic upgrade head` → `alembic check`(모델과 마이그레이션 일치) → downgrade/upgrade 왕복 |
| `frontend` | `npm ci`, 타입 검사, vitest, 빌드 |
| `compose` | 실제 Dockerfile로 이미지 빌드 후 전체 스택(db·pgbouncer·backend·frontend·pgAdmin) 기동. API 스모크, Caddy 라우팅·캐시·본문 한도(413), pgAdmin 서버 등록·전용 풀 접속 확인 |
| `ci-ok` | 위 작업이 모두 성공(또는 해당 없음으로 건너뜀)이면 성공 |

브랜치 보호의 필수 검사는 **`ci-ok` 하나만** 지정한다. 바뀌지 않은 영역의 작업은 건너뛰므로, 개별 작업을 필수로 지정하면 건너뛴 PR이 머지되지 않는다.

[`.github/dependabot.yml`](.github/dependabot.yml): Python(uv.lock)·npm·Docker 이미지·compose 이미지·GitHub Actions를 매주 월요일 09:00(KST) 확인해 업데이트 PR을 만든다. minor·patch는 생태계별로 묶는다. PostgreSQL major와 Python·Node 런타임 버전은 자동으로 올리지 않는다(데이터 이전·CI 버전과 함께 의도적으로 올릴 것).

백엔드 의존성은 `backend/uv.lock`에 고정되고, CI와 Docker 이미지 모두 이 버전 그대로(해시 검증) 설치한다. `pyproject.toml`의 의존성을 바꾸면 `cd backend && uv lock`으로 lock도 함께 커밋한다. 빠뜨리면 CI와 이미지 빌드가 실패한다.

## 부스 운영 설정

기본값은 STUDY_INVEST_EVENT_MODE=booth, STUDY_INVEST_BOOTH_DATE=2026-10-30이다. 공개 배포 주소를 STUDY_INVEST_PUBLIC_URL=https://your-domain.example 형식으로 설정하면 /broadcast에 참가 QR이 표시된다. 경로·인증 정보·쿼리가 있는 주소는 거부한다. 주소가 비어 있으면 QR 설정 안내가 표시된다.

관리자 /admin에서 장 상태와 지연을 확인하고 일시 정지·재개, 속보/섹터 사건 예약, 참가자 실격, 시상 결과 확정을 처리한다. 최종 결과는 장 마감 후 생성되며 운영자가 최신 버전을 확정해야 부스 화면에 시상자가 표시된다. 중복 참가나 현장 참가 여부를 확인한 뒤 필요하면 장별 실격 처리한다.

기존 학번·학교 메일/비밀번호 로그인은 `/login`에서 사용할 수 있다. 로그인한 기존 계정은 별도 부스 계좌에 연결되며 재로그인해도 같은 계좌를 사용한다. 닉네임만으로 새로 참가하는 경로는 제공하지 않으며, 기존 닉네임 전용 토큰도 참가·거래에 사용할 수 없다. 같은 닉네임의 기존 계좌를 자동으로 가져오지는 않는다.

관리자 화면에서 장과 운영 사유를 선택한 뒤 **지금 개장**을 누르면 대기 중인 장을 현재 시각부터 50분간 연다. 다른 장과 시간이 겹치거나 이미 개장한 장은 열 수 없다. **참가자 관리**에서는 참가자와 지급 금액(1원~10억원)을 입력하고 같은 운영 사유로 **지원금 지급**을 실행한다. 지원금은 해당 장 계좌의 현금과 투자 원금에 반영되며, 지급만으로 수익률이 오르지 않는다. 두 기능은 QA 모드 없이 사용할 수 있고 사유가 감사 로그에 남는다. 기존 DB는 `alembic upgrade head`가 필요하며 Docker 실행 시 자동 적용된다.

QA는 STUDY_INVEST_QA_TOOLS=1에서만 사용할 수 있다. 관리자 > 참가자 관리에서 장과 참가자를 선택하고 운영 사유·금액을 입력해 테스트 머니를 지급한다. 장별 누적 한도는 1억원이며 종료된 장에는 지급할 수 없다. 지급받은 계좌는 해당 장의 랭킹·시상에서 제외되고 지급 기록은 감사 로그에 남는다. 배포 시 `alembic upgrade head`로 0013 마이그레이션을 적용한다. 관리자 화면의 다음 장 개장·30초 진행으로 테스트한다. TIME_ORIGIN과 TIME_SCALE을 지정하면 BOOTH_CLOCK_START(기본 15:59:50)부터 가속된다. 실제 행사에서는 QA_TOOLS=0과 실제 시계를 사용한다. 개발 서버도 자동 가격 갱신에는 STUDY_INVEST_SCHEDULER=1이 필요하다.

전체 장 시뮬레이션은 backend에서 .venv/bin/python -m study_invest.booth.simulation --paths 25 --seed 42로 실행한다. 매 경로는 별도 메모리 DB를 사용해 실제 운영 DB를 읽거나 바꾸지 않는다.

## 로컬 개발

### 백엔드

```bash
cd backend
uv sync --locked --extra dev               # uv.lock 버전 그대로 .venv에 설치 (source .venv/bin/activate)
docker compose up -d db                     # 저장소 루트에서. 또는 로컬 PostgreSQL
export STUDY_INVEST_DATABASE_URL=postgresql+psycopg://study:change-me@localhost:5432/study_invest
export STUDY_INVEST_ADMIN_KEY=dev-key
export STUDY_INVEST_MAIL_LOG_ONLY=1             # 인증·재설정 코드를 로그로 확인(SMTP 없이)
alembic upgrade head
uvicorn --factory study_invest.api.app:create_app --reload
```

검사:

```bash
ruff check src tests && ruff format --check src tests
mypy                                        # strict, src + tests
pytest                                      # 기본은 SQLite 메모리 DB(동시성 테스트는 건너뜀)
STUDY_INVEST_TEST_DATABASE_URL=postgresql+psycopg://study:study@localhost/study_invest_test pytest
```

운영 CLI:

```bash
study-invest run-due                         # 밀린 09:00/18:00 배치 실행 (cron 1분 간격 가능)
study-invest open --day 2026-10-06           # 수동 공시
study-invest settle --day 2026-10-06         # 수동 정산
study-invest simulate --paths 100000 --seed 42 [--use-price-cap] [--defaults]
study-invest purge-images                    # 이벤트 종료 후 인증 사진 삭제
study-invest purge-personal-info             # 이벤트 종료 후 학교 메일·이름·학번·학과·인증 코드 기록 삭제
```

환경 변수:

| 변수 | 기본값 | 설명 |
|---|---|---|
| `STUDY_INVEST_DATABASE_URL` | `postgresql+psycopg://study:study@localhost:5432/study_invest` | SQLAlchemy URL |
| `STUDY_INVEST_ADMIN_KEY` | (없음) | 관리자 API 키. 비어 있으면 관리자 API 차단 |
| `STUDY_INVEST_UPLOAD_DIR` | `./uploads` | 인증 사진 저장 경로 |
| `STUDY_INVEST_MAX_UPLOAD_BYTES` | `10485760` | 인증 사진 최대 크기 |
| `STUDY_INVEST_MAX_JSON_BYTES` | `1048576` | 업로드 외 요청 본문 최대 크기 |
| `STUDY_INVEST_SCHEDULER` | `0` | `1`이면 앱 안에서 배치 자동 실행 |
| `STUDY_INVEST_SCHEDULER_INTERVAL` | `30` | 스케줄러 확인 주기(초) |
| `STUDY_INVEST_AUTO_CREATE_SCHEMA` | `0` | `1`이면 시작 시 `create_all`(마이그레이션 대신, 테스트용) |
| `STUDY_INVEST_THREADPOOL_SIZE` | `40` | 동기 라우트 스레드풀 크기 |
| `STUDY_INVEST_BATCH_DATABASE_URL` | (= DATABASE_URL) | 배치 전용 풀 URL(운영: PgBouncer `study_invest_batch`) |
| `STUDY_INVEST_MIGRATION_DATABASE_URL` | (= DATABASE_URL) | Alembic 직접 연결(PgBouncer 우회) |
| `STUDY_INVEST_API_POOL_SIZE` / `_API_POOL_TIMEOUT` | `20` / `10` | api 풀 크기·대기 초(넘으면 503) |
| `STUDY_INVEST_BATCH_POOL_SIZE` | `2` | 배치 풀 크기 |
| `STUDY_INVEST_CPU_WORKERS` | `1` | 시뮬레이터용 프로세스 수(0이면 스레드) |
| `STUDY_INVEST_LOOP_GUARD` | `warn` | 이벤트 루프에서 SQL 실행 시 `warn`/`raise`/`off` |
| `STUDY_INVEST_LOG_LEVEL` / `_LOG_FORMAT` | `INFO` / `text` | 앱 로그 레벨(`DEBUG`·`INFO`·`WARNING`·`ERROR`)과 형식(`text`·`json`). 요청마다 `X-Request-ID`를 응답에 싣고 모든 로그 줄에 붙인다. 로그인한 요청에는 참가자 ID와 로그인 세션 ID(토큰 해시 앞 12자, 로그인부터 로그아웃까지 같은 값)도 붙는다. 쿼리 문자열·이메일·비밀번호는 남기지 않는다. 컨테이너는 uvicorn 접속 로그를 끄고(`--no-access-log`) 앱 요청 로그를 쓴다 |
| `STUDY_INVEST_EVENT_START` / `_EVENT_END` | `2026-10-06` / `2026-10-16` | 이벤트 기간(YYYY-MM-DD, 양 끝 포함). 테스트·QA 서버에서만 바꾼다 |
| `STUDY_INVEST_TIME_SCALE` / `_TIME_ORIGIN` | `1` / (없음) | 앱 시계 배속과, 이벤트 첫날 00:00이 시작되는 실제 시각(ISO 8601, 시간대 없으면 KST). `24`면 실제 1시간이 하루. 테스트·QA 서버에서만 바꾼다 |
| `STUDY_INVEST_QA_TOOLS` | `0` | `1`이면 관리자 > 배치·정산에 "지금 가격 변동시키기" 버튼이 생긴다. 18:00·다음 날을 기다리지 않고 최신 공시일을 정산하고 다음 운영일 시작가를 바로 공시한다. 테스트·QA 서버에서만 켠다 |
| `STUDY_INVEST_QA_UNLIMITED` | `0` | `1`이면 QA 무제한 모드. 종료일(`STUDY_INVEST_EVENT_END`)을 무시하고 시작일 이후 매일 공시·정산·회차가 끝없이 이어진다. 참가 신청도 닫히지 않는다. `STUDY_INVEST_QA_TOOLS`의 가격 변동 버튼(첫 클릭은 이벤트 첫날 공시)이나 `STUDY_INVEST_TIME_SCALE`과 함께 써서 실제 이벤트 기간과 상관없이 긴 가격 추세를 본다. 테스트·QA 서버에서만 켠다 |
| `STUDY_INVEST_FRONTEND_DIST` | (없음) | 빌드된 프론트엔드를 백엔드가 직접 제공할 때 경로 |
| `STUDY_INVEST_EMAIL_VERIFICATION` | `0` | `1`이면 가입 때 학교 메일 인증 코드 필수. `0`이면 메일 주소만 받고 미인증으로 가입(인증된 참가자만 거래하게 하는 스위치는 관리자 > 참가자) |
| `STUDY_INVEST_SMTP_HOST` | (없음) | 학교 메일 인증·비밀번호 재설정 코드 SMTP 서버(예: `smtp.gmail.com`). 비우면 메일을 보낼 수 없어 코드 요청이 503(`MAIL_NOT_CONFIGURED`) |
| `STUDY_INVEST_MAIL_LOG_ONLY` | `0` | `1`이면 SMTP 없이 메일 내용(코드 포함)을 로그로 남김. 로컬 개발·CI 전용, 운영 금지 |
| `STUDY_INVEST_SMTP_PORT` / `_SMTP_SECURITY` | `587` / `starttls` | `starttls`·`ssl`(보통 465)·`none` |
| `STUDY_INVEST_SMTP_USERNAME` / `_SMTP_PASSWORD` | (없음) | SMTP 로그인. Gmail은 2단계 인증 후 만든 **앱 비밀번호** |
| `STUDY_INVEST_MAIL_FROM` | (= USERNAME) | 보내는 주소. Gmail SMTP는 로그인한 계정 주소여야 한다 |
| `STUDY_INVEST_MAIL_DAILY_LIMIT` | `400` | 최근 24시간 인증 메일 상한(넘으면 503). 발송 계정 한도보다 낮게(Gmail 개인 계정 약 500통/일) |
| `STUDY_INVEST_TURNSTILE_SITE_KEY` / `STUDY_INVEST_TURNSTILE_SECRET_KEY` | (빈 값) | Cloudflare Turnstile 키. 둘 다 있으면 로그인·참가 신청·인증 코드 요청에 봇 확인. 비우면 끔(하나만 있으면 시작 오류). DNS·호스팅이 Cloudflare가 아니어도(예: Route 53) 된다 |

### 프론트엔드

[frontend/README.md](frontend/README.md) 참고. 개발 서버(`npm run dev`)는 `/api`를 `http://localhost:8000`으로 프록시한다.
