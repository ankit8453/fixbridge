'use client';

import { useQuery } from '@tanstack/react-query';
import { useT } from '@/i18n/useT';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { QueryState } from '@/components/ui/States';
import { fetchTrust } from '@/components/partner/lib/api';
import { partnerKeys } from '@/components/partner/lib/query-keys';

const BADGE_TONE = { NONE: 'neutral', VERIFIED: 'good', SILVER: 'info', GOLD: 'good' } as const;

/**
 * "Why is my score 62" (docs/API.md), rendered in Hindi.
 *
 * Every number here is the API's, not re-derived — `contribution`,
 * `normalized`, `pending` all come straight off `GET /providers/me/trust`
 * (`apps/api/src/modules/trust/routes.ts`), because a technician arguing
 * with this screen needs to be arguing with the same number ops sees, not a
 * client-side approximation of it.
 */
export default function TrustPage() {
  const t = useT();
  const trustQuery = useQuery({ queryKey: partnerKeys.trust, queryFn: fetchTrust });

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-4">
      <h1 className="text-lg font-semibold text-slate-900">{t('partner.trust.title')}</h1>

      <QueryState
        status={trustQuery.status}
        error={trustQuery.error}
        data={trustQuery.data}
        onRetry={() => trustQuery.refetch()}
      >
        {({ trust }) => (
          <>
            {trust.suspendedUntil ? (
              <Card title={t('partner.trust.suspendedTitle')} className="border-red-300">
                <p className="text-sm text-red-800">
                  {t('partner.trust.suspendedUntil', {
                    date: new Date(trust.suspendedUntil).toLocaleDateString('hi-IN'),
                  })}
                </p>
                {trust.suspensionReason ? (
                  <p className="mt-2 text-sm text-slate-700">
                    {t('partner.trust.suspensionReason')}: {trust.suspensionReason}
                  </p>
                ) : null}
                <p className="mt-3 text-sm text-slate-600">
                  {t('partner.trust.suspendedContactHint')}
                </p>
              </Card>
            ) : null}

            <div className="flex flex-col items-center gap-1 rounded-xl border border-slate-200 bg-white py-6">
              <span className="text-5xl font-bold tabular-nums text-slate-900">{trust.score}</span>
              <Badge tone={BADGE_TONE[trust.badge]}>
                {t(`partner.verification.badge.${trust.badge}`)}
              </Badge>
              <p className="mt-1 text-sm text-slate-500">
                {t('partner.trust.settledJobs', { count: trust.settledJobs })}
              </p>
            </div>

            {trust.nextBand ? (
              <Card
                title={t('partner.trust.nextBandTitle', {
                  band: t(`partner.verification.badge.${trust.nextBand.band}`),
                })}
              >
                {trust.nextBand.needsJobs === 0 && trust.nextBand.needsScore === 0 ? (
                  <p className="text-sm font-medium text-green-700">
                    {t('partner.trust.nextBandAlmost')}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1 text-sm text-slate-700">
                    {trust.nextBand.needsJobs > 0 ? (
                      <li>
                        {t('partner.trust.nextBandJobs', { count: trust.nextBand.needsJobs })}
                      </li>
                    ) : null}
                    {trust.nextBand.needsScore > 0 ? (
                      <li>
                        {t('partner.trust.nextBandScore', { points: trust.nextBand.needsScore })}
                      </li>
                    ) : null}
                  </ul>
                )}
              </Card>
            ) : null}

            <Card title={t('partner.trust.componentsTitle')}>
              <ul className="flex flex-col gap-3">
                {trust.components.map((component) => (
                  <li key={component.name} className={component.pending ? 'opacity-50' : ''}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-slate-800">{component.label}</span>
                      <span className="tabular-nums text-slate-600">
                        {component.pending
                          ? t('partner.trust.noDataYet')
                          : `+${component.contribution} / ${component.weight}`}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">{component.reason}</p>
                    {!component.pending ? (
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-brand"
                          style={{ width: `${Math.round((component.normalized ?? 0) * 100)}%` }}
                        />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>

            {trust.trend.length > 0 ? (
              <Card title={t('partner.trust.trendTitle')}>
                <ul className="flex flex-col gap-1">
                  {trust.trend.map((point, index) => (
                    <li key={index} className="flex items-center justify-between text-sm">
                      <span className="text-slate-500">
                        {new Date(point.at).toLocaleDateString('hi-IN')}
                      </span>
                      <span className="tabular-nums text-slate-800">{point.score}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </>
        )}
      </QueryState>
    </div>
  );
}
