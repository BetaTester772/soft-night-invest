import { useEffect, useState } from "react";
import { onUnauthorized } from "../api/client";
import { adminKeyStore } from "../api/storage";
import { useApi } from "../api/useApi";
import { Button, TextField } from "../components/ui";
import { AuditTab } from "../pages/Admin/AuditTab";
import { boothApi } from "./api";
import { time } from "./format";
import type { BoothConfig } from "./types";
import styles from "./Booth.module.css";

export function AdminView({ config }: { config: BoothConfig }) {
  const [authenticated, setAuthenticated] = useState(
    Boolean(adminKeyStore.get()),
  );
  const [key, setKey] = useState("");
  const [roundId, setRoundId] = useState(1);
  const [participant, setParticipant] = useState("");
  const [reason, setReason] = useState("");
  const [headline, setHeadline] = useState("");
  const [sector, setSector] = useState("feed");
  const [rate, setRate] = useState("10");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [recovered, setRecovered] = useState("");
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
    if (busy) return;
    setBusy(true);
    setMessage("");
    setRecovered("");
    try {
      const result = await boothApi.admin<{ message?: string; token?: string }>(
        name,
        body,
      );
      setMessage(result?.message ?? "처리했습니다.");
      if (result?.token) setRecovered(result.token);
      await status.refetch();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "처리하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  if (!authenticated)
    return (
      <section className={styles.adminLogin}>
        <h1>거래소 운영</h1>
        <p className={styles.muted}>설정된 관리자 키로 접속하세요.</p>
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            adminKeyStore.set(key);
            setAuthenticated(true);
          }}
        >
          <TextField
            label="관리자 키"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            required
          />
          <Button type="submit">운영 화면 열기</Button>
        </form>
        {message && <p role="alert">{message}</p>}
      </section>
    );
  const selected = status.data?.rounds.find((r) => r.id === roundId);
  const result = status.data?.results.find((r) => r.round_id === roundId);
  const people =
    status.data?.participants.filter((p) => p.round_id === roundId) ?? [];
  return (
    <>
      <div className={styles.sectionTop}>
        <div>
          <h1>거래소 운영</h1>
          <p>장 운영과 사건, 시상 결과를 확인합니다.</p>
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            adminKeyStore.set(null);
            setAuthenticated(false);
          }}
        >
          관리자 나가기
        </Button>
      </div>
      {message && (
        <p role="status" className={styles.notice}>
          {message}
        </p>
      )}
      {status.error && (
        <p role="alert" className={styles.error}>
          {status.error.message}
        </p>
      )}
      <div className={styles.adminGrid}>
        <section className={styles.panel + " " + styles.adminSection}>
          <h2>장 운영</h2>
          <label>
            운영할 장
            <select
              value={roundId}
              onChange={(e) => {
                setRoundId(Number(e.target.value));
                setParticipant("");
              }}
            >
              {status.data?.rounds.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id}장 · {r.era}
                </option>
              ))}
            </select>
          </label>
          <p>
            {selected?.state ?? "불러오는 중"} ·{" "}
            {selected && time(selected.opens_at)}–
            {selected && time(selected.closes_at)} · 가격 버전{" "}
            {selected?.version ?? 0}
          </p>
          <TextField
            label="운영 사유"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
          />
          <div className={styles.actions}>
            <Button disabled={busy} onClick={() => void action("run")}>
              스케줄러 지금 확인
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
              거래 일시 정지
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
              거래 재개
            </Button>
          </div>
          <p className={styles.muted}>
            재개하면 지난 구간은 건너뛰고 마지막 공개 가격부터 이어갑니다. 마감
            시각은 바뀌지 않습니다.
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
                QA {selected?.update_interval_seconds ?? 30}초 진행
              </Button>
              <Button disabled={busy} onClick={() => void action("qa/next")}>
                QA 다음 장 개장
              </Button>
            </div>
          )}
        </section>
        <section className={styles.panel + " " + styles.adminSection}>
          <h2>속보와 섹터 사건</h2>
          <TextField
            label="속보 제목"
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
              속보 예약
            </Button>
          </div>
          <label>
            섹터
            <select value={sector} onChange={(e) => setSector(e.target.value)}>
              <option value="feed">사료·바이오</option>
              <option value="build">건설·자원</option>
              <option value="space">우주·방위</option>
            </select>
          </label>
          <TextField
            label="사건 변동률 (%)"
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
            섹터 사건 예약
          </Button>
          <p className={styles.muted}>
            다음 가격 구간에 속보와 가격 효과를 함께 공개합니다.
          </p>
        </section>
        <section className={styles.panel + " " + styles.adminSection}>
          <h2>참가자 관리</h2>
          <label>
            참가자
            <select
              value={participant}
              onChange={(e) => setParticipant(e.target.value)}
            >
              <option value="">참가자를 선택하세요</option>
              {people.map((p) => (
                <option key={p.participant_id} value={p.participant_id}>
                  {p.nickname}
                  {p.disqualified ? " (실격)" : ""}
                </option>
              ))}
            </select>
          </label>
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
              이 장에서 실격 처리
            </Button>
            <Button
              disabled={busy || !participant || !reason.trim()}
              onClick={() =>
                void action("recover", {
                  participant_id: Number(participant),
                  reason,
                })
              }
            >
              현장 확인 후 계좌 복구
            </Button>
          </div>
          {recovered && (
            <label>
              새 복구 토큰
              <textarea value={recovered} readOnly rows={3} />
              <small>
                이 토큰을 본인에게 전달하세요. 이전 기기의 토큰은
                폐기되었습니다.
              </small>
            </label>
          )}
          <p className={styles.muted}>
            닉네임과 현장 참가자를 확인한 뒤 처리하세요. 모든 변경은 사유와 함께
            기록합니다.
          </p>
        </section>
        <section className={styles.panel + " " + styles.adminSection}>
          <h2>시상 결과 확정</h2>
          {result ? (
            <>
              <p>
                {roundId}장 결과 버전 {result.revision} ·{" "}
                {result.confirmed ? "확정" : "확인 대기"}
              </p>
              {result.entries
                .filter((e) => e.eligible)
                .slice(0, 3)
                .map((e) => (
                  <p key={e.participant_id}>
                    {e.award_rank}위　{e.nickname}　
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
                이 결과로 시상 확정
              </Button>
            </>
          ) : (
            <p className={styles.muted}>장 마감 후 정산 결과가 생성됩니다.</p>
          )}
          <p className={styles.muted}>
            마감 후 실격 처리를 하면 새로운 결과 버전을 다시 확정해야 합니다.
          </p>
        </section>
      </div>
      <div style={{ marginTop: 24 }}>
        <AuditTab />
      </div>
    </>
  );
}
