import { Link } from 'react-router-dom';
import { ShieldOff } from 'lucide-react';
import { useLocale, useT } from '../../i18n/useT';
import { buildLocalizedHref } from '../../i18n/config';
import { Card } from '../../components/ui';

/**
 * `/admin/register` — deliberately not a form.
 *
 * A public route that could mint an admin account would let anyone grant
 * themselves refund and payout powers (see `apps/api/src/modules/auth/
 * admin-login.ts`'s own comment on why the ops sign-in is two factors in the
 * first place — a self-service register endpoint would make the second
 * factor pointless). The route exists only so a stray link or bookmark
 * lands on an explanation instead of a 404 or, worse, an actual form.
 *
 * **Flag for the product owner:** this route was added on a mid-task
 * clarification, not the original brief — worth a second look before
 * treating it as final product decision.
 */
export default function AdminRegisterPlaceholder() {
  const t = useT();
  const locale = useLocale();

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <Card>
        <div className="flex flex-col items-center gap-3 text-center">
          <ShieldOff className="h-8 w-8 text-muted" aria-hidden="true" strokeWidth={1.5} />
          <h1 className="text-base font-semibold text-slate-900">
            {t('auth.admin.registerBlockedTitle')}
          </h1>
          <p className="text-sm text-muted">{t('auth.admin.registerBlockedBody')}</p>
          <Link
            to={buildLocalizedHref(locale, '/admin/login')}
            className="inline-flex min-h-touch w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-base font-medium text-slate-900 transition-colors duration-150 hover:bg-slate-50"
          >
            {t('auth.admin.backToLogin')}
          </Link>
        </div>
      </Card>
    </div>
  );
}
