import { useT } from '@/i18n/useT';
import { useMyComplaints } from '@/surfaces/customer/data/complaints';
import { Badge, QueryState, type Tone } from '@/components/ui';

const STATUS_TONE: Record<string, Tone> = {
  open: 'warning',
  in_review: 'info',
  resolved: 'success',
  dismissed: 'neutral',
};

/**
 * `/app/complaints` — "raise + track". Raising lives on the booking itself;
 * this is the tracking half. Ported from
 * `legacy-next-src/app/[locale]/app/complaints/page.tsx`.
 */
export default function Complaints() {
  const t = useT();
  const query = useMyComplaints();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-4">
      <h1 className="text-lg font-semibold text-shop-ink">{t('app.complaints.title')}</h1>

      <QueryState
        status={query.status}
        error={query.error}
        data={query.data}
        loadingLabel={t('common.loading')}
        empty={{ title: t('app.complaints.empty'), hint: t('app.complaints.emptyHint') }}
        isEmpty={(data) => data.complaints.length === 0}
        onRetry={() => void query.refetch()}
      >
        {(data) => (
          <div className="flex flex-col gap-3">
            {data.complaints.map((complaint) => (
              <div key={complaint.id} className="rounded-xl border border-shop-line bg-white p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-shop-ink">
                    {t(`app.complaintCategory.${complaint.category}`)}
                  </p>
                  <Badge tone={STATUS_TONE[complaint.status]}>
                    {t(`app.complaintStatus.${complaint.status}`)}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-slate-700">{complaint.description}</p>
                {complaint.resolutionNote ? (
                  <p className="mt-2 rounded-lg bg-slate-50 p-2 text-sm text-shop-ink-soft">
                    {t('app.complaints.resolutionNote')}: {complaint.resolutionNote}
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-slate-400">
                  {new Date(complaint.createdAt).toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </p>
              </div>
            ))}
          </div>
        )}
      </QueryState>
    </div>
  );
}
