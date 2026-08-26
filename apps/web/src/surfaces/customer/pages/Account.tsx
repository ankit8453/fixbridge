import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth/useAuth';
import { useLocale, useT } from '@/i18n/useT';
import { buildLocalizedHref } from '@/i18n/config';
import { useCustomerProfile, useUpdateCustomerProfile } from '@/surfaces/customer/data/addresses';
import { ErrorState, Field, QueryState, TextInput, SkeletonText } from '@/components/ui';
import {
  AddressBookIcon,
  ComplaintIcon,
  PageHeading,
  ShopButton,
} from '@/surfaces/customer/components/notifications/shopUi';

/**
 * `/app/account` — who you are, how we reach you, and the way out.
 *
 * ## Why this is one panel and not four cards
 *
 * The screen was a `Card` per fact: a card holding one phone number, a card
 * holding two inputs, then two bordered links, then a button — five bordered
 * boxes for what is really one short form. Following `Home.tsx`, the only
 * bordered containers left are the ones you can act on: the identity summary
 * reads as plain type on the page, the editable fields sit in a single panel,
 * and the two shortcuts are rows you tap.
 *
 * The locale switcher deliberately does not appear here — it already lives in
 * the shell's top bar, and a second one would leave two controls that can
 * disagree about which is authoritative.
 */
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

  const savedName = query.data?.profile?.displayName?.trim() ?? '';
  // Initials, not an uploaded photo — there is no avatar upload in this phase,
  // and a generic silhouette says less than the customer's own first letters.
  const initials = savedName
    ? savedName
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? '')
        .join('')
    : null;

  return (
    <div className="flex w-full flex-col gap-5">
      {/* ---------------- Identity ---------------- */}
      <section className="flex items-center gap-3.5">
        <span
          aria-hidden="true"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-shop text-[19px] font-bold tracking-tight text-shop-foreground shadow-sm"
        >
          {initials ?? <PersonGlyph className="h-6 w-6" />}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-[22px] font-bold leading-tight tracking-tight text-shop-ink lg:text-[26px]">
            {savedName || t('app.account.title')}
          </h1>
          <p className="mt-0.5 text-[13px] font-medium text-shop-ink-soft">
            <span className="sr-only">{t('app.account.phoneHeading')}: </span>
            {user?.phone}
          </p>
        </div>
      </section>

      {/* ---------------- Editable details ---------------- */}
      <section className="rounded-2xl border border-shop-line bg-white p-4 shadow-sm">
        <h2 className="text-[15px] font-bold tracking-tight text-shop-ink">
          {t('app.account.profileHeading')}
        </h2>
        <p className="mt-0.5 text-[13px] text-shop-ink-soft">{t('app.account.profileHint')}</p>

        <div className="mt-3.5">
          <QueryState
            status={query.status}
            error={query.error}
            data={query.data}
            loadingLabel={t('common.loading')}
            onRetry={() => void query.refetch()}
          >
            {() => (
              <div className="flex flex-col gap-3">
                {/* Two short fields side by side from `sm` up. Stacked, they
                    cost two full rows for a name and an email. */}
                <div className="grid gap-3 sm:grid-cols-2">
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
                </div>

                {update.isError ? <ErrorState error={update.error} /> : null}

                {/* The confirmation sits BESIDE the button, not above it:
                    above, a successful save pushes the button down and out
                    from under the pointer that just clicked it. */}
                <div className="flex items-center gap-3">
                  <ShopButton
                    tone="primary"
                    disabled={update.isPending}
                    onClick={() =>
                      update.mutate({
                        displayName: displayName.trim(),
                        email: email.trim() || null,
                      })
                    }
                  >
                    {update.isPending ? t('common.loading') : t('common.save')}
                  </ShopButton>
                  {update.isSuccess && !update.isPending ? (
                    <p role="status" className="text-[13px] font-medium text-shop">
                      {t('app.account.saved')}
                    </p>
                  ) : null}
                </div>
              </div>
            )}
          </QueryState>
          {query.status === 'pending' ? (
            <div className="mt-3">
              <SkeletonText lines={2} />
            </div>
          ) : null}
        </div>
      </section>

      {/* ---------------- Shortcuts ----------------
          Two taps, one bordered group rather than two free-floating boxes. */}
      <nav aria-label={t('app.account.shortcutsLabel')}>
        <PageHeading as="h2">{t('app.account.shortcutsLabel')}</PageHeading>
        <ul className="mt-2 divide-y divide-shop-line overflow-hidden rounded-2xl border border-shop-line bg-white shadow-sm">
          {[
            {
              to: '/app/addresses',
              label: t('app.account.manageAddresses'),
              hint: t('app.account.manageAddressesHint'),
              Icon: AddressBookIcon,
            },
            {
              to: '/app/complaints',
              label: t('app.account.myComplaints'),
              hint: t('app.account.myComplaintsHint'),
              Icon: ComplaintIcon,
            },
          ].map(({ to, label, hint, Icon }) => (
            <li key={to}>
              <Link
                to={buildLocalizedHref(locale, to)}
                className="flex min-h-touch items-center gap-3 px-4 py-3 transition-colors hover:bg-shop-soft/60"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-shop-soft text-shop">
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold leading-tight text-shop-ink">
                    {label}
                  </span>
                  <span className="block truncate text-[12.5px] text-shop-ink-soft">{hint}</span>
                </span>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-shop-ink-soft"
                  aria-hidden="true"
                  strokeWidth={2.25}
                />
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {/* ---------------- Sign out ----------------
          Quiet by default: signing out is not the goal of this screen, and a
          full-width red slab makes it the loudest thing on the page. */}
      <div>
        <button
          type="button"
          onClick={() => void logout()}
          className="inline-flex min-h-touch items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" strokeWidth={2.25} />
          {t('nav.logout')}
        </button>
      </div>
    </div>
  );
}

/** Fallback avatar mark — a shoulder line and a head, on the same 24px grid as `CategoryIcon`. */
function PersonGlyph({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <circle
        cx="12"
        cy="8.5"
        r="3.75"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4.75 19.5a7.25 7.25 0 0 1 14.5 0"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
