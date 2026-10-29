import { t, useLanguage } from "../i18n";
import { useState } from "react";
import { Button, LineChart } from "../components/ui";
import { pct, time, tone, won } from "./format";
import type { BoothState, TradeTarget } from "./types";
import styles from "./Booth.module.css";

export function NewsFeed({ data }: { data: BoothState }) {
  useLanguage();
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h2>{t("공룡 속보")}</h2>
      </div>
      <div className={styles.news}>
        {data.events.length ? (
          data.events.map((e) => (
            <article key={e.id}>
              <small>
                {time(e.created_at)} ·{" "}
                {e.kind === "meteor"
                  ? t("운석 속보")
                  : e.kind === "ghost"
                    ? t("공룡 귀신")
                    : t("시장 소식")}
              </small>
              <p>{e.headline}</p>
            </article>
          ))
        ) : (
          <p className={styles.muted}>{t("아직 속보가 없습니다. 다음 사건을 기다려보세요.")}</p>
        )}
      </div>
    </section>
  );
}
export function MarketView({
  data,
  onTrade,
}: {
  data: BoothState;
  onTrade: (target: TradeTarget) => void;
}) {
  useLanguage();
  const [selected, setSelected] = useState("PANG");
  const instrument =
    data.instruments.find((i) => i.code === selected) ?? data.instruments[0];
  const me = data.me;
  return (
    <div className={styles.marketGrid}>
      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <h2>{t("공룡 증시")}</h2>
          <small className={styles.muted}>{t("직전 공시 가격 대비")}</small>
        </div>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t("종목 / 섹터")}</th>
                <th>{t("현재가")}</th>
                <th>{t("직전 대비 등락률")}</th>
                <th className={styles.sparkColumn}>{t("가격 흐름")}</th>
              </tr>
            </thead>
            <tbody>
              {data.instruments.map((i) => (
                <tr
                  key={i.code}
                  className={instrument?.code === i.code ? styles.selected : ""}
                >
                  <td>
                    <button
                      className={styles.stockSelect}
                      onClick={() => setSelected(i.code)}
                      aria-pressed={instrument?.code === i.code}
                    >
                      <strong>{i.name}</strong>
                      <small>{i.sector}</small>
                    </button>
                  </td>
                  <td>{won(i.price)}</td>
                  <td className={styles[tone(i.change_rate)]}>
                    {pct(i.change_rate)}
                  </td>
                  <td className={styles.sparkColumn}>
                    <div className={styles.spark}>
                      <LineChart
                        points={i.history}
                        label={i.name + t(" 가격 흐름")}
                        height={48}
                        interactive={false}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {instrument && (
          <div className={styles.chartBlock}>
            <div className={styles.chartHeading}>
              <div>
                <small className={styles.muted}>{instrument.name}</small>
                <h3>
                  {won(instrument.price)}{" "}
                  <span className={styles[tone(instrument.change_rate)]}>
                    {pct(instrument.change_rate)}
                  </span>
                </h3>
              </div>
              <Button
                className={styles.solid}
                onClick={() =>
                  onTrade({
                    kind: "stock",
                    code: instrument.code,
                    round_id: data.round.id,
                  })
                }
                disabled={!data.round.is_open || Boolean(me?.disqualified)}
              >
                {t("주식 매매")}
              </Button>
            </div>
            <LineChart
              points={instrument.history}
              label={instrument.name + t(" 장중 가격 이력")}
              formatX={time}
              height={235}
            />
          </div>
        )}
      </section>
      <aside className={styles.side}>
        {me?.enrolled && (
          <section className={styles.panel + " " + styles.balance}>
            <small className={styles.muted}>
              {t("{nickname} 님의 이번 장 자산", { nickname: me.nickname })}
            </small>
            <strong>{won(me.total_assets)}</strong>
            <span className={styles[tone(me.return_rate)]}>
              {pct(me.return_rate)}
            </span>
            <dl>
              <dt>{t("주문 가능 현금")}</dt>
              <dd>{won(me.cash)}</dd>
              <dt>{t("주식 평가액")}</dt>
              <dd>{won(me.stock_value)}</dd>
              <dt>{t("펀드 평가액")}</dt>
              <dd>{won(me.fund_value)}</dd>
            </dl>
          </section>
        )}
        <NewsFeed data={data} />
        <section className={styles.panel + " " + styles.leaders}>
          <h2>{t("이번 장 수익률 TOP 3")}</h2>
          {data.ranking
            .filter((r) => r.eligible)
            .slice(0, 3)
            .map((r) => (
              <div key={r.participant_id}>
                <span>
                  {r.award_rank}　{r.nickname}
                </span>
                <strong className={styles[tone(r.return_rate)]}>
                  {pct(r.return_rate)}
                </strong>
              </div>
            ))}
          {!data.ranking.some((r) => r.eligible) && (
            <p className={styles.muted}>{t("첫 거래를 기다리고 있습니다.")}</p>
          )}
        </section>
      </aside>
    </div>
  );
}
