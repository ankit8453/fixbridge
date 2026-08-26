import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLocale, useT } from '@/i18n/useT';
import { buildLocalizedHref } from '@/i18n/config';
import { useProviderSearch } from '@/surfaces/customer/data/search';
import { useResolvedLocation } from '@/surfaces/customer/components/find/useResolvedLocation';
import { LocationBar } from '@/surfaces/customer/components/find/LocationBar';
import { ProviderCard } from '@/surfaces/customer/components/find/ProviderCard';
import { NoResultsIcon, PinIcon } from '@/surfaces/customer/components/find/TrustIcons';
import { ErrorState, Pagination, Skeleton } from '@/components/ui';
import type { SearchProvidersQuery } from '@/surfaces/customer/data/types';

const PAGE_SIZE = 10;

/** The distances offered, widest last so "try further away" is a downward move. */
const DISTANCE_OPTIONS = ['2', '5', '10', '25'] as const;

const SORT_OPTIONS = [
  { value: 'rank', key: 'app.find.sort.rank' },
  { value: 'distance', key: 'app.find.sort.distance' },
  { value: 'price_low', key: 'app.find.sort.priceLow' },
] as const;

/** A result card's shape, held while the search runs. */
function ResultSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-shop-line bg-white">
      <div className="flex gap-3 p-4">
        <Skeleton className="h-[52px] w-[52px] shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="mt-2 h-3 w-3/5" />
          <Skeleton className="mt-3 h-3 w-1/2" />
        </div>
      </div>
      <div className="border-t border-shop-line bg-shop-soft/40 px-4 py-3">
        <Skeleton className="h-3.5 w-1/3" />
      </div>
    </div>
  );
}

/**
 * A filter chip row rather than a `<select>`.
 *
 * The two controls here are the two things a customer changes when the results
 * are wrong — "sort by nearest" and "look further out" — and a native select on
 * Android opens a full-screen modal for what is a three-way choice. Chips make
 * the current setting readable without opening anything, which matters most in
 * the empty state, where the fix is to widen the very filter that is causing it.
 */
