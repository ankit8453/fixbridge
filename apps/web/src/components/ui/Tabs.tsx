import type { KeyboardEvent } from 'react';

/**
 * A plain tab list. Roving `tabIndex` (only the selected tab is in the tab
 * order; arrow keys move selection) is the documented accessible pattern for
 * `role="tablist"` — without it, a screen reader user tabs through every tab
 * individually before reaching the panel below.
 */
export interface TabItem {
  value: string;
  label: string;
  /** Unread/pending count, e.g. a job inbox's REQUESTED count. */
  badge?: number;
}

export function Tabs({
  tabs,
  value,
  onChange,
}: {
  tabs: TabItem[];
  value: string;
  onChange: (value: string) => void;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    if (next) onChange(next.value);
  }

  return (
    <div role="tablist" className="flex gap-1 border-b border-border">
      {tabs.map((tab, index) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`inline-flex min-h-touch items-center gap-1.5 border-b-2 px-3 text-sm font-medium transition-colors duration-150 ${
              active
                ? 'border-brand text-brand'
                : 'border-transparent text-muted hover:text-slate-700'
            }`}
          >
            {tab.label}
            {tab.badge ? (
              <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700">
                {tab.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
