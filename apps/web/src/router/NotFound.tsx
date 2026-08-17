import { Link } from 'react-router-dom';
import { useLocale, useT } from '../i18n/useT';
import { buildLocalizedHref } from '../i18n/config';

export default function NotFound() {
  const t = useT();
  const locale = useLocale();

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold text-slate-900">{t('notFound.title')}</h1>
      <p className="text-sm text-muted">{t('notFound.hint')}</p>
      <Link to={buildLocalizedHref(locale, '/')} className="text-brand hover:underline">
        {t('notFound.backHome')}
      </Link>
    </div>
  );
}
