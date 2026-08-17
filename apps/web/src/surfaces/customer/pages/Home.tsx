import { useT } from '@/i18n/useT';
import { SearchBox } from '@/surfaces/customer/components/find/SearchBox';
import { CategoryGrid } from '@/surfaces/customer/components/find/CategoryGrid';
import { LocationBar } from '@/surfaces/customer/components/find/LocationBar';
import { useResolvedLocation } from '@/surfaces/customer/components/find/useResolvedLocation';

/** `/app` — find home: location bar, Hinglish search, category browse. */
export default function Home() {
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
