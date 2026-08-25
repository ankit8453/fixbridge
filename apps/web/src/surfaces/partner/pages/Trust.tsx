import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ShieldAlert, ShieldCheck, TrendingUp } from 'lucide-react';
import { useLocale, useT } from '../../../i18n/useT';
import { QueryState } from '../../../components/ui';
import { PageHeader, Panel, StatusPill, type Tone } from '../components/ui';
import { fetchTrust } from '../lib/api';
import { partnerKeys } from '../lib/query-keys';

const BADGE_TONE: Record<'NONE' | 'VERIFIED' | 'SILVER' | 'GOLD', Tone> = {
  NONE: 'neutral',
  VERIFIED: 'success',
  SILVER: 'brand',
  GOLD: 'success',
};

/** The score is out of 100 — the dial below is a share of that, not of the max component weight. */
const MAX_SCORE = 100;

/**
 * "Why is my score 62", rendered in Hindi.
 *
 * Every number here is the API's, not re-derived — `contribution`,
 * `normalized`, `pending` all come straight off `GET /providers/me/trust`
 * (`apps/api/src/modules/trust/routes.ts`), because a technician arguing
 * with this screen needs to be arguing with the same number ops sees, not a
 * client-side approximation of it.
 */
export default function Trust() {
  const t = useT();
  const locale = useLocale();
  // Dates follow the reader, not the country. See the note in JobDetail.
  const intlLocale = locale === 'hi' ? 'hi-IN' : 'en-IN';
  const trustQuery = useQuery({ queryKey: partnerKeys.trust, queryFn: fetchTrust });

  const dateLabel = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });

  return (
    <>
      <PageHeader title={t('partner.trust.title')} description={t('partner.trust.subtitle')} />

      <QueryState
        status={trustQuery.status}
        error={trustQuery.error}
        data={trustQuery.data}
        onRetry={() => trustQuery.refetch()}
      >
        {({ trust }) => {
          // Clamped because the dial is a drawing, not the number: a score
          // outside 0–100 must never render as a negative or overflowing arc.
          const scoreFraction = Math.max(0, Math.min(1, trust.score / MAX_SCORE));

          return (
            <div className="flex flex-col gap-4 lg:gap-5">
              {/* A suspension outranks everything else on this page — it is the
                  answer to "why am I not getting jobs", so it goes first. */}
              {trust.suspendedUntil ? (
                <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4 lg:p-5">
                  <ShieldAlert
                    className="mt-0.5 h-5 w-5 shrink-0 text-danger"
                    aria-hidden="true"
                    strokeWidth={2}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      {t('partner.trust.suspendedTitle')}
                    </p>
                    <p className="mt-1 text-sm text-slate-700">
                      {t('partner.trust.suspendedUntil', {
                        date: new Date(trust.suspendedUntil).toLocaleDateString(intlLocale),
                      })}
                    </p>
                    {trust.suspensionReason ? (
                      <p className="mt-2 text-sm text-slate-700">
                        {t('partner.trust.suspensionReason')}: {trust.suspensionReason}
                      </p>
                    ) : null}
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">
                      {t('partner.trust.suspendedContactHint')}
                    </p>
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
                {/* ---------------- The score itself ---------------- */}
                <section className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm lg:p-8">
                  {/* A ring rather than a bar: this is one number out of 100,
                      and a dial reads as a whole at arm's length in daylight. */}
                  <div className="relative flex h-40 w-40 items-center justify-center">
                    <svg
                      className="h-full w-full -rotate-90"
                      viewBox="0 0 100 100"
                      aria-hidden="true"
                    >
                      <circle
                        cx="50"
                        cy="50"
                        r="42"
                        fill="none"
                        strokeWidth="8"
                        className="stroke-slate-100"
                      />
                      <circle
                        cx="50"
                        cy="50"
                        r="42"
                        fill="none"
                        strokeWidth="8"
                        strokeLinecap="round"
                        className="stroke-brand transition-all duration-500"
                        strokeDasharray={`${2 * Math.PI * 42}`}
                        strokeDashoffset={`${2 * Math.PI * 42 * (1 - scoreFraction)}`}
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-5xl font-semibold tabular-nums tracking-tight text-slate-900">
                        {trust.score}
                      </span>
                      <span className="mt-0.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                        {t('partner.trust.outOf', { max: MAX_SCORE })}
                      </span>
                    </div>
                  </div>

                  <div className="mt-5 flex flex-col items-center gap-2">
                    <StatusPill tone={BADGE_TONE[trust.badge]}>
                      {t(`partner.verification.badge.${trust.badge}`)}
                    </StatusPill>
                    <p className="text-sm text-slate-500">
                      {t('partner.trust.settledJobs', { count: trust.settledJobs })}
                    </p>
                  </div>
                </section>

                {/* ---------------- What builds it ---------------- */}
                <div className="lg:col-span-2">
                  <Panel
                    title={t('partner.trust.componentsTitle')}
                    description={t('partner.trust.componentsHint')}
                    padded={false}
                  >
                    <ul className="divide-y divide-slate-100">
                      {trust.components.map((component) => (
                        <li key={component.name} className="px-4 py-4 lg:px-5">
                          <div className="flex items-baseline justify-between gap-3">
                            <span
                              className={`text-sm font-medium ${
                                component.pending ? 'text-slate-500' : 'text-slate-900'
                              }`}
                            >
                              {component.label}
                            </span>
                            <span className="shrink-0 text-sm tabular-nums">
                              {component.pending ? (
                                <span className="text-xs font-medium text-slate-400">
                                  {t('partner.trust.noDataYet')}
                                </span>
                              ) : (
                                <>
                                  <span className="font-semibold text-slate-900">
                                    +{component.contribution}
                                  </span>
                                  <span className="text-slate-400"> / {component.weight}</span>
                                </>
                              )}
                            </span>
                          </div>

                          {/* The bar tracks `normalized` (how well this factor is
                              doing, 0–1), not `contribution` — a factor at full
                              marks should read as full even when its weight is small. */}
                          <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                            {component.pending ? null : (
                              <div
                                className="h-full rounded-full bg-brand transition-all duration-500"
                                style={{
                                  width: `${Math.round((component.normalized ?? 0) * 100)}%`,
                                }}
                              />
                            )}
                          </div>

                          <p className="mt-2 text-xs leading-relaxed text-slate-500">
                            {component.reason}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </Panel>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
                {trust.nextBand ? (
                  <Panel
                    title={t('partner.trust.nextBandTitle', {
                      band: t(`partner.verification.badge.${trust.nextBand.band}`),
                    })}
                  >
                    {trust.nextBand.needsJobs === 0 && trust.nextBand.needsScore === 0 ? (
                      <p className="flex items-center gap-2 text-sm font-medium text-success">
                        <CheckCircle2
                          className="h-4 w-4 shrink-0"
                          aria-hidden="true"
                          strokeWidth={2}
                        />
                        {t('partner.trust.nextBandAlmost')}
                      </p>
                    ) : (
                      <ul className="flex flex-col gap-2.5">
                        {trust.nextBand.needsJobs > 0 ? (
                          <li className="flex items-center gap-2.5 text-sm text-slate-700">
                            <ShieldCheck
                              className="h-4 w-4 shrink-0 text-brand"
                              aria-hidden="true"
                              strokeWidth={2}
                            />
                            {t('partner.trust.nextBandJobs', { count: trust.nextBand.needsJobs })}
                          </li>
                        ) : null}
                        {trust.nextBand.needsScore > 0 ? (
                          <li className="flex items-center gap-2.5 text-sm text-slate-700">
                            <TrendingUp
                              className="h-4 w-4 shrink-0 text-brand"
                              aria-hidden="true"
                              strokeWidth={2}
                            />
                            {t('partner.trust.nextBandScore', {
                              points: trust.nextBand.needsScore,
                            })}
                          </li>
                        ) : null}
                      </ul>
                    )}
                  </Panel>
                ) : null}

                {trust.trend.length > 0 ? (
                  <Panel title={t('partner.trust.trendTitle')} padded={false}>
                    <ul className="divide-y divide-slate-100">
                      {trust.trend.map((point, index) => (
                        <li
                          key={index}
                          className="flex items-center justify-between gap-3 px-4 py-3 lg:px-5"
                        >
                          <span className="text-sm tabular-nums text-slate-500">
                            {dateLabel(point.at)}
                          </span>
                          <span className="text-sm font-semibold tabular-nums text-slate-900">
                            {point.score}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Panel>
                ) : null}
              </div>
            </div>
          );
        }}
      </QueryState>
    </>
  );
}
