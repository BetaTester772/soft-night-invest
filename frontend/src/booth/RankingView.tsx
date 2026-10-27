import { pct, tone, won } from "./format";
import type { BoothState, Result } from "./types";
import styles from "./Booth.module.css";

export function Awards({ result }: { result: Result | null }) {
  if (!result || !result.confirmed)
    return (
      <div className={styles.explain}>
        <h2>시상 결과 확인 중</h2>
        <p>운영자가 최종 결과를 확정하면 1~3위를 발표합니다.</p>
      </div>
    );
  const winners = result.entries.filter((e) => e.eligible).slice(0, 3);
  return (
    <section className={styles.panel + " " + styles.awards}>
      <h2>{result.round_id}장 확정 시상 결과</h2>
      <div className={styles.podium}>
        {winners.map((e) => (
          <div key={e.participant_id}>
            <small>{e.award_rank}위</small>
            <h3 aria-label={e.award_rank + "위 " + e.nickname}>{e.nickname}</h3>
            <strong className={styles[tone(e.return_rate)]}>
              {pct(e.return_rate)}
            </strong>
          </div>
        ))}
      </div>
      {!winners.length && <p>시상 대상 참가자가 없습니다.</p>}
      <small className={styles.muted}>확정 결과 버전 {result.revision}</small>
    </section>
  );
}
export function RankingView({ data }: { data: BoothState }) {
  return (
    <>
      <div className={styles.sectionTop}>
        <div>
          <h1>이번 시대의 생존자들.</h1>
          <p>
            {data.round.id}장 · {data.round.era} 수익률 순위입니다.
          </p>
        </div>
        <span className={styles.pill}>
          {data.result?.confirmed
            ? "시상 확정"
            : data.round.state === "closed"
              ? "결과 확인 중"
              : "실시간 순위"}
        </span>
      </div>
      {data.round.state === "closed" && <Awards result={data.result} />}
      <section className={styles.panel} style={{ marginTop: 20 }}>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>순위 / 닉네임</th>
                <th>총자산</th>
                <th>수익률</th>
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
                      ? " · 나"
                      : ""}
                    {!r.eligible && (
                      <small className={styles.muted}> · 거래 대기</small>
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
          <div className={styles.empty}>
            아직 참가자가 없습니다. 첫 생존자가 되어보세요.
          </div>
        )}
      </section>
      <div className={styles.explain}>
        <strong>장 마감 시 수익률 상위 3명에게 경품을 드립니다.</strong>
        <p>
          주식과 펀드를 합산하며, 한 번 이상 거래한 참가자가 시상 대상입니다.
          정확히 동률이면 해당 장 첫 거래 시각, 장 참가 계좌 순서로 정합니다.
          실격자는 제외됩니다.
        </p>
      </div>
    </>
  );
}
