import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight, BadgeCheck, CalendarClock, Wallet } from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import type { ComponentType } from 'react';
import { useT } from '../../../i18n/useT';
import { Button, ErrorState, Field, TextInput } from '../../../components/ui';
import { APP_NAME, BrandLogo } from '../../../brand/tokens';
import { refreshAccessToken } from '../../../lib/auth/session';
import { registerProvider } from '../lib/api';

/**
 * "Become a partner" — the whole reason `POST /providers/me/register` is open
 * to any authenticated user and not just technicians (docs/API.md,
 * Providers). Any customer landing on `/partner` sees this instead of a
 * wall — see `PartnerAppEntry`'s own comment on why the route guard is
 * `RequireAuth`, not `RequireRole('technician')`.
 *
 * This is the one screen in the surface that renders *outside* `AppShell`, so
 * it owns its own centring and padding rather than inheriting `<main>`'s.
 * It is also the only marketing surface a signed-in customer sees, so it is
 * built as a pitch — the three benefits carry an icon each and the sign-up
 * sits in a card of its own — rather than as a form with a heading on top.
 */
export function BecomePartnerGate() {
  const t = useT();
  const [displayName, setDisplayName] = useState('');

  const mutation = useMutation({
    mutationFn: () => registerProvider(displayName.trim() || undefined),
    onSuccess: async () => {
      /**
       * Roles are baked into the access token. `refreshAccessToken` rotates
       * the in-memory token, but nothing in this component's render tree
       * re-derives `roles` from a token that changed underneath it without a
       * fresh mount — `useAuth()`'s `roles` comes from the `user` set at
       * login/refresh time, and there is no mechanism here to re-fetch that
       * without a full reload. A hard reload is the honest way to get one
       * without reaching into `lib/auth/**`, which is out of this surface's
       * lane; a client-side re-render would keep showing this same gate with
       * the new role invisible until the next navigation anyway.
       */
      await refreshAccessToken();
      window.location.reload();
    },
  });

  const benefits: { icon: ComponentType<LucideProps>; text: string }[] = [
    { icon: CalendarClock, text: t('partner.gate.bullet1') },
    { icon: Wallet, text: t('partner.gate.bullet2') },
    { icon: BadgeCheck, text: t('partner.gate.bullet3') },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 lg:px-8 lg:py-16">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:items-center lg:gap-12">
        {/* ---------------- The pitch ---------------- */}
        <div className="min-w-0">
          <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
            <BrandLogo size={16} />
            {APP_NAME}
          </span>

          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-slate-900 lg:text-4xl">
            {t('partner.gate.title')}
          </h1>
          <p className="mt-3 max-w-prose text-base leading-relaxed text-slate-600 lg:text-lg">
            {t('partner.gate.pitch')}
          </p>

          <ul className="mt-8 flex flex-col gap-4">
            {benefits.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand"
                >
                  <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
                </span>
                <span className="pt-1.5 text-sm leading-relaxed text-slate-700">{text}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* ---------------- The sign-up ---------------- */}
        <div className="min-w-0">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:p-6">
            <h2 className="text-base font-semibold tracking-tight text-slate-900">
              {t('partner.gate.formTitle')}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-500">
              {t('partner.gate.formHint')}
            </p>

            <div className="mt-5 flex flex-col gap-4">
              <Field label={t('partner.gate.nameLabel')} hint={t('partner.gate.nameHint')}>
                {(id) => (
                  <TextInput
                    id={id}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={t('partner.gate.namePlaceholder')}
                  />
                )}
              </Field>

              {mutation.isError ? (
                <ErrorState error={mutation.error} onRetry={() => mutation.reset()} />
              ) : null}

              <Button
                variant="primary"
                size="lg"
                fullWidth
                loading={mutation.isPending}
                onClick={() => mutation.mutate()}
              >
                {mutation.isPending ? t('partner.gate.submitting') : t('partner.gate.submit')}
                {mutation.isPending ? null : (
                  <ArrowRight className="h-4 w-4" aria-hidden="true" strokeWidth={2.25} />
                )}
              </Button>

              <p className="text-center text-xs leading-relaxed text-slate-500">
                {t('partner.gate.freeNote')}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
