import type { ApiError } from '../../api';
import { withObjectParticle } from '../../lib/format';
import { Alert, Button } from '../ui';
import { t, useLanguage } from '../../i18n';

/** Standard "couldn't load" message with a retry button. */
export function LoadError({ error, onRetry, what = '정보' }: { error: ApiError; onRetry?: () => void; what?: string }) {
  const language = useLanguage();
  return (
    <Alert
      tone="danger"
      title={language === 'en' ? t('{what} 불러오지 못했습니다', { what: t(what) }) : `${withObjectParticle(what)} 불러오지 못했습니다`}
      action={
        onRetry && (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            {t('다시 불러오기')}
          </Button>
        )
      }
    >
      {t(error.message)}
    </Alert>
  );
}
