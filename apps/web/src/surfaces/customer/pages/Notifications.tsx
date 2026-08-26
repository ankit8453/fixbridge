import { useT } from '@/i18n/useT';
import { NotificationList } from '@/surfaces/customer/components/notifications/NotificationList';

/**
 * `/app/notifications` — "Alerts".
 *
 * The page is only a title: the unread count, the mark-all control and the
 * grouped list all depend on the query, so they live inside
 * `NotificationList` where the data is, rather than being lifted here and
 * re-fetched to render a header.
 *
 * The shell's `<main>` already supplies the page gutter and max width, so
 * this adds no padding of its own — the old `px-4 py-4` sat inside the
 * shell's own `px-4 pt-4` and doubled it.
 */
export default function Notifications() {
  const t = useT();

  return (
    <div className="w-full">
      <NotificationList title={t('app.notifications.title')} />
    </div>
  );
}
