import { t, useLanguage } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { onUnauthorized } from "../api/client";
import { adminKeyStore } from "../api/storage";
import { useApi } from "../api/useApi";
import { Button, TextField } from "../components/ui";
import { AuditTab } from "../pages/Admin/AuditTab";
import { boothApi } from "./api";
import { time, won } from "./format";
import type { BoothConfig } from "./types";
import styles from "./Booth.module.css";

export function AdminView({ config }: { config: BoothConfig }) {
  useLanguage();
  const [authenticated, setAuthenticated] = useState(
    Boolean(adminKeyStore.get()),
  );
  const [key, setKey] = useState("");
  const [roundId, setRoundId] = useState(1);
  const [participant, setParticipant] = useState("");
  const [cashAmount, setCashAmount] = useState("1000000");
  const [grantAmount, setGrantAmount] = useState("100000");
  const grantRequest = useRef<{ signature: string; id: string } | null>(null);
  const inFlight = useRef(false);
  const [reason, setReason] = useState("");
  const [headline, setHeadline] = useState("");
  const [sector, setSector] = useState("feed");
  const [rate, setRate] = useState("10");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const status = useApi(() => boothApi.status(), [authenticated], {
    enabled: authenticated,
    refreshInterval: 3000,
  });
  useEffect(
    () =>
      onUnauthorized((mode) => {
        if (mode === "admin") {
          adminKeyStore.set(null);
          setAuthenticated(false);
          setMessage("관리자 키를 확인하세요.");
        }
      }),
    [],
  );
  async function action(name: string, body?: unknown) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      let payload = body;
      if (name === "grant") {
        const signature = JSON.stringify(body);
        if (grantRequest.current?.signature !== signature) {
          grantRequest.current = { signature, id: crypto.randomUUID() };
        }
        payload = { ...(body as object), request_id: grantRequest.current.id };
      }
      const result = await boothApi.admin<{ message?: string }>(
        name,
        payload,
      );
      if (name === "grant") {
        grantRequest.current = null;
        setGrantAmount("");
      }
      setMessage(result?.message ?? "처리했습니다.");
      await status.refetch();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "처리하지 못했습니다.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  if (!authenticated)
    return (
      <section className={styles.adminLogin}>
        <h1>{t("거래소 운영")}</h1>
        <p className={styles.muted}>{t("설정된 관리자 키로 접속하세요.")}</p>
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            adminKeyStore.set(key);
            setAuthenticated(true);
          }}
        >
          <TextField
            label={t("관리자 키")}
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            required
          />
          <Button type="submit">{t("운영 화면 열기")}</Button>
        </form>
        {message && <p role="alert">{t(message)}</p>}
      </section>
    );
  const selected = status.data?.rounds.find((r) => r.id === roundId);
  const result = status.data?.results.find((r) => r.round_id === roundId);
  const people =
    status.data?.participants.filter((p) => p.round_id === roundId) ?? [];
  const selectedPerson = people.find((p) => p.participant_id === Number(participant));
  const amount = Number(grantAmount);
  return (
    <>
      <div className={styles.sectionTop}>
        <div>
          <h1>{t("거래소 운영")}</h1>
          <p>{t("장 운영과 사건, 시상 결과를 확인합니다.")}</p>
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            adminKeyStore.set(null);
            setAuthenticated(false);
          }}
        >
          {t("관리자 나가기")}
        </Button>
      </div>
      {message && (
        <p role="status" className={styles.notice}>
          {t(message)}
        </p>
      )}
      {status.error && (
        <p role="alert" className={styles.error}>
          {t(status.error.message)}
        </p>
      )}
      <div className={styles.adminGrid}>
        <section className={styles.panel + " " + styles.adminSection}>
          <h2>{t("장 운영")}</h2>
          <label>{t("운영할 장")}{" "}<select
              value={roundId}
              disabled={busy}
              onChange={(e) => {
                setRoundId(Number(e.target.value));
                setParticipant("");
              }}
            >
              {status.data?.rounds.map((r) => (
                <option key={r.id} value={r.id}>
                  {t("{round}장 · {era}", { round: r.id, era: t(r.era) })}
                </option>
              ))}
            </select>
          </label>
          <p>
            {selected?.state ?? t("불러오는 중")} ·{" "}
            {selected && time(selected.opens_at)}–
            {selected && time(selected.closes_at)}{" "}{t("· 가격 버전")}{" "}
            {selected?.version ?? 0}
          </p>
          <TextField
            label={t("운영 사유")}
            value={reason}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
          />
          <div className={styles.actions}>
            <Button
              disabled={busy || selected?.state !== "pending" || !reason.trim()}
              onClick={() => void action("open", { round_id: roundId, reason })}
            >
              {t("지금 개장")}
            </Button>
            <Button disabled={busy} onClick={() => void action("run")}>
              {t("스케줄러 지금 확인")}
            </Button>
            <Button
              disabled={busy || selected?.state !== "open" || !reason.trim()}
              onClick={() =>
                void action("control", {
                  round_id: roundId,
                  action: "pause",
                  reason,
                })
              }
            >
              {t("거래 일시 정지")}
            </Button>
            <Button
              disabled={busy || selected?.state !== "paused" || !reason.trim()}
              onClick={() =>
                void action("control", {
                  round_id: roundId,
                  action: "resume",
                  reason,
                })
              }
            >
              {t("거래 재개")}
            </Button>
          </div>
          <p className={styles.muted}>
            {t("지금 개장하면 선택한 장을 현재 시각부터 50분간 엽니다. 다른 장과 시간이 겹치면 열 수 없습니다.")}
          </p>
          <p className={styles.muted}>
            {t("재개하면 지난 구간은 건너뛰고 마지막 공개 가격부터 이어갑니다. 마감 시각은 바뀌지 않습니다.")}
          </p>
          {config.qa_tools && (
            <div className={styles.actions}>
              <Button
                disabled={busy}
                onClick={() =>
                  void action("qa/step", {
                    seconds: selected?.update_interval_seconds ?? 30,
                  })
                }
              >
                {t("QA {seconds}초 진행", { seconds: selected?.update_interval_seconds ?? 30 })}
              </Button>
              <Button disabled={busy} onClick={() => void action("qa/next")}>{t("QA 다음 장 개장")}</Button>
            </div>
          )}
        </section>
        <section className={styles.panel + " " + styles.adminSection}>
          <h2>{t("속보와 섹터 사건")}</h2>
          <TextField
            label={t("속보 제목")}
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            maxLength={160}
          />
          <div className={styles.actions}>
            <Button
              disabled={busy || !headline.trim() || !reason.trim()}
              onClick={() =>
                void action("news", { round_id: roundId, headline, reason })
              }
            >
              {t("속보 예약")}
            </Button>
          </div>
          <label>{t("섹터")}{" "}<select value={sector} onChange={(e) => setSector(e.target.value)}>
              <option value="feed">{t("사료·바이오")}</option>
              <option value="build">{t("건설·자원")}</option>
              <option value="space">{t("우주·방위")}</option>
            </select>
          </label>
          <TextField
            label={t("사건 변동률 (%)")}
            type="number"
            min={-50}
            max={50}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
          <Button
            disabled={
              busy ||
              !headline.trim() ||
              !reason.trim() ||
              !Number.isFinite(Number(rate)) ||
              Math.abs(Number(rate)) > 50
            }
            onClick={() =>
              void action("incident", {
                round_id: roundId,
                sector,
                rate: Number(rate) / 100,
                headline,
                reason,
              })
            }
          >
            {t("섹터 사건 예약")}
          </Button>
          <p className={styles.muted}>{t("다음 가격 구간에 속보와 가격 효과를 함께 공개합니다.")}</p>
        </section>
        <section className={styles.panel + " " + styles.adminSection}>
          <h2>{t("참가자 관리")}</h2>
          <label>{t("참가자")}{" "}<select
              value={participant}
              disabled={busy}
              onChange={(e) => setParticipant(e.target.value)}
            >
              <option value="">{t("참가자를 선택하세요")}</option>
              {people.map((p) => (
                <option key={p.participant_id} value={p.participant_id}>
                  {p.nickname}
                  {p.disqualified ? t(" (실격)") : ""}
                </option>
              ))}
            </select>
          </label>
          {selectedPerson && <p>{t("현재 현금 {amount}", { amount: won(selectedPerson.cash) })}</p>}
          <TextField
            label={t("지급 금액 (원)")}
            type="number"
            min={1}
            max={1000000000}
            step={1}
            value={grantAmount}
            disabled={busy}
            onChange={(e) => setGrantAmount(e.target.value)}
          />
          <Button
            disabled={
              busy || !selectedPerson || selectedPerson.disqualified ||
              !selected || selected.state === "closed" || !reason.trim() ||
              !Number.isSafeInteger(amount) || amount < 1 || amount > 1000000000
            }
            onClick={() => void action("grant", {
              round_id: roundId,
              participant_id: Number(participant),
              amount,
              reason,
            })}
          >
            {t("지원금 지급")}
          </Button>
          <p className={styles.muted}>
            {t("선택한 참가자의 이 장 계좌에 지급합니다. 지급금은 투자 원금에 포함되며, 지급 자체로 수익률이 오르지 않습니다. 운영 사유를 입력하세요.")}
          </p>
          <div className={styles.actions}>
            <Button
              disabled={busy || !participant || !reason.trim()}
              variant="danger"
              onClick={() =>
                void action("disqualify", {
                  round_id: roundId,
                  participant_id: Number(participant),
                  reason,
                })
              }
            >
              {t("이 장에서 실격 처리")}
            </Button>

          </div>
          {config.qa_tools && (
            <div className={styles.form}>
              <h3>{t("테스트 머니 지급")}</h3>
              <TextField label={t("지급 금액 (원)")} type="number" min={1} max={100000000}
                step={1} value={cashAmount} onChange={(e) => setCashAmount(e.target.value)} />
              <p className={styles.muted}>{t("테스트 머니를 받은 계좌는 이 장의 랭킹·시상에서 제외됩니다. 장별 한도 1억원.")}</p>
              <Button disabled={busy || !participant || !reason.trim() ||
                !Number.isSafeInteger(Number(cashAmount)) || Number(cashAmount) < 1 || Number(cashAmount) > 100000000 || selected?.state === "closed"}
                onClick={() => void action("qa/cash", { round_id: roundId,
                  participant_id: Number(participant), amount: Number(cashAmount), reason })}>
                {t("테스트 머니 지급하기")}
              </Button>
            </div>
          )}
          <p className={styles.muted}>{t("계좌에 다시 접속하려면 참가자에게 로그인 또는 학교 메일로 비밀번호 재설정을 안내하세요.")}{" "}<a href="/reset-password">{t("비밀번호 재설정")}</a></p>
          <p className={styles.muted}>{t("닉네임과 현장 참가자를 확인한 뒤 처리하세요. 모든 변경은 사유와 함께 기록합니다.")}</p>
        </section>
        <section className={styles.panel + " " + styles.adminSection}>
          <h2>{t("시상 결과 확정")}</h2>
          {result ? (
            <>
              <p>
                {t("{round}장 결과 버전 {revision}", { round: roundId, revision: result.revision })} ·{" "}
                {result.confirmed ? t("확정") : t("확인 대기")}
              </p>
              {result.entries
                .filter((e) => e.eligible)
                .slice(0, 3)
                .map((e) => (
                  <p key={e.participant_id}>
                    {t("{rank}위", { rank: e.award_rank ?? e.rank })}{" "}{e.nickname}　
                    {(e.return_rate * 100).toFixed(2)}%
                  </p>
                ))}
              <Button
                disabled={busy || result.confirmed}
                onClick={() =>
                  void action("confirm", {
                    round_id: roundId,
                    revision: result.revision,
                  })
                }
              >
                {t("이 결과로 시상 확정")}
              </Button>
            </>
          ) : (
            <p className={styles.muted}>{t("장 마감 후 정산 결과가 생성됩니다.")}</p>
          )}
          <p className={styles.muted}>{t("마감 후 실격 처리를 하면 새로운 결과 버전을 다시 확정해야 합니다.")}</p>
        </section>
      </div>
      <div style={{ marginTop: 24 }}>
        <AuditTab />
      </div>
    </>
  );
}
