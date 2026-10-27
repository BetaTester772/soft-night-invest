# 공룡 증시 부스 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 승인된 공룡 증시 시안과 장 운영·규칙 기반 펀드를 실제 API로 구현한다.
**Architecture:** /api/booth 영역과 장별 원장을 추가한다. 기존 일일 이벤트는 호환 경로에 보존한다. 정수 가격·매매 계산·인증·폴링·차트·UI를 재사용하며 금융 변경은 장 잠금 후 계좌 잠금 순서로 직렬화한다.
**Tech Stack:** FastAPI, SQLAlchemy, Alembic, PostgreSQL, React, TypeScript, Vite, pytest, vitest.
**Spec:** docs/superpowers/specs/2026-10-27-dinosaur-booth-design.md

## Global Constraints
- 2026-10-30 KST 16:00–16:50, 17:00–17:50, 19:30–20:20; 개장 포함·마감 제외.
- 장별 시드 1,000,000원과 6개 주식 초기화. 펀드 기준가 1,000원 초기화.
- 가격 10초·운용 30초·화면 조회 2초. 첫 60초·마지막 30초 사건 없음.
- 좌수 소수점 6자리·매수 금액 올림·환매 금액 내림. 정수/유리수 계산.
- 규칙 기반 자동 운용. 실제 AI 호출과 예시 데이터 제품 삽입 금지.
- 기존 데이터 삭제·push·merge·공개 배포 제외.
- 사용자가 설계와 구현 진행을 승인했으므로 추가 계획 승인 없이 실행한다.

## Review Focus
- 같은 요청 키에 다른 본문은 거부하며 다른 토큰의 계좌에 접근할 수 없다(Task 2).
- 마감·일시정지·오래된 가격·다른 장 요청은 체결하지 않는다(Task 2/3).
- 펀드 반올림 차익과 늦은 참가자의 과거 수익 소급이 없다(Task 1/2).
- 프로세스 재시작·지연·마감 재실행에서 가격·사건·시드가 중복되지 않는다(Task 3).
- 느린 응답과 장 선택 전환이 이전 장/계좌 데이터를 새 화면에 섞지 않는다(Task 4/5).

## Task 1: 장 도메인과 공통 금융 계산
Files: execution.py, services/trading.py, booth/domain.py, booth/models.py, db.py, migrations/versions/0012_booth.py; tests/test_booth_domain.py.
Interfaces: SessionSpec(number,era,opens_at,closes_at); sessions(day), active_session(now,day); execute_stock(cash,quantity,cost,side,ordered,price); fund_buy(amount,model_assets), fund_sell(units,model_assets).
- [ ] 먼저 테스트: 16:50·17:50 휴장, 원가 비례 제거, 펀드 청약/환매 가치 보존.
- [ ] pytest tests/test_booth_domain.py 기능 부재 실패 확인.
- [ ] 공통 계산 추출, 장·계좌·가격·사건·결과 원장과 마이그레이션 구현. 보유 원장은 계좌 행 JSON으로 저장해 잠금 범위를 명확히 한다.
- [ ] 신규 도메인과 기존 tests/test_domain.py 실행.

## Task 2: 참가·계좌·주문·조회 API
Files: booth/accounts.py, views.py, routes.py, schemas.py; api/app.py, config.py; tests/test_booth_api.py.
Interfaces: /api/booth/config, /state?round_id, /join, /enroll, /orders, /logout. 본인 계좌는 일관된 /state 응답에 포함한다. 주문 body={round_id,request_id,kind,code,side,quantity|amount|units}. 부스 토큰은 기존 토큰과 분리.
- [ ] 먼저 API 테스트: 닉네임 중복, 인증 누락, 장 참가 1회 지급, 초과 주문, 재전송과 본문 충돌, 마감·다른 장, 펀드 평가액.
- [ ] 404 등 기대 실패 확인 후 참가·토큰 해시·장 계좌·서버 체결·통합 현황을 구현.
- [ ] API와 기존 회귀 테스트 실행.

## Task 3: 시세·펀드·사건·마감·관리 API
Files: booth/market.py, funds.py, admin.py, simulation.py; api/app.py, config.py; tests/test_booth_market.py.
Interfaces: run_due(factory,now,day), advance(session,round,now); admin status/control/news/incident/disqualify/recover/confirm.
- [ ] 먼저 테스트: 구간 중복 방지·30초 운용·공개 가격만 입력·섹터 충격·운석 1회·30초 지연 정지·누락 생략·마감 불변·결과 수정 버전.
- [ ] 실패 확인 후 스케줄러와 관리자 운영 API 구현. 비공개 구간 seed/사건 계획을 공개 응답에서 제외.
- [ ] 전체 backend pytest·ruff·mypy 실행.

## Task 4: 실제 데이터 참가·직접 매매·펀드 화면
Files: frontend/src/booth/{types.ts,api.ts,BoothApp.tsx,MarketView.tsx,FundsView.tsx,PortfolioView.tsx,TradeDialog.tsx,Booth.module.css}, App.tsx; booth/__tests__/BoothApp.test.tsx.
Interfaces: 기존 request/useApi/Modal/LineChart/UI 재사용. 서버 config의 study 모드로 기존 화면 유지, booth 모드로 기본 부스 화면 선택.
- [ ] 먼저 UI 테스트: 닉네임 참가·거래 오류·펀드 매수 후 서버 데이터·휴장 주문 차단·장 전환 늦은 응답 무시.
- [ ] 실패 확인 후 승인 시안의 배치·색을 React로 구현하고 하드코딩 예시값 없이 API 연결.
- [ ] vitest·타입 검사·빌드 실행.

## Task 5: 랭킹·부스 송출·운영 화면과 설정
Files: booth/{RankingView.tsx,BroadcastView.tsx,AdminView.tsx}, index.html, vite.config.ts, .env.example, docker-compose.yml, README.md, frontend/DESIGN.md; booth/__tests__/Operations.test.tsx.
Interfaces: 설정된 public_url의 QR, 장별 확정 결과, X-Admin-Key 운영 제어.
- [ ] 먼저 테스트: 확정 전 시상 대기·확정 1~3위·과거 장·관리자 인증·실제 참가 URL QR.
- [ ] 실패 확인 후 화면·QR 라이브러리·배포 설정·문서를 구현. 주소가 없으면 운영자 설정 안내.
- [ ] 전체 frontend와 backend 회귀 검사 실행.

## Task 6: 운영 검증과 전체 검토
Files: tests/test_booth_concurrency.py, docs/dev/booth-validation.md.
- [ ] PostgreSQL 사용 가능 여부 확인, 동시 주문·잠금·기존 데이터 보존 마이그레이션 upgrade/check/downgrade/upgrade 검증.
- [ ] 전체 장 가격 경로 시뮬레이션, 80명 폴링·주문 측정과 결과 기록.
- [ ] 실제 서버의 모바일·데스크톱·부스 화면과 참가/거래/펀드/마감 브라우저 확인.
- [ ] 새 검토자의 전체 변경 검토, 중요한 발견은 실패 테스트 후 수정.
- [ ] 검증 결과와 미검증 범위를 기록하고 사용자에게 전달.
