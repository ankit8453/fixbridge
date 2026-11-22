import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth/useAuth';
import { useLocale, useT } from '@/i18n/useT';
import { buildLocalizedHref } from '@/i18n/config';
import { APP_NAME, BrandLogo } from '@/brand/tokens';
import { Button, Card, Spinner } from '@/components/ui';
import { LocaleToggle } from '@/components/shell/LocaleToggle';
import {
  acceptLegal,
  fetchLegalStatus,
  LEGAL_VERSION_OUTDATED,
  legalKeys,
  statusFor,
  type LegalDocument,
} from './api';

/**
 * "Accept the terms to continue" — a full-page gate in front of a signed-in
 * surface (`/app` → Customer Terms, `/partner` → Partner Agreement).
 *
 * Rendered INSTEAD of the surface, never on top of it as a dismissible modal:
 * the acceptance is evidence (the API records version, time, IP and
 * user-agent), so there must be no way to use the surface without it. Equally
 * there must be no way to get stuck — every state, including a failed load,
 * offers Sign out.
 *
 * Mounted inside `RequireAuth`, so a session always exists by the time this
 * renders. The query key carries the user id (see `legalKeys`), which is what
 * keeps one person's acceptance from ever being served from cache to the next
 * person who signs in on the same device — the app has no global
 * "clear per-user queries on sign-out" step to rely on.
 */

type Tone = 'shop' | 'primary';

interface DocumentCopy {
  prefix: 'legalGate.customer' | 'legalGate.partner';
  links: { href: string; labelKey: string }[];
}

const COPY: Record<LegalDocument, DocumentCopy> = {
  customer_terms: {
    prefix: 'legalGate.customer',
    links: [
      { href: '/terms', labelKey: 'legalGate.customer.terms' },
      { href: '/privacy', labelKey: 'legalGate.privacy' },
      { href: '/refund-policy', labelKey: 'legalGate.customer.refund' },
    ],
  },
  partner_terms: {
    prefix: 'legalGate.partner',
    links: [
      { href: '/partner-terms', labelKey: 'legalGate.partner.agreement' },
      { href: '/privacy', labelKey: 'legalGate.privacy' },
    ],
  },
};

const BULLETS = ['b1', 'b2', 'b3', 'b4', 'b5'] as const;

