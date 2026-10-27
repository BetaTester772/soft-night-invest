import { Link } from "react-router-dom";
import { Button } from "../components/ui";
import { pct, time, tone, units, won } from "./format";
import type { BoothState, TradeTarget } from "./types";
import styles from "./Booth.module.css";

export function PortfolioView({
  data,
  onTrade,
  onJoin,
  onEnroll,
}: {
  data: BoothState;
  onTrade: (target: TradeTarget) => void;
  onJoin: () => void;
  onEnroll: () => void;
}) {
  const me = data.me;
  if (!me)
    return (
      <div className={styles.empty}>
        <h1>내 공룡 계좌를 열어보세요.</h1>
        <p>닉네임으로 참가하면 가상 시드 100만원을 드립니다.</p>
        <Button onClick={onJoin}>참가하기</Button>
      </div>
    );
  if (!me.enrolled)
    return (
      <div className={styles.empty}>
        <h1>{data.round.era}에 참가하세요.</h1>
        <Button onClick={onEnroll}>이 장에 참가하기</Button>
      </div>
    );
  return (
    <>
      <div className={styles.sectionTop}>
        <div>
          <h1>멸종은 아직입니다.</h1>
          <p>
            {me.nickname} 님의 {data.round.id}장 · {data.round.era} 포트폴리오
          </p>
        </div>
        <span className={styles.pill}>장 시작 시드 1,000,000원</span>
      </div>
      <section className={styles.panel + " " + styles.portfolio}>
        <h2>
          내 자산{" "}
          <span className={styles[tone(me.return_rate)]}>
            {pct(me.return_rate)}
          </span>
        </h2>
        <div className={styles.totals}>
          <div>
            <small>총자산</small>
            <strong>{won(me.total_assets)}</strong>
          </div>
          <div>
            <small>주문 가능 현금</small>
            <strong>{won(me.cash)}</strong>
          </div>
          <div>
            <small>이번 장 투자 손익</small>
            <strong className={styles[tone(me.return_rate)]}>
              {won(me.total_assets - 1_000_000)}
            </strong>
          </div>
        </div>
        <h3>직접 매매</h3>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>종목</th>
                <th>보유</th>
                <th>평가액</th>
                <th>거래</th>
              </tr>
            </thead>
            <tbody>
              {me.holdings.map((h) => (
                <tr key={h.code}>
                  <td>{h.name}</td>
                  <td>{h.quantity}주</td>
                  <td>{won(h.value)}</td>
                  <td>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!data.round.is_open || me.disqualified}
                      onClick={() =>
                        onTrade({
                          kind: "stock",
                          code: h.code,
                          round_id: data.round.id,
                          side: "sell",
                        })
                      }
                    >
                      매도
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!me.holdings.length && (
          <p className={styles.muted}>보유한 주식이 없습니다.</p>
        )}
        <h3 style={{ marginTop: 25 }}>에이전트 펀드</h3>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>펀드</th>
                <th>보유 좌수</th>
                <th>평가액</th>
                <th>거래</th>
              </tr>
            </thead>
            <tbody>
              {me.funds.map((h) => (
                <tr key={h.code}>
                  <td>{h.name}</td>
                  <td>{units(h.units)}좌</td>
                  <td>{won(h.value)}</td>
                  <td>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!data.round.is_open || me.disqualified}
                      onClick={() =>
                        onTrade({
                          kind: "fund",
                          code: h.code,
                          round_id: data.round.id,
                          side: "sell",
                        })
                      }
                    >
                      환매
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!me.funds.length && (
          <p className={styles.muted}>보유한 펀드가 없습니다.</p>
        )}
        <div className={styles.actions}>
          <Link to="/">종목 더 살펴보기</Link>
          <Link to="/funds">펀드에 투자하기</Link>
        </div>
      </section>
      <section className={styles.panel} style={{ marginTop: 20 }}>
        <div className={styles.panelHead}>
          <h2>최근 거래</h2>
          <small>최근 30건</small>
        </div>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>시각 / 자산</th>
                <th>구분</th>
                <th>체결 금액</th>
              </tr>
            </thead>
            <tbody>
              {me.orders.map((o) => (
                <tr key={o.id}>
                  <td>
                    {time(o.created_at)} ·{" "}
                    {data.instruments.find((i) => i.code === o.code)?.name ??
                      data.funds.find((f) => f.code === o.code)?.name ??
                      o.code}
                  </td>
                  <td>
                    {o.side === "buy"
                      ? "매수"
                      : o.kind === "fund"
                        ? "환매"
                        : "매도"}
                  </td>
                  <td>{won(o.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className={styles.explain}>
        <strong>자산은 이번 장 안에서만 이어집니다.</strong>
        <p>
          장 마감 시 공개 가격으로 최종 평가합니다. 다음 장에는 가상 시드
          100만원으로 다시 시작하고, 지난 결과는 장별 랭킹에 남습니다.
        </p>
      </div>
    </>
  );
}
