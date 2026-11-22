import { useEffect, useState } from 'react';
import { BellRing, Copy, KeyRound, MessageCircle, Timer } from 'lucide-react';
import { useAuth } from '@/lib/auth/useAuth';
import { ErrorState, useToast } from '@/components/ui';
import {
  formatRelayPhone,
  pendingRelayCount,
  useMarkOtpRelaySent,
  useOtpRelayQuery,
} from '../lib/otpRelay';
import {
  notificationPermission,
  playBeep,
  requestNotificationPermission,
  unlockAudio,
  type AlertPermission,
} from '../lib/attention';
import type { OtpRelayRequest } from '../lib/types';
import { Timestamp } from '../components/Timestamp';
import { AdminButton, Card, EmptyState, Pill, SectionHeader, SkeletonRows } from '../components/ui';

/**
 * Sign-in codes waiting to be sent by hand.
 *
 * During the pilot no SMS goes out. When somebody asks for a code, the server
 * keeps it here and emails the team; whoever is free sends it on WhatsApp from
 * their own phone using the prefilled link, and marks it sent so nobody else
 * sends it twice. The list polls every five seconds (`lib/otpRelay.ts`) and the
 * shell beeps on new arrivals from any page of the console.
 */
export default function SignInRequestsPage() {
  const query = useOtpRelayQuery();
  const { user } = useAuth();
  const toast = useToast();
  const now = useNow(1_000);

  const markSent = useMarkOtpRelaySent(user?.name ?? 'you', () =>
    toast.show({
      tone: 'danger',
      title: 'Could not mark it as sent',
      description:
        'WhatsApp still opened. Tell the team you sent this code so nobody sends it again.',
    }),
  );

  function sendOnWhatsApp(request: OtpRelayRequest) {
    // Synchronously inside the click, before anything async — popup blockers
    // only allow a new window that a user gesture opened directly.
    window.open(request.whatsappUrl, '_blank', 'noopener');
    unlockAudio();
    markSent.mutate(request.id);
  }

  async function copyCode(request: OtpRelayRequest) {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(request.otp);
      toast.show({ tone: 'success', title: `Code for ${formatRelayPhone(request.phone)} copied` });
    } catch {
      toast.show({ tone: 'warning', title: 'Could not copy — type the code from the screen.' });
    }
  }

  const requests = query.data?.requests ?? [];
  const waiting = requests.filter((request) => request.sentAt === null);
  const sent = requests.filter((request) => request.sentAt !== null);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Sign-in requests"
        description="Sign-in codes are not sent by SMS during the pilot. Send each one on WhatsApp from your own phone — the message opens ready to go. Someone is waiting on every card below."
        action={<AlertsControl />}
      />

      {query.status === 'pending' ? (
        <Card padded={false}>
          <SkeletonRows rows={3} />
        </Card>
      ) : query.status === 'error' && query.data === undefined ? (
        <Card>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Card>
      ) : requests.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon={KeyRound}
            title="No one is waiting for a code."
            description="New requests appear here within a few seconds, with a beep. Keep this tab open."
          />
        </Card>
      ) : (
        <>
          <Card
            title={`Waiting for a code (${pendingRelayCount(requests)})`}
            description="Newest first. Send it, then the card moves to Sent."
          >
            {waiting.length === 0 ? (
              <p className="text-[13px] text-slate-500">Everyone here has been sent their code.</p>
            ) : (
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {waiting.map((request) => (
                  <RequestCard
                    key={request.id}
                    request={request}
                    now={now}
                    onSend={() => sendOnWhatsApp(request)}
                    onCopy={() => void copyCode(request)}
                  />
                ))}
              </ul>
            )}
          </Card>

          {sent.length > 0 ? (
            <Card
              title="Sent"
              description="Stays here until the person signs in or the code expires."
            >
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {sent.map((request) => (
                  <RequestCard
                    key={request.id}
                    request={request}
                    now={now}
                    onSend={() => sendOnWhatsApp(request)}
                    onCopy={() => void copyCode(request)}
                  />
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}

function RequestCard({
  request,
  now,
  onSend,
  onCopy,
}: {
  request: OtpRelayRequest;
  now: number;
  onSend: () => void;
  onCopy: () => void;
}) {
  const isSent = request.sentAt !== null;
  const phone = formatRelayPhone(request.phone);
  const left = new Date(request.expiresAt).getTime() - now;
  const urgent = !isSent && left < 3 * 60_000;

  return (
    <li
      aria-label={`Sign-in request for ${phone}`}
      className={
        isSent
          ? 'rounded-xl border border-slate-200 bg-slate-50 p-4 opacity-75'
          : 'relative rounded-xl border border-admin/40 bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.08)] ring-1 ring-admin/20'
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            className={`truncate font-semibold tabular-nums ${isSent ? 'text-slate-600' : 'text-slate-900'}`}
          >
            {phone}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Asked <Timestamp value={request.createdAt} />
          </p>
        </div>
        <Pill tone={isSent ? 'success' : urgent ? 'danger' : 'warning'}>
          {isSent ? 'Sent' : 'Waiting'}
        </Pill>
      </div>

      <p
        className={`mt-3 font-mono text-3xl font-semibold tracking-[0.25em] ${isSent ? 'text-slate-500' : 'text-slate-900'}`}
      >
        {request.otp}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span
          className={`inline-flex items-center gap-1 tabular-nums ${urgent ? 'font-semibold text-danger' : 'text-slate-500'}`}
        >
          <Timer className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={1.75} />
          {left > 0 ? (
            <span>
              <span className="sr-only">Time left </span>
              {formatCountdown(left)} left
            </span>
          ) : (
            <span>Expired</span>
          )}
        </span>
        {isSent ? (
          <span className="text-slate-500">
            Sent by {request.sentBy ?? 'a team member'} · {sentAgo(request.sentAt, now)}
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <AdminButton variant={isSent ? 'secondary' : 'primary'} onClick={onSend}>
          <MessageCircle className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
          {isSent ? 'Send again on WhatsApp' : 'Send on WhatsApp'}
        </AdminButton>
        <AdminButton variant="ghost" onClick={onCopy}>
          <Copy className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
          Copy code
        </AdminButton>
      </div>
    </li>
  );
}

/**
 * The opt-in for alerts. Browsers only show the notification prompt, and only
 * allow sound, after a click — so this button is the gesture for both.
 */
function AlertsControl() {
  const [permission, setPermission] = useState<AlertPermission>(() => notificationPermission());

  async function enable() {
    unlockAudio();
    const result = await requestNotificationPermission();
    setPermission(result);
    playBeep();
  }

  if (permission === 'granted') {
    return (
      <div className="flex items-center gap-2">
        <Pill tone="success">Alerts on</Pill>
        <AdminButton
          variant="ghost"
          size="sm"
          onClick={() => {
            unlockAudio();
            playBeep();
          }}
        >
          Test sound
        </AdminButton>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <AdminButton variant="secondary" size="sm" onClick={() => void enable()}>
        <BellRing className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={2} />
        {permission === 'unsupported' ? 'Enable sound' : 'Enable alerts'}
      </AdminButton>
      {permission === 'denied' ? (
        <p className="max-w-[16rem] text-right text-[11px] leading-snug text-slate-500">
          Notifications are blocked in this browser&apos;s site settings. Sound and the tab title
          still work.
        </p>
      ) : null}
    </div>
  );
}

/** Re-renders every `intervalMs` — drives the countdowns. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** `mm:ss`, floored to the second. */
function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function sentAgo(iso: string | null, now: number): string {
  if (!iso) return '';
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (Number.isNaN(minutes) || minutes < 1) return 'just now';
  return `${minutes} min ago`;
}
