# 공룡 증시 부스 API

기존 /api/event·/api/me·/api/admin은 공부 이벤트 호환 API다. 부스는 /api/booth를 사용한다. 실시간 갱신의 기준은 서버의 round ID와 version이다. 모든 시각은 시간대가 있는 ISO 8601이다.

| 요청 | 동작 |
|---|---|
| GET /api/booth/config | 실행 모드, 행사일, 참가 URL, QA 여부, 시계 배속 |
| GET /api/booth/state?round_id=1 | 같은 가격 버전의 종목·펀드·뉴스·순위·본인 계좌. round_id 생략 시 현재/다음/마지막 장 |
| POST /api/booth/join | nickname만 입력, 참가 token 발급 및 현재/다음 장 계좌 생성 |
| POST /api/booth/enroll | round_id 장 계좌 생성. 재호출해도 시드는 추가 지급하지 않음 |
| POST /api/booth/orders | 직접 주식 또는 펀드 거래 |
| POST /api/booth/logout | 현재 부스 참가 토큰 폐기 |
| GET /api/booth/admin/status | 장·참가자·실격·결과 버전 |
| POST /api/booth/admin/run | 밀린 구간 확인. 오래 지연되면 재생 대신 정지 |
| POST /api/booth/admin/control | round_id, action(pause/resume), reason |
| POST /api/booth/admin/news | round_id, headline, reason. 다음 구간에 발표 |
| POST /api/booth/admin/incident | round_id, sector(feed/build/space), rate(-0.5~0.5), headline, reason |
| POST /api/booth/admin/disqualify | round_id, participant_id, reason. 마감 후에는 결과 수정 버전 생성 |
| POST /api/booth/admin/confirm | round_id, revision. 최신 시상 결과 확정 |
| POST /api/booth/admin/recover | participant_id, reason. 이전 토큰 폐기 후 새 복구 토큰 발급 |
| POST /api/booth/admin/qa/step | QA 전용. seconds(1~10) 진행 |
| POST /api/booth/admin/qa/next | QA 전용. 다음 장 개장으로 이동 |

참가자 API는 Authorization: Bearer 토큰을 사용하며 관리자 API는 기존 X-Admin-Key를 사용한다. 다른 이벤트 토큰을 부스 인증으로 사용할 수 없다. 잘못된 참가 토큰을 보낸 공개 현황 요청도 401이며, 토큰 없는 관람 요청은 가능하다.

주문 공통 필드는 round_id, request_id(8~80자 영문·숫자·콜론·밑줄·하이픈), kind(stock/fund), code, side(buy/sell)다. 주식은 quantity 정수, 펀드 매수는 amount 정수 원, 환매는 units 정수 micro 좌수(1좌=1,000,000)를 보낸다. 불필요한 수량 필드와 bool·소수 수량은 거부한다.

동일 계좌·요청 번호·동일 본문은 이전 주문을 반환한다. 동일 번호에 다른 본문은 REQUEST_CONFLICT다. 네트워크 재시도는 같은 번호를 사용한다. 거래 시각과 최신 잔고·가격 버전은 서버가 잠금을 획득한 뒤 재검사한다. 30초 이상 갱신되지 않은 가격에서는 STALE_PRICE를 반환한다.

펀드는 공통 모델 계좌의 기준가 연동 방식이다. 사용자의 청약·환매는 모델 계좌 원금을 바꾸지 않는다. 기준가는 모델 총자산/1,000이고, 좌수와 실제 지급액은 정수·유리수 계산한다. 응답의 표시용 nav(float)를 체결 원장 계산에 사용하지 않는다.
