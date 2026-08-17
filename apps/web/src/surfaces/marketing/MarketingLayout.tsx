import { Outlet } from 'react-router-dom';
import { useLocale } from '@/i18n/useT';
import { MarketingNav } from './components/Nav';
import { MarketingFooter } from './components/Footer';

/**
 * Surface A — the public marketing/SEO site. Ported from
 * `legacy-next-src/app/[locale]/(marketing)/layout.tsx`: nav + page + footer,
 * nothing gated. Every route nested under this (see `MarketingEntry.tsx`)
 * must render fully for a signed-out visitor arriving from a WhatsApp link —
 * no auth check anywhere in this tree, unlike the customer/partner shells.
 */
export function MarketingLayout() {
  const locale = useLocale();

  return (
    <div className="flex min-h-dvh flex-col">
      <MarketingNav locale={locale} />
      <main className="flex-1">
        <Outlet />
      </main>
      <MarketingFooter locale={locale} />
    </div>
  );
}
