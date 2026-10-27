import { t, useLanguage } from "../i18n";
import { pct, tone, won } from "./format";
import type { BoothState, Result } from "./types";
import styles from "./Booth.module.css";

export function Awards({ result }: { result: Result | null }) {
  useLanguage();
  if (!result || !result.confirmed)
    return (
      <div className={styles.explain}>
        <h2>{t("시상 결과 확인 중")}</h2>
        <p>{t("운영자가 최종 결과를 확정하면 1~3위를 발표합니다.")}</p>
      </div>
    );
  const winners = result.entries.filter((e) => e.eligible).slice(0, 3);
  return (
    <section className={styles.panel + " " + styles.awards}>
      <h2>{t("{round}장 확정 시상 결과", { round: result.round_id })}</h2>
      <div className={styles.podium}>
        {winners.map((e) => (
          <div key={e.participant_id}>
            <small>{t("{rank}위", { rank: e.award_rank ?? e.rank })}</small>
            <h3 aria-label={t("{rank}위", { rank: e.award_rank ?? e.rank }) + " " + e.nickname}>{e.nickname}</h3>
            <strong className={styles[tone(e.return_rate)]}>
              {pct(e.return_rate)}
            </strong>
          </div>
        ))}
      </div>
      {!winners.length && <p>{t("시상 대상 참가자가 없습니다.")}</p>}
      <small className={styles.muted}>{t("확정 결과 버전")}{" "}{result.revision}</small>
    </section>
  );
}
export function RankingView({ data }: { data: BoothState }) {
  useLanguage();
  return (
    <>
      <div className={styles.sectionTop}>
        <div>
          <h1>{t("이번 시대의 생존자들.")}</h1>
          <p>
            {t("{round}장 · {era}", { round: data.round.id, era: data.round.era })}{" "}{t("수익률 순위입니다.")}
          </p>
        </div>
        <span className={styles.pill}>
          {data.result?.confirmed
            ? t("시상 확정")
            : data.round.state === "closed"
              ? t("결과 확인 중")
              : t("실시간 순위")}
        </span>
      </div>
      {data.round.state === "closed" && <Awards result={data.result} />}
      <section className={styles.panel} style={{ marginTop: 20 }}>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t("순위 / 닉네임")}</th>
                <th>{t("총자산")}</th>
                <th>{t("수익률")}</th>
              </tr>
            </thead>
            <tbody>
              {data.ranking.map((r) => (
                <tr
                  key={r.participant_id}
                  className={
                    r.participant_id === data.me?.participant_id
                      ? styles.selected
                      : ""
                  }
                >
                  <td>
                    {r.rank}　{r.nickname}
                    {r.participant_id === data.me?.participant_id
                      ? t(" · 나")
                      : ""}
                    {!r.eligible && (
                      <small className={styles.muted}>{" "}{t("· 거래 대기")}</small>
                    )}
                  </td>
                  <td>{won(r.total_assets)}</td>
                  <td className={styles[tone(r.return_rate)]}>
                    {pct(r.return_rate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.ranking.length && (
          <div className={styles.empty}>{t("아직 참가자가 없습니다. 첫 생존자가 되어보세요.")}</div>
        )}
      </section>
      <div className={styles.explain}>
        <strong>{t("장 마감 시 수익률 상위 3명에게 경품을 드립니다.")}</strong>
        <p>
          {t("주식과 펀드를 합산하며, 한 번 이상 거래한 참가자가 시상 대상입니다. 정확히 동률이면 해당 장 첫 거래 시각, 장 참가 계좌 순서로 정합니다. 실격자는 제외됩니다.")}
        </p>
      </div>
    </>
  );
}
