import { formatNumber } from "../lib/format";

export const won = (n: number) => formatNumber(Math.floor(n)) + "원";
export const pct = (n: number) =>
  (n > 0 ? "+" : "") + (n * 100).toFixed(2) + "%";
export const tone = (n: number) => (n > 0 ? "up" : n < 0 ? "down" : "flat");
export const time = (s: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(s));
export const units = (n: number) =>
  (n / 1_000_000).toFixed(6).replace(/\.?0+$/, "");
export function parseUnits(value: string): number {
  if (!/^\d+(\.\d{1,6})?$/.test(value)) return 0;
  const [whole = "0", fraction = ""] = value.split(".");
  const result = Number(whole) * 1_000_000 + Number(fraction.padEnd(6, "0"));
  return Number.isSafeInteger(result) ? result : 0;
}
