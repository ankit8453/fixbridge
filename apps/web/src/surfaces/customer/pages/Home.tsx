import { ShieldCheck, Star, Clock } from 'lucide-react';
import { useT } from '@/i18n/useT';
import { SearchBox } from '@/surfaces/customer/components/find/SearchBox';
import { CategoryGrid } from '@/surfaces/customer/components/find/CategoryGrid';
import { LocationBar } from '@/surfaces/customer/components/find/LocationBar';
import { useResolvedLocation } from '@/surfaces/customer/components/find/useResolvedLocation';

/**
 * `/app` — the screen that has to earn the booking.
 *
 * ## Why there is no hero slab
 *
 * This page had a full-width coloured block holding the headline and the
 * search box. It ate half the first screen, pushed the categories — the thing
 * people actually came to tap — below the fold, and made the page read as a
 * stack of boxes inside boxes: a slab, then three bordered cards, then a
 * bordered location row, then more cards.
 *
 * So the headline is now just type on the page, the trust line is a single
 * inline row rather than three cards, and the only bordered things left are
 * the ones you can tap. Fewer containers, more content.
 *
 * The trust line stays because verified, rated and priced-in-advance are the
 * product's actual differentiators against the national platforms — but it is
 * one quiet row, not a feature grid.
 */
export default function Home() {
  const t = useT();
  const location = useResolvedLocation();

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      {/* ---------------- Headline ---------------- */}
      <section className="pt-2 lg:pt-6">
        <h1 className="max-w-2xl text-[26px] font-bold leading-[1.15] tracking-tight text-shop-ink lg:text-[38px]">
          {t('app.find.heroTitle')}
        </h1>

        {/* The trust line: inline, comma-free, one row. Three bordered cards
            said the same thing and cost three times the vertical space. */}
        <ul className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          {[
            { icon: ShieldCheck, key: 'trustVerified' },
            { icon: Star, key: 'trustRated' },
            { icon: Clock, key: 'trustFast' },
          ].map(({ icon: Icon, key }) => (
            <li key={key} className="flex items-center gap-1.5">
              <Icon className="h-4 w-4 shrink-0 text-shop" aria-hidden="true" strokeWidth={2.2} />
              <span className="text-[13px] font-medium text-shop-ink-soft lg:text-sm">
                {t(`app.find.${key}`)}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-5 lg:max-w-2xl">
          <SearchBox />
        </div>
      </section>

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
