import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/auth/useAuth';
import { useLocale, useT } from '@/i18n/useT';
import { buildLocalizedHref } from '@/i18n/config';
import { useCustomerProfile, useUpdateCustomerProfile } from '@/surfaces/customer/data/addresses';
import { Button, Card, ErrorState, Field, QueryState, TextInput } from '@/components/ui';

/** `/app/account` */
export default function Account() {
  const t = useT();
  const locale = useLocale();
  const { user, logout } = useAuth();
  const query = useCustomerProfile();
  const update = useUpdateCustomerProfile();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    if (query.data?.profile) {
      setDisplayName(query.data.profile.displayName ?? '');
      setEmail(query.data.profile.email ?? '');
    }
  }, [query.data]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-4">
      <h1 className="text-lg font-semibold text-shop-ink">{t('app.account.title')}</h1>

      <Card title={t('app.account.phoneHeading')}>
        <p className="text-sm text-slate-700">{user?.phone}</p>
      </Card>

      <Card title={t('app.account.profileHeading')}>
        <QueryState
          status={query.status}
          error={query.error}
          data={query.data}
          loadingLabel={t('common.loading')}
          onRetry={() => void query.refetch()}
        >
          {() => (
            <div className="flex flex-col gap-3">
              <Field label={t('app.onboarding.nameLabel')}>
                {(id) => (
                  <TextInput
                    id={id}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    maxLength={120}
                  />
                )}
              </Field>
              <Field label={t('app.account.emailLabel')}>
                {(id) => (
                  <TextInput
                    id={id}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    maxLength={255}
                  />
                )}
              </Field>
              {update.isError ? <ErrorState error={update.error} /> : null}
              <Button
                variant="primary"
                disabled={update.isPending}
                onClick={() =>
                  update.mutate({ displayName: displayName.trim(), email: email.trim() || null })
                }
              >
                {update.isPending ? t('common.loading') : t('common.save')}
              </Button>
            </div>
          )}
        </QueryState>
      </Card>

      <Link
        to={buildLocalizedHref(locale, '/app/addresses')}
        className="min-h-touch rounded-xl border border-shop-line bg-white px-4 py-3 text-sm font-medium text-shop-ink"
      >
        {t('app.account.manageAddresses')}
      </Link>

      <Link
        to={buildLocalizedHref(locale, '/app/complaints')}
        className="min-h-touch rounded-xl border border-shop-line bg-white px-4 py-3 text-sm font-medium text-shop-ink"
      >
        {t('app.account.myComplaints')}
      </Link>

      <Button variant="danger" onClick={() => void logout()}>
        {t('nav.logout')}
      </Button>
    </div>
  );
}
