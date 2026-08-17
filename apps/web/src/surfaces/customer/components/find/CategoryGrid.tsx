import { useNavigate } from 'react-router-dom';
import { useLocale, useT } from '@/i18n/useT';
import { buildLocalizedHref } from '@/i18n/config';
import { useCategories } from '@/surfaces/customer/data/categories';
import { QueryState } from '@/components/ui';

/**
 * Top-level clusters only (Electrical, Plumbing, ...), not the 20 leaf
 * services — a grid of 20 tiles on a 360px-wide screen is a wall of text, and
 * `category_id` on `/search/providers` already treats a cluster as "every
 * service beneath it" (docs/API.md), so tapping "Electrical" here searches
 * every electrical service in one request without a drill-down screen.
 * Ported from `legacy-next-src/components/customer/find/CategoryGrid.tsx`.
 */
export function CategoryGrid({ cityId = 1 }: { cityId?: number }) {
  const query = useCategories(cityId);
  const navigate = useNavigate();
  const locale = useLocale();
  const t = useT();

  return (
    <QueryState
      status={query.status}
      error={query.error}
      data={query.data}
      loadingLabel={t('app.find.loadingCategories')}
      empty={{ title: t('app.find.noCategories') }}
      isEmpty={(data) => data.categories.length === 0}
      onRetry={() => void query.refetch()}
    >
      {(data) => (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {data.categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() =>
                navigate(buildLocalizedHref(locale, `/app/search?categoryId=${category.id}`))
              }
              className="flex min-h-touch flex-col items-start gap-1 rounded-xl border border-slate-200 bg-white px-3 py-3 text-left transition-colors active:bg-slate-50"
            >
              <span className="text-2xl" aria-hidden="true">
                {ICONS[category.icon ?? ''] ?? '🛠️'}
              </span>
              <span className="text-sm font-semibold text-slate-900">{category.name}</span>
              <span className="text-xs text-slate-500">
                {t('app.find.providerCount', { count: category.providerCount })}
              </span>
            </button>
          ))}
        </div>
      )}
    </QueryState>
  );
}

const ICONS: Record<string, string> = {
  bolt: '⚡',
  wrench: '🔧',
  droplet: '💧',
  fan: '🌀',
  gear: '⚙️',
};
