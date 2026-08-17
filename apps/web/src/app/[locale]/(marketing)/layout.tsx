import type { ReactNode } from 'react';
import { DEFAULT_LOCALE, isSupportedLocale } from '@/i18n/config';
import { MarketingNav } from '@/components/marketing/Nav';
import { MarketingFooter } from '@/components/marketing/Footer';

/**
 * Surface A — the public marketing/SEO site (PHASE12_PROMPT.md §A).
 *
 * A route group (parens) so it adds no `/marketing` URL segment — `/`,
 * `/services`, `/contact`, ... all resolve straight here. Every page under
 * this layout is SSG/ISR and indexed; that split is enforced by NOT having
 * this layout redirect or gate anything (unlike `app/layout.tsx` and
 * `partner/layout.tsx`, both of which check for a session cookie before
 * rendering) — a signed-out visitor from a WhatsApp link must reach a fully
 * rendered page on the first request, no client-side auth check in the way.
 */
export default async function MarketingLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = isSupportedLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;

  return (
    <div className="flex min-h-screen flex-col">
      <MarketingNav locale={locale} />
      <main className="flex-1">{children}</main>
      <MarketingFooter locale={locale} />
    </div>
  );
}
