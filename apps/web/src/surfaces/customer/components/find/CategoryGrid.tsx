import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useLocale, useT } from '@/i18n/useT';
import { buildLocalizedHref } from '@/i18n/config';
import { useCategories } from '@/surfaces/customer/data/categories';
import { QueryState } from '@/components/ui';
import { CategoryIcon, themeFor } from './CategoryIcon';

/**
 * Top-level clusters only (Electrical, Plumbing, ...), not the 20 leaf
 * services — a grid of 20 tiles on a 360px screen is a wall of text, and
 * `category_id` on `/search/providers` already treats a cluster as "every
 * service beneath it" (docs/API.md), so tapping "Electrical" searches every
 * electrical service in one request without a drill-down screen.
 *
 * The tiles carry drawn SVG icons and a per-category colour (see
 * `CategoryIcon.tsx`). They were emoji on plain white boxes, which read as
 * unfinished and gave a returning customer nothing to navigate by — people
 * find "the orange one" long before they read the label.
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
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {data.categories.map((category) => {
            const theme = themeFor(category.slug);
            return (
              <button
                key={category.id}
                type="button"
                onClick={() =>
                  navigate(buildLocalizedHref(locale, `/app/search?categoryId=${category.id}`))
                }
                className={`group relative flex min-h-touch flex-col items-start gap-2.5 overflow-hidden rounded-2xl border bg-gradient-to-br p-3.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0 ${theme.tile}`}
              >
                {/* A soft bloom behind the icon. Decorative, so it is
                    aria-hidden and carries no information of its own. */}
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full blur-2xl transition-opacity duration-200 group-hover:opacity-80 ${theme.glow}`}
                />

                <span
                  className={`relative flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-sm ${theme.icon}`}
                >
                  <CategoryIcon slug={category.slug} className="h-5 w-5" />
                </span>

                <span className="relative min-w-0">
                  <span className="block truncate text-[15px] font-semibold tracking-tight text-shop-ink">
                    {category.name}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1 text-xs font-medium text-shop-ink-soft">
                    {t('app.find.providerCount', { count: category.providerCount })}
                    <ChevronRight
                      className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                      aria-hidden="true"
                    />
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </QueryState>
  );
}
