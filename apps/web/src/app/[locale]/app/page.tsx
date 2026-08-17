'use client';

import { useT } from '@/i18n/useT';
import { SearchBox } from '@/components/customer/find/SearchBox';
import { CategoryGrid } from '@/components/customer/find/CategoryGrid';
import { LocationBar } from '@/components/customer/find/LocationBar';
import { useResolvedLocation } from '@/components/customer/find/useResolvedLocation';

/** Surface B's landing screen — category browse + search, per PHASE12_PROMPT.md §B.2. */
export default function CustomerHome() {
  const t = useT();
  const location = useResolvedLocation();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-4">
      <LocationBar location={location} />
      <SearchBox />
      <h1 className="text-lg font-semibold text-slate-900">{t('app.find.browseByCategory')}</h1>
      <CategoryGrid />
    </div>
  );
}
