import { Check, AlertTriangle, CircleDashed, ArrowRight } from 'lucide-react';
import { useT } from '../../../i18n/useT';
import { Panel, StatusPill } from './ui';
import type { CompletenessBreakdownEntry, ProviderCompletenessResponse } from '../lib/types';

/**
 * Renders the completeness breakdown **exactly as the API reports it** — the
 * required items and their weights, the optional ones, and `score` against
 * `threshold`. Nothing here re-derives which items are required or
 * re-weighs them; that logic lives once, in
 * `apps/api/src/modules/providers/completeness.ts`, and duplicating its
 * judgement here would let this screen and the actual listing decision drift
 * apart — see that file's own comment on why the hard gate and the score are
 * deliberately two separate mechanisms.
 *
 * The sort is presentational, not a re-judgement: unfinished before finished,
 * required before optional, heaviest first. That ordering *is* the "what to do
 * next" answer, so the first unfinished entry is also called out above the
 * list — a technician on the dashboard should not have to read eight rows to
 * find the one that is blocking them.
 */
export function ChecklistCard({ completeness }: { completeness: ProviderCompletenessResponse }) {
  const t = useT();
  const sorted = [...completeness.breakdown].sort((a, b) => {
    if (a.satisfied !== b.satisfied) return a.satisfied ? 1 : -1;
    if (a.required !== b.required) return a.required ? -1 : 1;
    return b.weight - a.weight;
  });

  const done = sorted.filter((entry) => entry.satisfied).length;
  const nextUp = sorted.find((entry) => !entry.satisfied);
  const score = Math.max(0, Math.min(100, completeness.score));

  return (
    <Panel
      title={t('partner.checklist.title')}
      action={
        <StatusPill tone={completeness.isListed ? 'success' : 'warning'}>
          {completeness.isListed ? t('partner.checklist.live') : t('partner.checklist.notLive')}
        </StatusPill>
      }
    >
      {/* Score first: it is the number that decides whether the profile is
          considered at all, so it gets the largest type on the card. */}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <p className="text-3xl font-semibold tabular-nums tracking-tight text-slate-900">
          {score}
          <span className="ml-1 text-base font-medium text-slate-400">/ 100</span>
        </p>
        <p className="text-xs font-medium text-slate-500">
          {t('partner.checklist.doneCount', { done, total: sorted.length })}
        </p>
      </div>

      <div
        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('partner.checklist.title')}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${
            completeness.isListed ? 'bg-success' : 'bg-brand'
          }`}
          style={{ width: `${score}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs text-slate-500">
        {t('partner.checklist.score', {
          score: completeness.score,
          threshold: completeness.threshold,
        })}
      </p>

      {/* The single most useful sentence on the card — what to do next. */}
      {nextUp ? (
        <div className="mt-4 flex items-start gap-2.5 rounded-lg bg-brand/5 px-3 py-2.5 ring-1 ring-inset ring-brand/15">
          <ArrowRight
            className="mt-0.5 h-4 w-4 shrink-0 text-brand"
            aria-hidden="true"
            strokeWidth={2.25}
          />
          <p className="text-sm leading-relaxed text-slate-700">
            <span className="font-medium text-slate-900">{t('partner.checklist.nextUp')}</span>{' '}
            {t(`partner.checklist.item.${nextUp.item}`)}
          </p>
        </div>
      ) : null}

      <ul className="mt-4 flex flex-col divide-y divide-slate-100">
        {sorted.map((entry) => (
          <ChecklistRow
            key={entry.item}
            entry={entry}
            label={t(`partner.checklist.item.${entry.item}`)}
            requiredLabel={t('partner.checklist.required')}
          />
        ))}
      </ul>

      {completeness.missingRequired.length > 0 ? (
        <p className="mt-4 flex items-start gap-2.5 rounded-lg bg-warning/10 px-3 py-2.5 text-sm leading-relaxed text-slate-700 ring-1 ring-inset ring-warning/20">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-warning"
            aria-hidden="true"
            strokeWidth={2.25}
          />
          {t('partner.checklist.hardGateHint')}
        </p>
      ) : null}
    </Panel>
  );
}

/**
 * One checklist line.
 *
 * Three states, three affordances — done, required-and-missing, optional-and-
 * missing. The icon carries the same distinction as the colour, so the row
 * still reads for a colour-blind technician in daylight.
 */
function ChecklistRow({
  entry,
  label,
  requiredLabel,
}: {
  entry: CompletenessBreakdownEntry;
  label: string;
  requiredLabel: string;
}) {
  const Icon = entry.satisfied ? Check : entry.required ? AlertTriangle : CircleDashed;

  return (
    <li className="flex items-center gap-3 py-2.5">
      <span
        aria-hidden="true"
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
          entry.satisfied
            ? 'bg-success/10 text-success'
            : entry.required
              ? 'bg-warning/10 text-warning'
              : 'bg-slate-100 text-slate-400'
        }`}
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
      </span>
      <span
        className={`min-w-0 flex-1 text-sm ${
          entry.satisfied ? 'text-slate-400 line-through' : 'font-medium text-slate-800'
        }`}
      >
        {label}
      </span>
      {entry.required && !entry.satisfied ? (
        <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-warning">
          {requiredLabel}
        </span>
      ) : null}
    </li>
  );
}
