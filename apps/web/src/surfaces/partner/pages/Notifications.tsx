import { NotificationInbox } from '../components/NotificationInbox';

/**
 * The page is deliberately a thin wrapper: the title already renders in
 * `AppShell`'s top bar, and every piece of state this screen has — paging,
 * unread count, the "mark all read" affordance — belongs to the inbox, which
 * is also mounted elsewhere.
 */
export default function Notifications() {
  return <NotificationInbox />;
}