export function LegalGate({
  document,
  tone = 'primary',
  children,
}: {
  document: LegalDocument;
  /** `shop` for the customer storefront's palette, `primary` for the partner app's. */
  tone?: Tone;
  children: ReactNode;
}) {
  const t = useT();
  const { user } = useAuth();
  const queryKey = legalKeys.me(user?.id);
  // Lives here, not in `TermsScreen`: the 409 that sets it is followed by a
  // refetch that remounts `TermsScreen` for the new version, and the message
  // has to survive that.
  const [outdated, setOutdated] = useState(false);

  const query = useQuery({ queryKey, queryFn: fetchLegalStatus });

  // Data first: a failed background refetch (e.g. the one after a 409) keeps
  // the last good answer on screen rather than swapping to the error state.
  if (query.data) {
    const status = statusFor(query.data, document);
    if (status.accepted) return <>{children}</>;

    return (
      <TermsScreen
        // Remount on a version change so the checkbox can never carry over
        // from the version the person actually read.
        key={status.currentVersion}
        document={document}
        version={status.currentVersion}
        tone={tone}
        outdated={outdated}
        onOutdated={() => setOutdated(true)}
      />
    );
  }

  if (query.isError) {
    return (
      <GateFrame tone={tone}>
        <Card>
          <h1 className="text-xl font-semibold text-slate-900">{t('legalGate.title')}</h1>
          <p role="alert" className="mt-3 flex items-start gap-2 text-base text-slate-700">
            <AlertTriangle
              className="mt-0.5 h-5 w-5 shrink-0 text-danger"
              aria-hidden="true"
              strokeWidth={2}
            />
            <span>{t('legalGate.loadError')}</span>
          </p>
          <div className="mt-5 flex flex-col gap-2">
            <Button
              variant={tone}
              size="lg"
              fullWidth
              loading={query.isFetching}
              onClick={() => void query.refetch()}
            >
              {t('legalGate.retry')}
            </Button>
            <SignOutButton />
          </div>
        </Card>
      </GateFrame>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <Spinner label={t('common.loading')} />
    </div>
  );
}

function TermsScreen({
  document,
  version,
  tone,
  outdated,
  onOutdated,
}: {
  document: LegalDocument;
  version: string;
  tone: Tone;
  /** Set once a POST came back 409 — shows the "just updated" notice. */
  outdated: boolean;
  onOutdated: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = legalKeys.me(user?.id);
  const copy = COPY[document];

  const [checked, setChecked] = useState(false);

  const mutation = useMutation({
    mutationFn: () => acceptLegal(document, version),
    onSuccess: (status) => {
      queryClient.setQueryData(queryKey, status);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === LEGAL_VERSION_OUTDATED) {
        // The terms changed while this screen was open. Keep the gate up,
        // make them tick the box again for the new version, and fetch it.
        onOutdated();
        setChecked(false);
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });

  const otherError =
    mutation.isError &&
    !(mutation.error instanceof ApiError && mutation.error.code === LEGAL_VERSION_OUTDATED);

  return (
    <GateFrame tone={tone}>
      <Card>
        <h1 className="text-xl font-semibold text-slate-900">{t('legalGate.title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('legalGate.version', { version })}</p>

        {outdated ? (
          <p
            role="alert"
            className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          >
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
              aria-hidden="true"
              strokeWidth={2}
            />
            <span>{t(`${copy.prefix}.outdated`)}</span>
          </p>
        ) : null}

        <p className="mt-3 text-base text-slate-700">{t(`${copy.prefix}.intro`)}</p>

        <ul className="mt-4 flex flex-col gap-3">
          {BULLETS.map((bullet) => (
            <li key={bullet} className="flex items-start gap-2.5 text-sm text-slate-800">
              <CheckCircle2
                className={`mt-0.5 h-4 w-4 shrink-0 ${tone === 'shop' ? 'text-shop' : 'text-brand'}`}
                aria-hidden="true"
                strokeWidth={2}
              />
              <span>{t(`${copy.prefix}.${bullet}`)}</span>
            </li>
          ))}
        </ul>

        <ul className="mt-5 flex flex-wrap gap-2">
          {copy.links.map((link) => (
            <li key={link.href}>
              <a
                href={buildLocalizedHref(locale, link.href)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-touch items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-slate-800 underline-offset-2 hover:bg-slate-50 hover:underline"
              >
                {t(link.labelKey)}
                <ExternalLink className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>

        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-slate-50 p-3 text-sm text-slate-800">
          <input
            type="checkbox"
            className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
            disabled={mutation.isPending}
          />
          <span>{t(`${copy.prefix}.checkbox`)}</span>
        </label>

        {otherError ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {t('common.errorGeneric')}
          </p>
        ) : null}

        <div className="mt-5 flex flex-col gap-2">
          <Button
            variant={tone}
            size="lg"
            fullWidth
            disabled={!checked}
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {t('legalGate.accept')}
          </Button>
          <SignOutButton />
        </div>
      </Card>
    </GateFrame>
  );
}

function SignOutButton() {
  const t = useT();
  const { logout } = useAuth();
  const [pending, setPending] = useState(false);

  return (
    <Button
      variant="ghost"
      fullWidth
      loading={pending}
      onClick={() => {
        setPending(true);
        // `RequireAuth` redirects to the sign-in page once the session is gone.
        void logout().finally(() => setPending(false));
      }}
    >
      {t('legalGate.signOut')}
    </Button>
  );
}

function GateFrame({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <div
      className={`min-h-dvh px-4 py-6 sm:py-10 ${tone === 'shop' ? 'bg-shop-ground' : 'bg-slate-50'}`}
    >
      <main className="mx-auto flex w-full max-w-lg flex-col gap-4">
        <header className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <BrandLogo size={24} />
            <span className="text-base font-bold tracking-tight text-slate-900">{APP_NAME}</span>
          </span>
          <LocaleToggle />
        </header>
        {children}
      </main>
    </div>
  );
}
