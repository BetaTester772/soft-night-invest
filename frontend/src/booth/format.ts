import { formatNumber } from "../lib/format";
import { getLanguage, getLocale } from '../i18n/locale';

export const won = (n: number) => getLanguage() === 'ko'
  ? formatNumber(Math.floor(n)) + '원'
  : 'KRW ' + new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 0 }).format(Math.floor(n));
export const pct = (n: number) =>
  (n > 0 ? "+" : "") + (n * 100).toFixed(2) + "%";
export const tone = (n: number) => (n > 0 ? "up" : n < 0 ? "down" : "flat");
export const time = (s: string) =>
  new Intl.DateTimeFormat(getLocale(), {
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
