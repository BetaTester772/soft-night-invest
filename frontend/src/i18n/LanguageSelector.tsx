import { setLanguage, useLanguage } from '.';
import styles from './LanguageSelector.module.css';

export function LanguageSelector() {
  const language = useLanguage();
  return (
    <div className={styles.selector} role="group" aria-label={language === 'ko' ? '언어 선택' : 'Choose language'}>
      <button type="button" lang="ko" aria-pressed={language === 'ko'} onClick={() => setLanguage('ko')}>한국어</button>
      <button type="button" lang="en" aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>English</button>
    </div>
  );
}
