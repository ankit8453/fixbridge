'use client';

import { useT } from '@/i18n/useT';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import type { ProviderCompletenessResponse } from './lib/types';

/**
 * Renders the completeness breakdown **exactly as the API reports it** — the
 * five required items and their weights, the optional three, and `score`
 * against `threshold`. Nothing here re-derives which items are required or
 * re-weighs them; that logic lives once, in
 * `apps/api/src/modules/providers/completeness.ts`, and duplicating its
 * judgement here would let this screen and the actual listing decision drift
 * apart — see that file's own comment on why the hard gate and the score are
 * deliberately two separate mechanisms.
 */
export function ChecklistCard({ completeness }: { completeness: ProviderCompletenessResponse }) {
  const t = useT();
  const sorted = [...completeness.breakdown].sort((a, b) => {
    if (a.satisfied !== b.satisfied) return a.satisfied ? 1 : -1;
    if (a.required !== b.required) return a.required ? -1 : 1;
    return b.weight - a.weight;
  });

  return (
    <Card
      title={t('partner.checklist.title')}
      actions={
        <Badge tone={completeness.isListed ? 'good' : 'warn'}>
          {completeness.isListed ? t('partner.checklist.live') : t('partner.checklist.notLive')}
        </Badge>
      }
    >
      <div className="mb-4">
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-brand transition-[width]"
            style={{ width: `${Math.min(100, completeness.score)}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {t('partner.checklist.score', {
            score: completeness.score,
            threshold: completeness.threshold,
          })}
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {sorted.map((entry) => (
          <li key={entry.item} className="flex items-center gap-3">
            <span
              aria-hidden
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                entry.satisfied
                  ? 'bg-green-100 text-green-700'
                  : entry.required
                    ? 'bg-red-100 text-red-700'
                    : 'bg-slate-100 text-slate-500'
              }`}
            >
              {entry.satisfied ? '✓' : entry.required ? '!' : '·'}
            </span>
            <span
              className={`flex-1 text-sm ${entry.satisfied ? 'text-slate-500 line-through' : 'text-slate-800'}`}
            >
              {t(`partner.checklist.item.${entry.item}`)}
            </span>
            {entry.required ? (
              <span className="text-xs text-slate-400">{t('partner.checklist.required')}</span>
            ) : null}
          </li>
        ))}
      </ul>

      {completeness.missingRequired.length > 0 ? (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t('partner.checklist.hardGateHint')}
        </p>
      ) : null}
    </Card>
  );
}