function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-shop-ink-soft">
        {label}
      </span>
      {/* Scrolls horizontally rather than wrapping: a wrapped second row of
          chips pushes the first result off the screen on a small phone. */}
      <div className="-mx-1 flex flex-1 gap-1.5 overflow-x-auto px-1 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {children}
      </div>
    </div>
  );
}

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-colors ${
        selected
          ? 'border-shop bg-shop text-shop-foreground'
          : 'border-shop-line bg-white text-shop-ink-soft hover:border-shop/40 hover:text-shop-ink'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * `/app/search` — the results list.
 *
 * Behaviour is unchanged from the select-driven version: the sort and distance
 * still live entirely in the URL (so a result list is shareable and the back
 * button works), still reset the page on change, and still drive the exact same
 * `useProviderSearch` query. Only the controls' form changed.
 *
 * `QueryState` is not used here for the same reason as `Bookings.tsx`: the
 * empty state has to offer the customer a way *out* of the empty state — widen
 * the distance they set, or clear it entirely — and a generic "nothing found"
 * box cannot know which filter caused it.
 */
export default function Search() {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useResolvedLocation();

  const categoryId = searchParams.get('categoryId');
  const q = searchParams.get('q');
  const sort = (searchParams.get('sort') as SearchProvidersQuery['sort']) ?? 'rank';
  const maxDistanceKm = searchParams.get('maxDistanceKm');
  const page = Number(searchParams.get('page') ?? '1');

  function updateParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    if (key !== 'page') next.delete('page');
    navigate(buildLocalizedHref(locale, `/app/search?${next.toString()}`));
  }

  const query: SearchProvidersQuery | null = location.coords
    ? {
        lat: location.coords.lat,
        lng: location.coords.lng,
        category_id: categoryId ? Number(categoryId) : undefined,
        max_distance_km: maxDistanceKm ? Number(maxDistanceKm) : undefined,
        sort,
        page,
        page_size: PAGE_SIZE,
      }
    : null;

  const results = useProviderSearch(query);

  return (
    <div className="flex w-full flex-col gap-3.5">
      <LocationBar location={location} />

      {location.coords === null ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-shop-line px-5 py-9 text-center">
          <span
            className="flex h-12 w-12 items-center justify-center rounded-2xl bg-shop-soft text-shop"
            aria-hidden="true"
          >
            <PinIcon className="h-6 w-6" />
          </span>
          <p className="text-[15px] font-semibold text-shop-ink">
            {t('app.find.needLocationTitle')}
          </p>
          <p className="max-w-xs text-[13px] leading-relaxed text-shop-ink-soft">
            {t('app.find.needLocation')}
          </p>
        </div>
      ) : (
        <>
          {/* ---------------- Filters ---------------- */}
          <div className="flex flex-col gap-2">
            <ChipRow label={t('app.find.sortLabel')}>
              {SORT_OPTIONS.map((option) => (
                <Chip
                  key={option.value}
                  selected={sort === option.value}
                  onClick={() => updateParam('sort', option.value)}
                >
                  {t(option.key)}
                </Chip>
              ))}
            </ChipRow>

            <ChipRow label={t('app.find.maxDistanceLabel')}>
              <Chip selected={!maxDistanceKm} onClick={() => updateParam('maxDistanceKm', null)}>
                {t('app.find.maxDistanceAny')}
              </Chip>
              {DISTANCE_OPTIONS.map((km) => (
                <Chip
                  key={km}
                  selected={maxDistanceKm === km}
                  onClick={() => updateParam('maxDistanceKm', km)}
                >
                  {t('app.find.withinKm', { distance: km })}
                </Chip>
              ))}
            </ChipRow>
          </div>

          {/* ---------------- Result count ----------------
              Rendered only once the count is real. A "0 technicians" flash
              between the request and its answer reads as a failed search. */}
          {results.status === 'success' && results.data.total > 0 ? (
            <p className="text-[13px] text-shop-ink-soft">
              {q ? (
                <span className="font-medium text-shop-ink">
                  {t('app.find.resultsFor', { query: q })}{' '}
                </span>
              ) : null}
              {results.data.total === 1
                ? t('app.find.resultCountOne')
                : t('app.find.resultCount', { count: results.data.total })}
            </p>
          ) : null}

          {/* ---------------- Results ---------------- */}
          {results.status === 'pending' ? (
            <div className="flex flex-col gap-3" role="status" aria-label={t('app.find.searching')}>
              <ResultSkeleton />
              <ResultSkeleton />
              <ResultSkeleton />
            </div>
          ) : results.status === 'error' ? (
            <ErrorState error={results.error} onRetry={() => void results.refetch()} />
          ) : results.data.results.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-shop-line px-5 py-9 text-center">
              <span className="text-shop-ink-soft" aria-hidden="true">
                <NoResultsIcon className="h-11 w-11" />
              </span>
              <p className="text-[15px] font-semibold text-shop-ink">{t('app.find.noResults')}</p>
              <p className="max-w-xs text-[13px] leading-relaxed text-shop-ink-soft">
                {t('app.find.noResultsHint')}
              </p>
              {/*
                The one-tap fix, offered only when a distance filter is actually
                what is narrowing the search. "Clear filters" on an unfiltered
                search is a button that does nothing, which teaches people that
                buttons on this screen do nothing.
              */}
              {maxDistanceKm ? (
                <button
                  type="button"
                  onClick={() => updateParam('maxDistanceKm', null)}
                  className="min-h-touch mt-1 inline-flex items-center rounded-xl bg-shop px-5 text-sm font-semibold text-shop-foreground transition-opacity hover:opacity-90"
                >
                  {t('app.find.widenDistance')}
                </button>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {results.data.results.map((result) => (
                <ProviderCard key={result.providerId} result={result} />
              ))}
              <Pagination
                page={results.data.page}
                pageSize={results.data.pageSize}
                total={results.data.total}
                onChange={(next) => updateParam('page', String(next))}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
