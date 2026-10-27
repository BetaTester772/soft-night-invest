export type Language = 'ko' | 'en';
export const LANGUAGE_KEY = 'dino.language';
let memoryLanguage: Language | null = null;
let failedWrite = false;
let lastStored: string | null = null;
const listeners = new Set<() => void>();

export function detectLanguage(languages: readonly string[]): Language {
  for (const value of languages) {
    const language = value.toLowerCase().split(/[-_]/)[0];
    if (language === 'ko' || language === 'en') return language;
  }
  return 'en';
}

export function getLanguage(): Language {
  try {
    const saved = window.localStorage.getItem(LANGUAGE_KEY);
    if (failedWrite && saved === lastStored && memoryLanguage) return memoryLanguage;
    failedWrite = false;
    if (saved === 'ko' || saved === 'en') return saved;
  } catch {
    if (memoryLanguage) return memoryLanguage;
  }
  return detectLanguage(typeof navigator === 'undefined' ? [] :
    navigator.languages?.length ? navigator.languages : [navigator.language]);
}

export function setLanguage(language: Language): void {
  memoryLanguage = language;
  try { lastStored = window.localStorage.getItem(LANGUAGE_KEY); } catch { /* Storage may be blocked. */ }
  try {
    window.localStorage.setItem(LANGUAGE_KEY, language);
    failedWrite = false;
  } catch {
    failedWrite = true;
  }
  listeners.forEach((listener) => listener());
}

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea && event.storageArea !== window.localStorage) return;
    if (event.key === LANGUAGE_KEY || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener('languagechange', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('languagechange', listener);
  };
}

export const getLocale = () => getLanguage() === 'ko' ? 'ko-KR' : 'en-US';
