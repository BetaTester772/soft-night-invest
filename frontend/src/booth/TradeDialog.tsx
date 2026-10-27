import { useEffect, useRef, useState } from "react";
import { Button, Modal, TextField } from "../components/ui";
import { boothApi } from "./api";
import { parseUnits, units, won } from "./format";
import type { BoothState, OrderBody, TradeTarget } from "./types";
import styles from "./Booth.module.css";

export function TradeDialog({
  target,
  data,
  onClose,
  onFilled,
}: {
  target: TradeTarget;
  data: BoothState;
  onClose: () => void;
  onFilled: () => void;
}) {
  const [side, setSide] = useState<"buy" | "sell">(target.side ?? "buy");
  const [value, setValue] = useState(
    target.kind === "fund" && target.side !== "sell" ? "100000" : "1",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<{ signature: string; id: string } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const stock = data.instruments.find((i) => i.code === target.code);
  const fund = data.funds.find((f) => f.code === target.code);
  const held =
    target.kind === "stock"
      ? (data.me?.holdings.find((h) => h.code === target.code)?.quantity ?? 0)
      : (data.me?.funds.find((h) => h.code === target.code)?.units ?? 0);
  const name = stock?.name ?? fund?.name ?? target.code;
  const closed =
    !data.round.is_open ||
    data.round.id !== target.round_id ||
    Boolean(data.me?.disqualified);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || closed) return;
    const amount =
      target.kind === "fund" && side === "sell"
        ? parseUnits(value)
        : Number(value);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      setError("0보다 큰 올바른 수량이나 금액을 입력하세요.");
      return;
    }
    const body: Omit<OrderBody, "request_id"> = {
      round_id: target.round_id,
      kind: target.kind,
      code: target.code,
      side,
      ...(target.kind === "stock"
        ? { quantity: amount }
        : side === "buy"
          ? { amount }
          : { units: amount }),
    };
    const signature = JSON.stringify(body);
    if (request.current?.signature !== signature)
      request.current = { signature, id: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      await boothApi.order({ ...body, request_id: request.current.id });
      if (mounted.current) onFilled();
    } catch (err) {
      if (mounted.current)
        setError(
          err instanceof Error ? err.message : "주문을 처리하지 못했습니다.",
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const label =
    target.kind === "stock"
      ? "거래할 수량 (주)"
      : side === "buy"
        ? "투자할 금액 (원)"
        : "환매할 좌수";
  const verb =
    target.kind === "fund"
      ? side === "buy"
        ? "펀드 매수하기"
        : "펀드 환매하기"
      : side === "buy"
        ? "주식 매수하기"
        : "주식 매도하기";
  return (
    <Modal
      open
      title={name}
      onClose={() => {
        if (!busy) onClose();
      }}
      closeOnBackdrop={!busy}
      description={
        target.kind === "fund"
          ? "매수한 시점의 기준가부터 내 수익률에 반영됩니다."
          : "서버의 현재 공시 가격으로 즉시 체결합니다."
      }
    >
      <form onSubmit={submit} className={styles.form}>
        <div className={styles.switcher}>
          <button
            type="button"
            aria-pressed={side === "buy"}
            disabled={busy}
            onClick={() => {
              setSide("buy");
              setValue(target.kind === "fund" ? "100000" : "1");
            }}
          >
            매수
          </button>
          <button
            type="button"
            aria-pressed={side === "sell"}
            disabled={busy}
            onClick={() => {
              setSide("sell");
              setValue(target.kind === "fund" ? units(held) : "1");
            }}
          >
            {target.kind === "fund" ? "환매" : "매도"}
          </button>
        </div>
        <p className={styles.muted}>
          {target.kind === "fund"
            ? "기준가 " + won(fund?.nav ?? 0)
            : "현재가 " + won(stock?.price ?? 0)}
        </p>
        <TextField
          label={label}
          inputMode={
            target.kind === "fund" && side === "sell" ? "decimal" : "numeric"
          }
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={busy}
          required
        />
        <p className={styles.muted}>
          주문 가능 현금 {won(data.me?.cash ?? 0)} · 보유{" "}
          {target.kind === "fund" ? units(held) + "좌" : held + "주"}
        </p>
        {closed && (
          <p role="alert" className={styles.error}>
            거래가 중단되었거나 마감되었습니다.
          </p>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <Button
          type="submit"
          fullWidth
          loading={busy}
          disabled={closed}
          className={styles.solid}
        >
          {verb}
        </Button>
      </form>
    </Modal>
  );
}
