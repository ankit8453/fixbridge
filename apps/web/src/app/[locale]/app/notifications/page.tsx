'use client';

import { useT } from '@/i18n/useT';
import { NotificationList } from '@/components/customer/notifications/NotificationList';

export default function NotificationsPage() {
  const t = useT();
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-4">
      <h1 className="text-lg font-semibold text-slate-900">{t('app.notifications.title')}</h1>
      <NotificationList />
    </div>
  );
}
