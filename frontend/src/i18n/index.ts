import { useEffect, useSyncExternalStore } from 'react';
import { getLanguage, subscribeLanguage } from './locale';
import { english } from './messages';
export { getLanguage, getLocale, setLanguage } from './locale';

export function useLanguage() {
  return useSyncExternalStore(subscribeLanguage, getLanguage, () => 'en' as const);
}

/** Only translate application copy; user names and operator-authored content stay intact. */
export function t(message: string, values: Record<string, string | number> = {}): string {
  const language = getLanguage();
  let translated = language === 'en' && Object.hasOwn(english, message) ? english[message] ?? message : message;
  if (language === 'en' && translated === message) {
    translated = message
      .replace(/^보안 확인 중 오류가 났습니다\(([^)]+)\)\. 페이지를 새로고침한 뒤 다시 시도해 주세요\.$/, (_, code: string) =>
        t('보안 확인 중 오류가 났습니다({code}). 페이지를 새로고침한 뒤 다시 시도해 주세요.', { code }))
      .replace(/^시세 계산이 (\d+)초 이상 지연되었습니다\.$/, 'Price updates have been delayed for more than $1 seconds.')
      .replace(/^공룡 귀신 출몰! (.+) 섹터 (급등|급락)$/, (_, sector: string, move: string) =>
        `Dinosaur ghost sighting! ${english[sector] ?? sector} stocks ${move === '급등' ? 'surge' : 'plunge'}.`)
      .replace(/^거래 정지 중 예정된 공룡 귀신 사건 (\d+)건을 취소했습니다\.$/, 'Cancelled $1 dinosaur ghost events scheduled during the trading pause.');
    translated = translated
      .replace(/^인증 코드가 맞지 않습니다\. (\d+)번 더 시도할 수 있습니다\.$/, 'The verification code is incorrect. You have $1 attempts left.')
      .replace(/^(\d+)초 뒤에 다시 요청할 수 있습니다\.$/, 'You can request another code in $1 seconds.')
      .replace(/^요청을 처리하지 못했습니다\. \(HTTP (\d+)\)$/, 'Unable to process the request. (HTTP $1)')
      .replace(/^입력한 값을 다시 확인해 주세요\. \((.*)\)$/, 'Please check your input. ($1)');
  }
  return translated.replace(/\{(\w+)\}/g, (placeholder, key: string) => String(values[key] ?? placeholder));
}

export function useDocumentLanguage() {
  const language = useLanguage();
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = t('난 운석이 떨어진 줄 알았지');
  }, [language]);
}
