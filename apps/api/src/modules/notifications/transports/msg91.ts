import type { AppLogger } from '../../../core/logger';
import { maskPhone } from '../../auth/phone';
import { TransportSendError, type MessageTransport } from './types';

/**
 * MSG91, for SMS.
 *
 * ## Why this file exists before the credentials do
 *
 * Indian transactional SMS is gated on DLT: the sender id and every template
 * must be registered with a telecom operator before a single message goes out,
 * and that paperwork takes weeks. Writing the integration afterwards would put a
 * multi-day code change on the critical path of a launch date that is already
 * waiting on a regulator. Written now, going live is an env change.
 *
 * ## The DLT template mapping
 *
 * MSG91's flow API does not take free text for transactional messages. It takes
 * a **template id** issued by DLT plus named variables, and the text that goes
 * out is the registered text — not the string this application rendered. So our
 * i18n templates and the DLT ones have to say the same thing, and
 * `MSG91_TEMPLATE_MAP` is where that correspondence is declared:
 *
 *   `{"payment.cashRecorded":"1707…","provider.suspended":"1707…"}`
 *
 * A stem with no mapping is refused rather than sent as something else. See the
 * go-live checklist in `docs/notifications.md`.
 */

export interface Msg91Options {
  authKey: string;
  senderId: string;
  /** Template stem → DLT template id. */
  templateMap: Record<string, string>;
  logger: AppLogger;
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_ENDPOINT = 'https://control.msg91.com/api/v5/flow/';

export function createMsg91Transport(options: Msg91Options): MessageTransport {
  const { authKey, senderId, templateMap, logger } = options;

  // Constructor-gated: no credentials, no transport. The config schema refuses to
  // select msg91 without these, so this throw is the second line of defence.
  if (!authKey || !senderId) {
    throw new Error('MSG91 transport requires MSG91_AUTH_KEY and MSG91_SENDER_ID');
  }

  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const doFetch = options.fetchImpl ?? fetch;

  return {
    name: 'msg91',

    async send(to, message, meta) {
      const templateId = templateMap[meta.templateStem];

      if (!templateId) {
        throw new TransportSendError(
          'msg91',
          `no DLT template registered for "${meta.templateStem}" — refusing to send ` +
            'something other than what was approved',
        );
      }

      /**
       * Variables are positional in our templates and named in DLT's, so they go
       * over as `var1…varN`. The registered Hindi text is what the customer
       * actually reads; `message.body` is only ever the local copy of it.
       */
      const variables: Record<string, string> = {};
      meta.params.forEach((value, index) => {
        variables[`var${index + 1}`] = String(value);
      });

      const response = await doFetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authkey: authKey,
        },
        body: JSON.stringify({
          template_id: templateId,
          sender: senderId,
          short_url: '0',
          recipients: [{ mobiles: to.replace(/^\+/, ''), ...variables }],
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new TransportSendError(
          'msg91',
          `MSG91 rejected the send: ${response.status} ${detail.slice(0, 300)}`,
          response.status,
        );
      }

      const body = (await response.json().catch(() => ({}))) as { requestId?: string };
      const transportRef = body.requestId ?? `msg91-${Date.now()}`;

      logger.debug(
        {
          to: maskPhone(to),
          template: meta.templateStem,
          // The registered DLT text is what the recipient actually reads; ours
          // is only the local copy. Logging which language we asked for makes a
          // "why was it English" report answerable.
          language: message.language,
          transportRef,
        },
        'sms sent via msg91',
      );

      return { transportRef };
    },
  };
}
