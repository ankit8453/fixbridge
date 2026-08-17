'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useT } from '@/i18n/useT';
import { buildLocalizedHref } from '@/i18n/config';
import { resolveSearchQuery } from '@/components/customer/data/search';
import type { CategorySuggestion } from '@/components/customer/data/types';
import { TextInput } from '@/components/ui';

const DEBOUNCE_MS = 300;

/**
 * Free-text (Hindi/English/Hinglish) → category suggestions, debounced.
 *
 * The debounce is a plain `setTimeout`, not a library: `/search/resolve` is
 * rate-limited at 30 req/min/IP (docs/API.md), and firing it on every
 * keystroke would burn most of that budget on a single "motor jal gayi"
 * typed at a normal pace.
 */
export function SearchBox() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();

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
    router.push(
      buildLocalizedHref(
        locale,
        `/app/search?categoryId=${categoryId}&q=${encodeURIComponent(value)}`,
      ),
    );
  }

  return (
    <div className="relative">
      <TextInput
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder={t('app.find.searchPlaceholder')}
        aria-label={t('app.find.searchPlaceholder')}
      />
      {open ? (
        <ul className="absolute inset-x-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {loading ? (
            <li className="px-3 py-2 text-sm text-slate-500">{t('common.loading')}</li>
          ) : suggestions.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500">{t('app.find.noSuggestions')}</li>
          ) : (
            suggestions.map((suggestion) => (
              <li key={suggestion.categoryId}>
                <button
                  type="button"
                  onClick={() => goToCategory(suggestion.categoryId)}
                  className="flex min-h-touch w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <span>{suggestion.name}</span>
                  {suggestion.matchReason === 'synonym_fuzzy' ? (
                    <span className="text-xs text-slate-500">{t('app.find.didYouMean')}</span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
