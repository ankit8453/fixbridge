'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useT } from '@/i18n/useT';
import { buildLocalizedHref } from '@/i18n/config';
import { useProviderSearch } from '@/components/customer/data/search';
import { useResolvedLocation } from '@/components/customer/find/useResolvedLocation';
import { LocationBar } from '@/components/customer/find/LocationBar';
import { ProviderCard } from '@/components/customer/find/ProviderCard';
import { QueryState, Pagination, Select } from '@/components/ui';
import type { SearchProvidersQuery } from '@/components/customer/data/types';

const PAGE_SIZE = 10;

export default function SearchResultsPage() {
  return (
    // `useSearchParams()` opts the tree into client-side-render-only mode
    // unless it is inside a Suspense boundary — see Next's own
    // "missing-suspense-with-csr-bailout" guidance. `RequireAuth`'s own
    // `Spinner` already covers the auth-check gap, so this fallback is only
    // ever visible for the sub-millisecond the router takes to hydrate.
    <Suspense fallback={null}>
      <SearchResultsContent />
    </Suspense>
  );
}

function SearchResultsContent() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
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
    router.push(buildLocalizedHref(locale, `/app/search?${next.toString()}`));
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
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-4">
      <LocationBar location={location} />

      {q ? (
        <p className="text-sm text-slate-600">{t('app.find.resultsFor', { query: q })}</p>
      ) : null}

      {location.coords === null ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-600">
          {t('app.find.needLocation')}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              {t('app.find.sortLabel')}
              <Select value={sort} onChange={(e) => updateParam('sort', e.target.value)}>
                <option value="rank">{t('app.find.sort.rank')}</option>
                <option value="distance">{t('app.find.sort.distance')}</option>
                <option value="price_low">{t('app.find.sort.priceLow')}</option>
              </Select>
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              {t('app.find.maxDistanceLabel')}
              <Select
                value={maxDistanceKm ?? ''}
                onChange={(e) => updateParam('maxDistanceKm', e.target.value || null)}
              >
                <option value="">{t('app.find.maxDistanceAny')}</option>
                <option value="2">2 km</option>
                <option value="5">5 km</option>
                <option value="10">10 km</option>
                <option value="25">25 km</option>
              </Select>
            </label>
          </div>

          <QueryState
            status={results.status}
            error={results.error}
            data={results.data}
            loadingLabel={t('app.find.searching')}
            empty={{ title: t('app.find.noResults'), hint: t('app.find.noResultsHint') }}
            isEmpty={(data) => data.results.length === 0}
            onRetry={() => void results.refetch()}
          >
            {(data) => (
              <div className="flex flex-col gap-3">
                {data.results.map((result) => (
                  <ProviderCard key={result.providerId} result={result} />
                ))}
                <Pagination
                  page={data.page}
                  pageSize={data.pageSize}
                  total={data.total}
                  onChange={(next) => updateParam('page', String(next))}
                />
              </div>
            )}
          </QueryState>
        </>
      )}
    </div>
  );
}
