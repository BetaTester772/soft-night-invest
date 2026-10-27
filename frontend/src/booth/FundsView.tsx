import { Button, LineChart } from "../components/ui";
import { pct, time, tone, won } from "./format";
import type { BoothState, TradeTarget } from "./types";
import styles from "./Booth.module.css";

export function FundsView({
  data,
  onTrade,
}: {
  data: BoothState;
  onTrade: (target: TradeTarget) => void;
}) {
  const names = Object.fromEntries(
    data.instruments.map((i) => [i.code, i.name]),
  );
  return (
    <>
      <div className={styles.sectionTop}>
        <div>
          <h1>
            매매는 맡기고,
            <br />
            공룡은 구경하세요.
          </h1>
          <p>
            성향이 다른 에이전트 펀드. 공통 운용 포트폴리오의 기준가에 내
            투자금이 연동됩니다.
          </p>
        </div>
        <span className={styles.pill}>규칙 기반 자동 운용</span>
      </div>
      <div className={styles.fundGrid}>
        {data.funds.map((f) => (
          <section className={styles.panel + " " + styles.fund} key={f.code}>
            <div className={styles.animal} aria-hidden>
              {f.icon}
            </div>
            <span className={styles.risk}>{f.style}</span>
            <h2>{f.name}</h2>
            <p>{f.description}</p>
            <div className={styles.fundRate}>
              <div>
                <small>이번 장 운용 수익률</small>
                <strong className={styles[tone(f.return_rate)]}>
                  {pct(f.return_rate)}
                </strong>
              </div>
              <small>
                기준가
                <br />
                {won(f.nav)}
              </small>
            </div>
            <LineChart
              points={f.history}
              label={f.name + " 기준가 이력"}
              height={120}
              formatX={time}
              interactive={false}
            />
            <div className={styles.weights}>
              {Object.entries(f.weights)
                .filter(([, v]) => v > 0)
                .map(([c, v], i) => (
                  <i
                    key={c}
                    style={{
                      width: v * 100 + "%",
                      background: [
                        "var(--color-highlight)",
                        "var(--chart-1)",
                        "var(--chart-2)",
                        "var(--chart-3)",
                      ][i % 4],
                    }}
                  />
                ))}
            </div>
            <div className={styles.weightLabels}>
              {Object.entries(f.weights)
                .filter(([, v]) => v > 0)
                .map(([c, v]) => (
                  <span key={c}>
                    {c === "CASH" ? "현금" : (names[c] ?? c)}{" "}
                    {(v * 100).toFixed(0)}%
                  </span>
                ))}
            </div>
            <p className={styles.reason}>{f.reason}</p>
            <Button
              fullWidth
              className={styles.solid}
              disabled={!data.round.is_open || Boolean(data.me?.disqualified)}
              onClick={() =>
                onTrade({ kind: "fund", code: f.code, round_id: data.round.id })
              }
            >
              이 펀드에 투자하기
            </Button>
            {data.me?.funds.some((h) => h.code === f.code && h.units > 0) && (
              <Button
                fullWidth
                variant="ghost"
                disabled={!data.round.is_open}
                onClick={() =>
                  onTrade({
                    kind: "fund",
                    code: f.code,
                    round_id: data.round.id,
                    side: "sell",
                  })
                }
              >
                보유 좌수 환매하기
              </Button>
            )}
          </section>
        ))}
      </div>
      <div className={styles.explain}>
        <strong>직접 매매와 펀드 투자를 함께 할 수 있어요.</strong>
        <p>
          매수한 시점부터 펀드 수익률이 내 자산에 반영됩니다. 다음 장은 모두
          같은 시드로 다시 시작합니다. 에이전트는 정해진 규칙으로 자동 운용하며,
          손실이 발생할 수 있습니다.
        </p>
      </div>
    </>
  );
}
