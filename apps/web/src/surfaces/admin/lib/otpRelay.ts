import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '@/lib/api';
import { fetchOtpRelay, markOtpRelaySent } from './api';
import type { OtpRelayRequest } from './types';
import { playBeep, setTitleCount, showNotification, unlockAudio } from './attention';

/**
 * The sign-in relay: during the pilot no SMS goes out, so every code a person
 * requests waits here until somebody on the team sends it by hand on WhatsApp.
 *
 * One query, shared. The admin shell (`AdminAppEntry`) subscribes so the nav
 * badge and the alerts work from every page of the console; the page itself
 * subscribes with the same key and options, which TanStack dedupes into the
 * same single poll — not a second request every five seconds.
 */

export const OTP_RELAY_QUERY_KEY = ['admin', 'otp-relay'] as const;
export const OTP_RELAY_POLL_MS = 5_000;
export const SIGN_IN_REQUESTS_PATH = '/admin/sign-in-requests';

type RelayList = { requests: OtpRelayRequest[] };

export function useOtpRelayQuery() {
  return useQuery({
    queryKey: OTP_RELAY_QUERY_KEY,
    queryFn: fetchOtpRelay,
    refetchInterval: OTP_RELAY_POLL_MS,
    // The whole point: the console usually sits in a background tab while the
    // team member is doing something else. A paused poll is a missed person.
    refetchIntervalInBackground: true,
  });
}

/** Requests nobody has sent yet — what the badge and the tab title count. */
export function pendingRelayCount(requests: OtpRelayRequest[] | undefined): number {
  return requests?.filter((request) => request.sentAt === null).length ?? 0;
}

/** `+919876543210` → `+91 98765 43210`. Anything else is returned untouched. */
export function formatRelayPhone(phone: string): string {
  const indian = /^\+91(\d{5})(\d{5})$/.exec(phone);
  return indian ? `+91 ${indian[1]} ${indian[2]}` : phone;
}

/**
 * Marks a request as sent, optimistically.
 *
 * The one deliberate exception to "no optimistic updates" in
 * `lib/mutations.ts`. That rule exists because those mutations move money and
 * suspend people; this one records that a WhatsApp message was handed to the
 * phone, which has already happened by the time the request is made. Showing
 * it as sent immediately is what stops a second team member sending the same
 * code while the round-trip is in flight — and the next poll corrects anything
 * the server disagrees with. A 404 means the request expired or was used in the
 * meantime: nothing to report, the refetch simply drops it.
 */
export function useMarkOtpRelaySent(sentByName: string, onError?: (error: unknown) => void) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => markOtpRelaySent(id),
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: OTP_RELAY_QUERY_KEY });
      const previous = queryClient.getQueryData<RelayList>(OTP_RELAY_QUERY_KEY);
      if (previous) {
        queryClient.setQueryData<RelayList>(OTP_RELAY_QUERY_KEY, {
          requests: previous.requests.map((request) =>
            request.id === id
              ? { ...request, sentAt: new Date().toISOString(), sentBy: sentByName }
              : request,
          ),
        });
      }
      return { previous };
    },
    onSuccess: (result) => {
      const updated = result?.request;
      if (!updated) return;
      queryClient.setQueryData<RelayList>(OTP_RELAY_QUERY_KEY, (current) =>
        current
          ? {
              requests: current.requests.map((request) =>
                request.id === updated.id ? { ...request, ...updated } : request,
              ),
            }
          : current,
      );
    },
    onError: (error, _id, context) => {
      if (error instanceof ApiError && error.status === 404) return;
      if (context?.previous) queryClient.setQueryData(OTP_RELAY_QUERY_KEY, context.previous);
      onError?.(error);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: OTP_RELAY_QUERY_KEY }),
  });
}

/**
 * Beep + system notification for every request id that was not in the
 * previous poll, and a `(n) ` tab-title prefix for the unsent count.
 *
 * The first successful load only records what is already there — opening the
 * console with three requests waiting should show three, not fire three alerts
 * at once. Requests that arrive already marked sent (somebody else got there
 * between polls) are recorded silently too.
 *
 * Mounted once, in the admin shell, so it works from every page.
 */
export function useOtpRelayAlerts(requests: OtpRelayRequest[] | undefined): void {
  const seen = useRef<Set<string> | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!requests) return;

    if (seen.current === null) {
      seen.current = new Set(requests.map((request) => request.id));
      return;
    }

    const known = seen.current;
    const fresh = requests.filter((request) => !known.has(request.id));
    fresh.forEach((request) => known.add(request.id));

    const unsent = fresh.filter((request) => request.sentAt === null);
    if (unsent.length === 0) return;

    playBeep();
    unsent.forEach((request) =>
      showNotification(`New sign-in request: ${formatRelayPhone(request.phone)}`, {
        body: 'Send the code on WhatsApp from the console.',
        tag: `otp-relay-${request.id}`,
        onClick: () => navigate(SIGN_IN_REQUESTS_PATH),
      }),
    );
  }, [requests, navigate]);

  const pending = pendingRelayCount(requests);

  useEffect(() => {
    setTitleCount(pending);
  }, [pending]);

  // Leaving the console takes the prefix with it.
  useEffect(() => () => setTitleCount(0), []);

  /**
   * Browsers block sound until the page has seen a gesture. Any click or key
   * press anywhere in the console counts, so the beep works for someone who
   * never pressed "Enable alerts" but has clicked around once.
   */
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);
}
