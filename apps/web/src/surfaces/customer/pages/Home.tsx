import { ShieldCheck, Star, Clock } from 'lucide-react';
import { useT } from '@/i18n/useT';
import { SearchBox } from '@/surfaces/customer/components/find/SearchBox';
import { CategoryGrid } from '@/surfaces/customer/components/find/CategoryGrid';
import { LocationBar } from '@/surfaces/customer/components/find/LocationBar';
import { useResolvedLocation } from '@/surfaces/customer/components/find/useResolvedLocation';

/**
 * `/app` — the screen that has to earn the booking.
 *
 * This is the customer's first and most-used surface. It was a bare stack of a
 * location row, a search box and a grid of emoji on white boxes; then it was
 * the partner dashboard's indigo shell with different words. Neither was right.
 *
 * A customer is not an operator. They are deciding whether to let a stranger
 * into their house, and the register for that is warm and human — coral on
 * cream, soft shapes, a person's promise rather than a control panel. The
 * partner app stays cool indigo precisely so the two never feel like the same
 * screen.
 *
 * The trust strip is not decoration: verified, rated and same-day are the
 * product's actual differentiators against the national platforms, and they
 * belong where a first-time customer is asking the question, not buried.
 */
export default function Home() {
  const t = useT();
  const location = useResolvedLocation();

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      {/* ---------------- Hero ---------------- */}
      <section className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-shop-bright via-shop to-shop-deep p-6 shadow-[0_12px_32px_-12px_rgba(194,65,12,0.45)] lg:p-10">
        {/* Decorative warmth. `aria-hidden` — a screen reader announcing a
            blurred circle is noise. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-shop-accent/40 blur-3xl"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-28 -left-16 h-56 w-56 rounded-full bg-white/15 blur-3xl"
        />

        <div className="relative lg:max-w-2xl">
          <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm">
            {t('app.find.heroEyebrow')}
          </p>
          <h1 className="text-[26px] font-bold leading-[1.15] tracking-tight text-white lg:text-[40px]">
            {t('app.find.heroTitle')}
          </h1>
          <p className="mt-2.5 max-w-lg text-sm leading-relaxed text-white/90 lg:text-[17px]">
            {t('app.find.heroSubtitle')}
          </p>

          {/* The search box lives inside the hero: it is the primary action,
              and somebody who knows what broke should not scroll past a
              banner to type it. */}
          <div className="mt-5 lg:max-w-xl">
            <SearchBox />
          </div>
        </div>
      </section>

      {/* ---------------- Trust strip ---------------- */}
      <ul className="grid grid-cols-3 gap-2.5 lg:gap-4">
        {[
          { icon: ShieldCheck, key: 'trustVerified', tone: 'from-emerald-400 to-teal-500' },
          { icon: Star, key: 'trustRated', tone: 'from-shop-accent to-amber-500' },
          { icon: Clock, key: 'trustFast', tone: 'from-shop-bright to-rose-500' },
        ].map(({ icon: Icon, key, tone }) => (
          <li
            key={key}
            className="flex flex-col items-center gap-2 rounded-2xl border border-shop-line bg-white px-2 py-3.5 text-center shadow-[0_1px_2px_rgba(28,25,23,0.04)] lg:flex-row lg:gap-3 lg:px-5 lg:py-4 lg:text-left"
          >
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-white shadow-sm lg:h-10 lg:w-10 ${tone}`}
            >
              <Icon className="h-[18px] w-[18px]" aria-hidden="true" strokeWidth={2.2} />
            </span>
            <span className="text-[11px] font-semibold leading-tight text-shop-ink lg:text-[13px]">
              {t(`app.find.${key}`)}
            </span>
          </li>
        ))}
      </ul>

      {/* ---------------- Location ---------------- */}
      <LocationBar location={location} />

      {/* ---------------- Categories ---------------- */}
      <section>
        <h2 className="mb-3.5 text-[19px] font-bold tracking-tight text-shop-ink lg:text-[22px]">
          {t('app.find.browseByCategory')}
        </h2>
        <CategoryGrid />
      </section>
    </div>
  );
}
