import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Search as SearchGlyph, X } from 'lucide-react';
import { useLocale, useT } from '@/i18n/useT';
import { buildLocalizedHref } from '@/i18n/config';
import { resolveSearchQuery } from '@/surfaces/customer/data/search';
import type { CategorySuggestion } from '@/surfaces/customer/data/types';
import { CategoryIcon } from './CategoryIcon';

const DEBOUNCE_MS = 300;

/**
 * Free-text (Hindi/English/Hinglish) → category suggestions, debounced.
 *
 * The debounce is a plain `setTimeout`, not a library: `/search/resolve` is
 * rate-limited at 30 req/min/IP (docs/API.md), and firing it on every
 * keystroke would burn most of that budget on a single "motor jal gayi"
 * typed at a normal pace. Ported from
 * `legacy-next-src/components/customer/find/SearchBox.tsx`.
 *
 * Visually this is built to sit on the home page's plum-tinted ground as well
 * as on a white results page, which is why it does not use the shared
 * `TextInput`: that control's cool-slate border and focus ring read grey-blue
 * on this violet-cast ground. The field is a solid white pill on a `shop-line`
 * hairline instead — high contrast against any background, and it reads as the
 * page's primary action from across the room, which is exactly what it is. `text-base` (16px) is kept because anything smaller makes iOS
 * Safari zoom the whole page on focus.
 */
export function SearchBox() {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();

  const [value, setValue] = useState('');
  const [suggestions, setSuggestions] = useState<CategorySuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);

    const query = value.trim();
    if (query.length === 0) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    timer.current = setTimeout(() => {
      const thisRequest = ++requestId.current;
      setLoading(true);

      resolveSearchQuery(query)
        .then((result) => {
          // A slower earlier request landing after a faster later one would
          // otherwise flash stale suggestions over fresh ones.
          if (thisRequest !== requestId.current) return;
          setSuggestions(result.suggestions);
          setOpen(true);
        })
        .catch(() => {
          if (thisRequest === requestId.current) setSuggestions([]);
        })
        .finally(() => {
          if (thisRequest === requestId.current) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value]);

  function goToCategory(categoryId: number) {
    setOpen(false);
    navigate(
      buildLocalizedHref(
        locale,
        `/app/search?categoryId=${categoryId}&q=${encodeURIComponent(value)}`,
      ),
    );
  }

  return (
    <div className="relative">
      <div className="relative flex items-center">
        <SearchGlyph
          className="pointer-events-none absolute left-4 h-[18px] w-[18px] text-shop-ink-soft"
          aria-hidden="true"
          strokeWidth={2.25}
        />

        <input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder={t('app.find.searchPlaceholder')}
          aria-label={t('app.find.searchAriaLabel')}
          // `appearance-none` kills WebKit's own search-field decorations,
          // which otherwise draw a second clear button on top of ours.
          className="w-full min-h-[52px] appearance-none rounded-2xl border border-shop-line bg-white py-3 pl-11 pr-11 text-base font-medium text-shop-ink shadow-lg outline-none placeholder:font-normal placeholder:text-shop-ink-soft focus:border-shop focus:ring-2 focus:ring-shop/25 [&::-webkit-search-cancel-button]:appearance-none"
        />

        {loading ? (
          <Loader2
            className="pointer-events-none absolute right-4 h-4 w-4 animate-spin text-shop"
            aria-hidden="true"
            strokeWidth={2.5}
          />
        ) : value.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              setValue('');
              setOpen(false);
            }}
            aria-label={t('app.find.clearSearch')}
            className="absolute right-2 flex h-9 w-9 items-center justify-center rounded-full text-shop-ink-soft transition-colors hover:bg-shop-soft hover:text-shop-ink"
          >
            <X className="h-4 w-4" aria-hidden="true" strokeWidth={2.5} />
          </button>
        ) : null}
      </div>

      {open ? (
        <ul className="absolute inset-x-0 z-30 mt-2 max-h-72 overflow-y-auto rounded-2xl border border-shop-line bg-white p-1.5 shadow-xl">
          {loading ? (
            <li className="px-3 py-3 text-sm text-shop-ink-soft">{t('common.loading')}</li>
          ) : suggestions.length === 0 ? (
            <li className="px-3 py-3 text-sm text-shop-ink-soft">{t('app.find.noSuggestions')}</li>
          ) : (
            suggestions.map((suggestion) => (
              <li key={suggestion.categoryId}>
                <button
                  type="button"
                  onClick={() => goToCategory(suggestion.categoryId)}
                  className="flex min-h-touch w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-shop-soft"
                >
                  {/* The same drawn glyph the category grid uses, so a
                      suggestion and the tile it leads to are recognisably the
                      same thing. Falls back to a generic tool icon for any
                      category without a drawn one. */}
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-shop-soft text-shop">
                    <CategoryIcon slug={suggestion.slug} className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-shop-ink">
                      {suggestion.name}
                    </span>
                    {suggestion.matchReason === 'synonym_fuzzy' ? (
                      <span className="block text-xs text-shop-ink-soft">
                        {t('app.find.didYouMean')}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
