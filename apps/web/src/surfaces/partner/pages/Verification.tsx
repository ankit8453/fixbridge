import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, ShieldCheck } from 'lucide-react';
import { useT } from '../../../i18n/useT';
import { QueryState } from '../../../components/ui';
import { PageHeader, Panel, StatusPill, type Tone } from '../components/ui';
import { VerificationLevelCard } from '../components/VerificationLevelCard';
import { fetchMyCases } from '../lib/api';
import { partnerKeys } from '../lib/query-keys';
import type { Badge } from '../lib/types';

const LEVELS = [
  { level: 0 as const, nameKey: 'partner.verification.levelName.identity' },
  { level: 1 as const, nameKey: 'partner.verification.levelName.background' },
  { level: 2 as const, nameKey: 'partner.verification.levelName.skill' },
];

const BADGE_TONE: Record<Badge, Tone> = {
  NONE: 'neutral',
  VERIFIED: 'success',
  SILVER: 'brand',
  GOLD: 'success',
};

/**
 * The verification center — four independent levels rendered as a ladder, so
 * passing one visibly moves a technician closer to `VERIFIED` rather than
 * each level feeling like an isolated form.
 *
 * ## Layout
 *
 * The badge summary sits in its own rail from `lg` up rather than as a card
 * stacked on top of the ladder: it is the score the four levels below are
 * being played for, and it should still be on screen while one of them is
 * being filled in. Below `lg` it leads the page, since a phone can only ever
 * show one of the two anyway.
 */
export default function Verification() {
  const t = useT();
  const casesQuery = useQuery({ queryKey: partnerKeys.verificationCases, queryFn: fetchMyCases });

  return (
    <>
      <PageHeader
        title={t('partner.verification.title')}
        description={t('partner.verification.subtitle')}
      />

      <QueryState
        status={casesQuery.status}
        error={casesQuery.error}
        data={casesQuery.data}
        onRetry={() => casesQuery.refetch()}
      >
        {({ cases, summary }) => {
          const earned = summary.badge === 'VERIFIED';
          const passed = summary.levelsPassed.length;
          const total = LEVELS.length;

          return (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-6">
              <div className="flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-start-1">
                {LEVELS.map(({ level, nameKey }) => (
                  <VerificationLevelCard
                    key={level}
                    level={level}
                    levelName={t(nameKey)}
                    caseData={cases.find((c) => c.level === level)}
                  />
                ))}
              </div>

              {/* See the layout note above — leads on a phone, sticks in the
                  rail from `lg` up. */}
              <aside className="order-first min-w-0 lg:order-none lg:col-start-2 lg:row-start-1 lg:sticky lg:top-20">
                <Panel title={t('partner.verification.badgeTitle')}>
                  <div className="flex flex-col items-center gap-3 text-center">
                    <span
                      aria-hidden="true"
                      className={`flex h-14 w-14 items-center justify-center rounded-full ${
                        earned ? 'bg-success/10 text-success' : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      {earned ? (
                        <BadgeCheck className="h-7 w-7" strokeWidth={1.75} />
                      ) : (
                        <ShieldCheck className="h-7 w-7" strokeWidth={1.75} />
                      )}
                    </span>

                    <StatusPill tone={BADGE_TONE[summary.badge]}>
                      {t(`partner.verification.badge.${summary.badge}`)}
                    </StatusPill>

                    <p className="text-sm leading-relaxed text-slate-600">
                      {earned
                        ? t('partner.verification.badgeEarnedHint')
                        : t('partner.verification.badgeRemainingHint', {
                            count: summary.levelsRemaining.length,
                          })}
                    </p>
                  </div>

                  {/* The ladder as a single line — four segments, one per
                      level, filled from `levelsPassed`. No new data: it is
                      the same array the copy above counts. */}
                  <div className="mt-5 border-t border-slate-100 pt-4">
                    <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                      <span>{t('partner.verification.progressLabel')}</span>
                      <span className="tabular-nums text-slate-700">
                        {t('partner.verification.progressCount', { passed, total })}
                      </span>
                    </div>
                    <div className="mt-2 flex gap-1.5" aria-hidden="true">
                      {LEVELS.map(({ level }) => (
                        <span
                          key={level}
                          className={`h-1.5 flex-1 rounded-full ${
                            summary.levelsPassed.includes(level) ? 'bg-success' : 'bg-slate-200'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </Panel>
              </aside>
            </div>
          );
        }}
      </QueryState>
    </>
  );
}
