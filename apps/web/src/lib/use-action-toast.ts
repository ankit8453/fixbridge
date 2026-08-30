import { useCallback } from 'react';
import { useToast } from '../components/ui/Toast';
import { ApiError } from './api';
import { useT } from '../i18n/useT';

/**
 * Confirmation and failure toasts for a mutation.
 *
 * Every write in this product used to succeed silently. A technician tapped
 * "accept", the button stopped spinning, and nothing said the job was theirs;
 * a customer approved a quotation and the screen simply re-rendered. On a
 * patchy 4G connection that silence is indistinguishable from a request that
 * never landed, so people tap twice — which on money screens is the expensive
 * kind of doubt.
 *
 * Two rules the call sites below follow:
 *
 *  1. **Prefer the server's own message.** Every mutating endpoint already
 *     returns a localised `message` (`req.t(...)`), so the toast says exactly
 *     what the API said it did — one source of copy, already translated, and
 *     it cannot drift from what actually happened.
 *  2. **Never toast what the screen already shows.** A form that renders its
 *     own inline error, or a list that visibly gains a row, does not need a
 *     toast on top; the reason toasts exist here is the cases where nothing
 *     else changes.
 */
export interface ActionToastOptions {
  /** Fallback when the response carries no `message`. */
  success?: string;
  /**
   * Overrides the server's error text. Rarely wanted — the API's message is
   * usually more specific than anything a component can say.
   */
  error?: string;
}

interface WithMessage {
  message?: string;
}

export function useActionToast() {
  const { show } = useToast();
  const t = useT();

  const succeeded = useCallback(
    (result: unknown, options: ActionToastOptions = {}) => {
      const fromServer = (result as WithMessage | null | undefined)?.message;
      const title = fromServer ?? options.success;

      // No message and no fallback means the caller has nothing worth saying.
      if (!title) return;

      show({ title, tone: 'success' });
    },
    [show],
  );

  const failed = useCallback(
    (error: unknown, options: ActionToastOptions = {}) => {
      /**
       * `ApiError.message` is already the server's localised text — the
       * translated, specific sentence a person can act on ("that slot was
       * just taken"), not a status code. Anything else is a network or
       * programming failure, where a generic line is the honest answer.
       */
      const title =
        options.error ?? (error instanceof ApiError ? error.message : t('common.errorGeneric'));

      show({ title, tone: 'danger' });
    },
    [show, t],
  );

  return { succeeded, failed };
}
