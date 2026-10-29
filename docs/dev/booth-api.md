# 공룡 증시 부스 API

회원가입·로그인은 기존 /api/auth를 사용한다. 기존 /api/event·/api/me·/api/admin은 공부 이벤트 호환 API다. 부스는 /api/booth를 사용한다. 실시간 갱신의 기준은 서버의 round ID와 version이다. 모든 시각은 시간대가 있는 ISO 8601이다.

| 요청 | 동작 |
|---|---|
| GET /api/booth/config | 실행 모드, 행사일, 참가 URL, QA 여부, 시계 배속 |
| GET /api/booth/state?round_id=1 | 같은 가격 버전의 종목·펀드·뉴스·순위·본인 계좌. round_id 생략 시 현재/다음/마지막 장 |
| POST /api/auth/register | 학교 이메일·학번·비밀번호와 개인정보 동의로 회원가입 |
| POST /api/booth/session | 회원 인증 토큰 필수. 연결된 부스 token 발급 및 현재/다음 장 계좌 생성 |
| POST /api/booth/enroll | round_id 장 계좌 생성. 재호출해도 시드는 추가 지급하지 않음 |
| POST /api/booth/orders | 직접 주식 또는 펀드 거래 |
| POST /api/booth/logout | 현재 부스 참가 토큰 폐기 |
| GET /api/booth/admin/status | 장·참가자·현금(cash)·실격·결과 버전 |
| POST /api/booth/admin/run | 밀린 구간 확인. 오래 지연되면 재생 대신 정지 |
| POST /api/booth/admin/open | round_id, reason. 대기 중인 장을 현재 시각부터 50분간 개장 |
| POST /api/booth/admin/grant | round_id, participant_id, amount, reason, request_id. 선택한 참가자에게 지원금 지급 |
| POST /api/booth/admin/control | round_id, action(pause/resume), reason |
| POST /api/booth/admin/news | round_id, headline, reason. 다음 구간에 발표 |
| POST /api/booth/admin/incident | round_id, sector(feed/build/space), rate(-0.5~0.5), headline, reason |
| POST /api/booth/admin/disqualify | round_id, participant_id, reason. 마감 후에는 결과 수정 버전 생성 |
| POST /api/booth/admin/confirm | round_id, revision. 최신 시상 결과 확정 |
| POST /api/booth/admin/qa/step | QA 전용. seconds(1~30) 진행 |
| POST /api/booth/admin/qa/next | QA 전용. 다음 장 개장으로 이동 |

참가자 API는 Authorization: Bearer 토큰을 사용하며 관리자 API는 기존 X-Admin-Key를 사용한다. 회원 인증 토큰은 /api/booth/session에서 부스 토큰으로 교환한다. 부스 조회·거래에 회원 인증 토큰을 직접 사용할 수 없다. 기존 닉네임 전용 참가 토큰은 거부하며 /api/booth/join은 제거했다. 잘못된 참가 토큰을 보낸 공개 현황 요청도 401이며, 토큰 없는 관람 요청은 가능하다.

주문 공통 필드는 round_id, request_id(8~80자 영문·숫자·콜론·밑줄·하이픈), kind(stock/fund), code, side(buy/sell)다. 주식은 quantity 정수, 펀드 매수는 amount 정수 원, 환매는 units 정수 micro 좌수(1좌=1,000,000)를 보낸다. 불필요한 수량 필드와 bool·소수 수량은 거부한다.

동일 계좌·요청 번호·동일 본문은 이전 주문을 반환한다. 동일 번호에 다른 본문은 REQUEST_CONFLICT다. 네트워크 재시도는 같은 번호를 사용한다. 거래 시각과 최신 잔고·가격 버전은 서버가 잠금을 획득한 뒤 재검사한다. 90초(3회 갱신 주기) 이상 갱신되지 않은 가격에서는 STALE_PRICE를 반환한다.

펀드는 공통 모델 계좌의 기준가 연동 방식이다. 사용자의 청약·환매는 모델 계좌 원금을 바꾸지 않는다. 기준가는 모델 총자산/1,000이고, 좌수와 실제 지급액은 정수·유리수 계산한다. 응답의 표시용 nav(float)를 체결 원장 계산에 사용하지 않는다.

신규 장의 가격 갱신 주기는 30초이며 round.update_interval_seconds로 공개한다. 배포 전에 이미 열린 장은 저장된 구간 번호와 사건 계획을 보존하기 위해 기존 10초 주기를 마감까지 유지한다. 화면 조회는 2초 간격이다.

회원 계좌 복구는 `/login` 또는 `/reset-password`를 사용한다. 관리자 복구 토큰 발급 API는 제공하지 않는다.

수동 개장은 QA 설정과 관계없이 관리자만 실행할 수 있다. 해당 장의 개장·마감 시각만 현재 시각과 50분 뒤로 변경하며, 다른 미마감 장의 시간과 겹치면 ROUND_OVERLAP으로 거부한다. 이미 열린 장이나 마감한 장은 재개장할 수 없다. 기존 참가자의 잔액과 보유 자산은 유지한다. 변경 시각은 주문, 참가, 자동 가격 갱신, 정지·재개, 마감에 동일하게 적용된다. 자동 가격 갱신과 마감에는 스케줄러 실행이 필요하다.

지원금 amount는 1~1,000,000,000 정수 원이며 공백이 아닌 reason(1~300자)이 필수다. 해당 장의 기존 참가자 계좌에만 지급하며, 실격 계좌나 종료된 장에는 새 지급을 거부한다. 계좌 현금은 10^15원 이하로 제한한다. request_id 형식은 주문과 같고, 동일 계좌·동일 번호·동일 금액·동일 사유 재요청은 추가 지급하지 않는다. 같은 번호의 금액이나 사유가 다르면 REQUEST_CONFLICT다. 성공 여부를 모르는 네트워크 재시도는 같은 번호를 사용한다.

계좌 응답의 me.principal은 초기 시드 100만원과 누적 지원금의 합이다. 투자 손익은 총자산−원금, 수익률은 (총자산−원금)/원금으로 계산하고 랭킹도 이 수익률로 비교한다. 지급 자체는 매매 또는 시상 자격을 만들지 않는다. 개장과 지급은 운영 사유와 함께 감사 로그에 기록한다.

기존 DB는 배포 전 `alembic upgrade head`로 0014 지원금 원장을 추가한다. Docker 시작 스크립트는 이를 자동 실행한다.

## 자동 뉴스와 일정 변경

- `market` 이벤트는 거래 중 120초마다 자동 발행하는 실제 섹터 가격 흐름 해설이며 `rates`는 비어 있음. `ghost`·`meteor` 및 운영자 입력과 구분.
- 새 일정(KST): 17:00–17:50 / 저녁 휴장 17:50–18:30 / 18:30–19:20 / 19:30–20:20. 마이그레이션 0015는 구 일정 그대로인 pending 장에만 적용.
