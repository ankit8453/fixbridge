import { useT } from '../../../i18n/useT';
import { NotificationInbox } from '../components/NotificationInbox';

export default function Notifications() {
  const t = useT();

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-4">
      <h1 className="text-lg font-semibold text-slate-900">{t('partner.notifications.title')}</h1>
      <NotificationInbox />
    </div>
  );
}
