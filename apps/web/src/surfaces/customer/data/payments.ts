import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '@/lib/api';
import type { PaymentView, StartPaymentResponse } from './types';

const paymentsKey = (bookingId: string) => ['bookings', bookingId, 'payments'] as const;

/**
 * What the payment panel actually renders, derived from the payment list —
 * never from a flag this browser set itself. The gateway webhook is the only
 * source of payment truth; this function's whole job is to read that truth
 * back out of the list rather than trust anything client-side, which is
 * exactly what makes the closed-browser case safe: reopening this booking
 * recomputes the same state from the same server data, whether or not this
 * browser was there for the checkout.
 */
export type PaymentUiState =
  | { kind: 'none' }
  | { kind: 'awaiting_confirmation'; payment: PaymentView }
  | { kind: 'captured'; payment: PaymentView }
  | { kind: 'cash_recorded'; payment: PaymentView }
  | { kind: 'failed'; payment: PaymentView };

export function derivePaymentState(payments: PaymentView[]): PaymentUiState {
  // Cash is recorded once and is not superseded by anything — a technician
  // does not create a second payment after marking cash collected.
  const cash = payments.find((p) => p.method === 'cash' && p.status === 'captured');
  if (cash) return { kind: 'cash_recorded', payment: cash };

  const online = [...payments]
    .filter((p) => p.method === 'online')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const latest = online[0];
  if (!latest) return { kind: 'none' };

  if (
    latest.status === 'captured' ||
    latest.status === 'partially_refunded' ||
    latest.status === 'refunded'
  ) {
    return { kind: 'captured', payment: latest };
  }
  if (latest.status === 'failed') return { kind: 'failed', payment: latest };
  // 'created' — an order exists. Whether or not the checkout callback fired
  // in this browser, the webhook is what will resolve it; both "customer just
  // tapped pay" and "customer closed the browser mid-checkout, reopened this
  // page a day later" render identically here, which is the point.
  return { kind: 'awaiting_confirmation', payment: latest };
}

export function useBookingPayments(bookingId: string) {
  return useQuery({
    queryKey: paymentsKey(bookingId),
    queryFn: () =>
      apiRequest<{ bookingId: string; payments: PaymentView[] }>(
        `/api/v1/bookings/${bookingId}/payments`,
      ),
    enabled: Boolean(bookingId),
    // Only worth polling fast while something is unresolved; a `select` on
    // `refetchInterval` would need the query's own last data, which
    // TanStack Query passes as the query itself here.
    refetchInterval: (query) => {
      const payments = query.state.data?.payments ?? [];
      const state = derivePaymentState(payments);
      return state.kind === 'awaiting_confirmation' ? 4_000 : false;
    },
  });
}

export function useStartPayment(bookingId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      apiRequest<StartPaymentResponse>(`/api/v1/bookings/${bookingId}/payments`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: paymentsKey(bookingId) });
    },
  });
}

export function useCheckoutCallback(bookingId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      paymentId: string;
      razorpay_order_id: string;
      razorpay_payment_id: string;
      razorpay_signature: string;
    }) =>
      apiRequest<{ payment: PaymentView; message: string }>(
        `/api/v1/payments/${input.paymentId}/checkout-callback`,
        {
          method: 'POST',
          body: {
            razorpay_order_id: input.razorpay_order_id,
            razorpay_payment_id: input.razorpay_payment_id,
            razorpay_signature: input.razorpay_signature,
          },
        },
      ),
    // This call only ever *confirms* what the app can say ("we are checking
    // your payment") — never what happened. Its failure (network drop right
    // after Razorpay's own success, the classic closed-browser moment) must
    // not block anything: the poll above and a future reopen both fall back
    // to the webhook-driven list regardless.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: paymentsKey(bookingId) });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Razorpay checkout.js loader                                                */
/* -------------------------------------------------------------------------- */

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void };
  }
}

export interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description?: string;
  handler: (response: RazorpayResponse) => void;
  modal?: { ondismiss?: () => void };
  theme?: { color?: string };
}

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

let scriptPromise: Promise<void> | null = null;

function loadRazorpayScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.Razorpay) return Promise.resolve();

  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${CHECKOUT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('checkout.js failed to load')));
      return;
    }

    const script = document.createElement('script');
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('checkout.js failed to load'));
    document.body.appendChild(script);
  });

  return scriptPromise;
}

/**
 * Loads `checkout.js` once and exposes whether it is ready — the "pay now"
 * button stays disabled until then rather than opening a checkout that can't
 * mount, which on a slow 4G connection is the common case, not the edge case.
 */
export function useRazorpayReady(): { ready: boolean; error: string | null } {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadRazorpayScript()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'load failed');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { ready, error };
}

/** Opens the Razorpay modal. A thin wrapper so the panel component stays testable. */
export function useOpenRazorpayCheckout() {
  return useCallback((options: RazorpayOptions) => {
    if (!window.Razorpay) throw new Error('Razorpay checkout.js is not loaded yet');
    new window.Razorpay(options).open();
  }, []);
}
