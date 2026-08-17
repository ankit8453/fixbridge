import { useQuery } from '@tanstack/react-query';
import { useT } from '../../../i18n/useT';
import { Badge, Card, QueryState } from '../../../components/ui';
import { VerificationLevelCard } from '../components/VerificationLevelCard';
import { fetchMyCases } from '../lib/api';
import { partnerKeys } from '../lib/query-keys';

const LEVELS = [
  { level: 0 as const, nameKey: 'partner.verification.levelName.identity' },
  { level: 1 as const, nameKey: 'partner.verification.levelName.background' },
  { level: 2 as const, nameKey: 'partner.verification.levelName.skill' },
  { level: 3 as const, nameKey: 'partner.verification.levelName.references' },
];

const BADGE_TONE = {
  NONE: 'neutral',
  VERIFIED: 'success',
  SILVER: 'info',
  GOLD: 'success',
} as const;

/**
 * The verification center — four independent levels rendered as a ladder, so
 * passing one visibly moves a technician closer to `VERIFIED` rather than
 * each level feeling like an isolated form.
 */
export default function Verification() {
  const t = useT();
  const casesQuery = useQuery({ queryKey: partnerKeys.verificationCases, queryFn: fetchMyCases });

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-4">
      <h1 className="text-lg font-semibold text-slate-900">{t('partner.verification.title')}</h1>

      <QueryState
        status={casesQuery.status}
        error={casesQuery.error}
        data={casesQuery.data}
        onRetry={() => casesQuery.refetch()}
      >
        {({ cases, summary }) => (
          <>
            <Card
              title={t('partner.verification.badgeTitle')}
              actions={
                <Badge tone={BADGE_TONE[summary.badge]}>
                  {t(`partner.verification.badge.${summary.badge}`)}
                </Badge>
              }
            >
              <p className="text-sm text-slate-600">
                {summary.badge === 'VERIFIED'
                  ? t('partner.verification.badgeEarnedHint')
                  : t('partner.verification.badgeRemainingHint', {
                      count: summary.levelsRemaining.length,
                    })}
              </p>
            </Card>

            {LEVELS.map(({ level, nameKey }) => (
              <VerificationLevelCard
                key={level}
                level={level}
                levelName={t(nameKey)}
                caseData={cases.find((c) => c.level === level)}
              />
            ))}
          </>
        )}
      </QueryState>
    </div>
  );
}
