import { useT } from '@/i18n/useT';
import { useMyComplaints } from '@/surfaces/customer/data/complaints';
import { ErrorState, StatusPill, type Tone } from '@/components/ui';
import {
  ComplaintIcon,
  PageHeading,
  RowSkeleton,
  ShieldOkIcon,
} from '@/surfaces/customer/components/notifications/shopUi';

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
 *
 * ## Status legibility
 *
 * A complaint's state is the reason anyone opens this screen, so it is a
 * `StatusPill` — a coloured dot plus the translated word — rather than a flat
 * tint. Resolved cases dim their category line and lead with the team's
 * response, so the eye lands on the two that are still open.
 *
 * ## The empty state
 *
 * No complaints is the good outcome, not missing data, so it says so instead
 * of rendering a generic "nothing here" tray.
 */
export default function Complaints() {
  const t = useT();
  const query = useMyComplaints();

  const complaints = query.data?.complaints ?? [];
  const openCount = complaints.filter(
    (complaint) => complaint.status === 'open' || complaint.status === 'in_review',
  ).length;

  return (
    <div className="flex w-full flex-col gap-3.5">
      <PageHeading
        trailing={
          openCount > 0 ? (
            <span className="text-[13px] font-semibold text-shop-ink-soft">
              {t('app.complaints.openCount', { count: openCount })}
            </span>
          ) : null
        }
      >
        {t('app.complaints.title')}
      </PageHeading>

      {query.status === 'pending' ? <RowSkeleton rows={2} /> : null}

      {query.status === 'error' ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : null}

      {query.status === 'success' && complaints.length === 0 ? (
        <div className="flex flex-col items-center gap-2.5 rounded-2xl border border-dashed border-shop-line bg-white/60 px-4 py-10 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-shop-soft text-shop">
            <ShieldOkIcon className="h-6 w-6" />
          </span>
          <p className="text-[15px] font-semibold text-shop-ink">{t('app.complaints.empty')}</p>
          <p className="max-w-xs text-[13px] text-shop-ink-soft">{t('app.complaints.emptyHint')}</p>
        </div>
      ) : null}

      {query.status === 'success' && complaints.length > 0 ? (
        <ul className="divide-y divide-shop-line overflow-hidden rounded-2xl border border-shop-line bg-white shadow-sm">
          {complaints.map((complaint) => {
            const settled = complaint.status === 'resolved' || complaint.status === 'dismissed';

            return (
              <li key={complaint.id} className="flex items-start gap-3 px-4 py-3.5">
                <span
                  className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                    settled ? 'bg-shop-soft/60 text-shop-ink-soft' : 'bg-shop-soft text-shop'
                  }`}
                >
                  <ComplaintIcon className="h-[18px] w-[18px]" />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
                    <p
                      className={`text-[15px] font-bold leading-tight ${
                        settled ? 'text-shop-ink-soft' : 'text-shop-ink'
                      }`}
                    >
                      {t(`app.complaintCategory.${complaint.category}`)}
                    </p>
                    <StatusPill tone={STATUS_TONE[complaint.status]}>
                      {t(`app.complaintStatus.${complaint.status}`)}
                    </StatusPill>
                  </div>

                  <p className="mt-1 text-[13.5px] leading-snug text-shop-ink-soft">
                    {complaint.description}
                  </p>

                  {complaint.resolutionNote ? (
                    <div className="mt-2 rounded-xl border-l-2 border-shop bg-shop-soft/50 px-3 py-2">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-shop">
                        {t('app.complaints.resolutionNote')}
                      </p>
                      <p className="mt-0.5 text-[13px] leading-snug text-shop-ink">
                        {complaint.resolutionNote}
                      </p>
                    </div>
                  ) : null}

                  <time
                    dateTime={complaint.createdAt}
                    className="mt-1.5 block text-[11.5px] font-medium text-shop-ink-soft"
                  >
                    {t('app.complaints.raisedOn')}{' '}
                    {new Date(complaint.createdAt).toLocaleDateString(undefined, {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </time>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
