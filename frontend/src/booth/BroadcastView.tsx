import { QRCodeSVG } from "qrcode.react";
import { LineChart } from "../components/ui";
import { Awards } from "./RankingView";
import { pct, time, tone, won } from "./format";
import type { BoothConfig, BoothState } from "./types";
import styles from "./Booth.module.css";

export function BroadcastView({
  data,
  config,
}: {
  data: BoothState;
  config: BoothConfig;
}) {
  const latest = data.result ?? data.results.at(-1) ?? null;
  const onBreak = !data.round.is_open;
  return (
    <>
      <div className={styles.tvHeading}>
        <div>
          <span className={styles.pill}>
            {data.round.id}장 · {data.round.era}
          </span>
          <h1>
            {data.round.is_open
              ? "지금, 공룡 증시에서는."
              : "잠시 숨 고르는 공룡 증시."}
          </h1>
        </div>
        <span className={styles.muted}>
          {data.round.is_open
            ? "장중 실시간 시세"
            : data.round.state === "pending"
              ? time(data.round.opens_at) + " 개장 예정"
              : "거래 종료"}
        </span>
      </div>
      {data.events[0] && (
        <div className={styles.eventBanner}>
          <strong>공룡 속보</strong>
          <span>{data.events[0].headline}</span>
        </div>
      )}
      <div className={styles.tvGrid}>
        {data.instruments.map((i) => (
          <section className={styles.panel + " " + styles.tvStock} key={i.code}>
            <h2>{i.name}</h2>
            <div>
              <strong>{won(i.price)}</strong>
              <span className={styles[tone(i.return_rate)]}>
                {pct(i.return_rate)}
              </span>
            </div>
            <LineChart
              points={i.history}
              label={i.name + " 실시간 차트"}
              height={105}
              formatX={time}
              interactive={false}
            />
          </section>
        ))}
      </div>
      <div className={styles.tvBottom}>
        <div>
          {onBreak ? (
            <Awards result={latest} />
          ) : (
            <section className={styles.panel + " " + styles.awards}>
              <h2>이번 장 수익률 TOP 3</h2>
              <div className={styles.podium}>
                {data.ranking
                  .filter((r) => r.eligible)
                  .slice(0, 3)
                  .map((r) => (
                    <div key={r.participant_id}>
                      <small>{r.award_rank}위</small>
                      <h3>{r.nickname}</h3>
                      <strong className={styles[tone(r.return_rate)]}>
                        {pct(r.return_rate)}
                      </strong>
                    </div>
                  ))}
              </div>
              {!data.ranking.some((r) => r.eligible) && (
                <p className={styles.muted}>첫 거래를 기다리고 있습니다.</p>
              )}
            </section>
          )}
        </div>
        <section className={styles.panel + " " + styles.joinBox}>
          {config.public_url ? (
            <>
              <QRCodeSVG
                value={config.public_url}
                role="img"
                aria-label="참가 QR 코드"
                size={124}
                marginSize={4}
                level="M"
              />
              <div>
                <h2>같이 살아남아요.</h2>
                <p>
                  닉네임으로 바로 참가
                  <br />
                  가상 시드 100만원
                </p>
                <a href={config.public_url}>휴대폰으로 참가하기</a>
              </div>
            </>
          ) : (
            <p className={styles.muted}>
              운영자가 참가 주소를 설정하면 QR이 표시됩니다.
            </p>
          )}
        </section>
      </div>
      {data.rounds.every((r) => r.state === "closed") &&
        data.results.length > 1 && (
          <div className={styles.resultArchive}>
            {data.results
              .filter((r) => r.round_id !== latest?.round_id)
              .map((r) => (
                <Awards key={r.round_id} result={r} />
              ))}
          </div>
        )}
    </>
  );
}
