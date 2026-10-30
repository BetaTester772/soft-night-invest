import { t, useLanguage } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { Button, Modal, TextField } from "../components/ui";
import { boothApi } from "./api";
import { boothTokenStore } from "../api/storage";
import { formatNumber } from "../lib/format";
import { averagePrice, parseUnits, units, won } from "./format";
import type { BoothState, OrderBody, TradeTarget } from "./types";
import styles from "./Booth.module.css";

export function TradeDialog({
  target,
  data,
  onClose,
  onFilled,
  sessionToken,
  onSessionChanged,
}: {
  target: TradeTarget;
  data: BoothState;
  onClose: () => void;
  onFilled: () => void;
  sessionToken: string | null;
  onSessionChanged: () => void;
}) {
  useLanguage();
  const intendedToken = useRef(sessionToken);
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
  const maxBuyQuantity =
    stock && stock.price > 0
      ? Math.min(1_000_000_000, Math.floor((data.me?.cash ?? 0) / stock.price))
      : 0;
  const stockHolding = data.me?.holdings.find((h) => h.code === target.code);
  const fundHolding = data.me?.funds.find((h) => h.code === target.code);
  const held = target.kind === "stock"
    ? (stockHolding?.quantity ?? 0) : (fundHolding?.units ?? 0);
  const cost = target.kind === "stock"
    ? (stockHolding?.cost ?? 0) : (fundHolding?.cost ?? 0);
  const name = stock?.name ?? fund?.name ?? target.code;
  const closed =
    !data.round.is_open ||
    data.round.id !== target.round_id ||
    Boolean(data.me?.disqualified);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || closed) return;
    if (boothTokenStore.get() !== intendedToken.current) {
      onSessionChanged();
      return;
    }
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
    setBusy(true);
    setError("");
    try {
      if (request.current?.signature !== signature) {
        const id =
          crypto.randomUUID?.() ??
          Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join("");
        request.current = { signature, id };
      }
      await boothApi.order(
        { ...body, request_id: request.current.id },
        intendedToken.current,
      );
      if (mounted.current) {
        if (boothTokenStore.get() === intendedToken.current) onFilled();
        else onSessionChanged();
      }
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
      ? t("거래할 수량 (주)")
      : side === "buy"
        ? t("투자할 금액 (원)")
        : t("환매할 좌수");
  const verb =
    target.kind === "fund"
      ? side === "buy"
        ? t("펀드 매수하기")
        : t("펀드 환매하기")
      : side === "buy"
        ? t("주식 매수하기")
        : t("주식 매도하기");
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
          ? t("매수한 시점의 기준가부터 내 수익률에 반영됩니다.")
          : t("서버의 현재 공시 가격으로 즉시 체결합니다.")
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
            {t("매수")}
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
            {target.kind === "fund" ? t("환매") : t("매도")}
          </button>
        </div>
        <dl className={styles.priceSummary}>
          <div className={styles.averagePrice}>
            <dt>{t("평단가")}</dt>
            <dd>{averagePrice(cost, held, target.kind === "fund" ? 1_000_000 : 1)}</dd>
          </div>
          <div>
            <dt>{target.kind === "fund" ? t("기준가") : t("현재가")}</dt>
            <dd>{won(target.kind === "fund" ? fund?.nav ?? 0 : stock?.price ?? 0)}</dd>
          </div>
        </dl>
        <TextField
          label={label}
          hint={
            target.kind === "stock" && side === "buy"
              ? t("최대 구매 가능 수량: {quantity}주 (현재가 기준)", {
                  quantity: formatNumber(maxBuyQuantity),
                })
              : undefined
          }
          inputMode={
            target.kind === "fund" && side === "sell" ? "decimal" : "numeric"
          }
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={busy}
          required
        />
        <p className={styles.muted}>
          {t("주문 가능 현금")}{" "}{won(data.me?.cash ?? 0)}{" "}{t("· 보유")}{" "}
          {target.kind === "fund" ? units(held) + t("좌") : held + t("주")}
        </p>
        {closed && (
          <p role="alert" className={styles.error}>{t("거래가 중단되었거나 마감되었습니다.")}</p>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {t(error)}
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
