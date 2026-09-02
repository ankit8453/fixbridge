import { AppError } from '../../core/errors';
import type { AppLogger } from '../../core/logger';
import { maskPhone } from './phone';
import type { OtpTransport } from './transport';

/**
 * WhatsApp OTP delivery through MBGCart.
 *
 * Three calls, in order, all to the same endpoint and distinguished by their
 * `actions` payload:
 *
 *   1. **Upsert the contact.** MBGCart addresses people by phone number, and a
 *      number it has never seen cannot be sent to.
 *   2. **Write the code into a custom field** on that contact.
 *   3. **Trigger the flow**, which reads the field and sends the message.
 *
 * The code travelling as a *contact field* rather than as message content is
 * MBGCart's design, not a choice available to us — the flow template lives in
 * their dashboard and only the field varies. It has one consequence worth
 * knowing: the most recent code for a number is readable in MBGCart's own UI
 * until it is overwritten. That is no worse than any provider that logs
 * message bodies, but it does mean the MBGCart account is as sensitive as this
 * API's own database, and should be treated that way.
 *
 * The three calls are not collapsed into one even though step 2 also carries
 * the phone number and might well upsert on its own. This sequence is what
 * works in production on another project; guessing at a shorter one against a
 * third-party API that cannot be exercised in CI would be trading a working
 * login for a tidier function.
 */

export interface MbgOtpOptions {
  /** Base URL, no trailing slash. e.g. `https://app.mbgcart.com/api` */
  baseUrl: string;
  /** `X-ACCESS-TOKEN`. Never logged, never in an error message. */
  accessToken: string;
  /** The dashboard flow that sends the message. */
  flowId: string;
  /** Custom field the flow reads the code from. */
  fieldName: string;
  /**
   * Whether to keep the leading `+`.
   *
   * Phones are stored here in E.164 (`+919876543210`). Most WhatsApp providers
   * want the digits alone, which is the default — but if messages are accepted
   * and never arrive, this is the first thing to change.
   */
  includePlus: boolean;
  logger: AppLogger;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/** Thrown when MBGCart rejects a call or cannot be reached. */
function deliveryFailed(): AppError {
  // Deliberately says nothing about MBGCart, the token, or which of the three
  // calls failed: a caller who cannot sign in learns nothing useful from that,
  // and an attacker probing the endpoint learns something.
  return new AppError(502, 'OTP_DELIVERY_FAILED', 'We could not send your code', {
    messageKey: 'errors.auth.otpDeliveryFailed',
  });
}

export function createMbgOtpTransport(options: MbgOtpOptions): OtpTransport {
  const { baseUrl, accessToken, flowId, fieldName, includePlus, logger, timeoutMs } = options;
  const doFetch = options.fetchImpl ?? fetch;

  if (!accessToken || !flowId) {
    throw new Error('MBG OTP transport requires MBG_ACCESS_TOKEN and MBG_OTP_FLOW_ID');
  }

  const endpoint = `${baseUrl.replace(/\/+$/, '')}/users`;

  /** One call. Throws on anything that is not a 2xx. */
  async function post(body: unknown, step: string): Promise<void> {
    // Without a timeout a hung provider holds the request open until the
    // client gives up, and the customer sees a spinner rather than an error.
    const abort = AbortSignal.timeout(timeoutMs);

    let response: Response;
    try {
      response = await doFetch(endpoint, {
        method: 'POST',
        headers: {
          'X-ACCESS-TOKEN': accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: abort,
      });
    } catch (cause) {
      logger.error({ step, cause: String(cause) }, 'mbg otp request failed');
      throw deliveryFailed();
    }

    if (!response.ok) {
      // The body may explain the rejection and is worth having, but it is
      // truncated: a provider that echoes the request back would otherwise put
      // the code itself into our logs.
      const detail = await response.text().catch(() => '');
      logger.error(
        { step, status: response.status, detail: detail.slice(0, 200) },
        'mbg otp request rejected',
      );
      throw deliveryFailed();
    }
  }

  return {
    name: 'mbg',

    async send({ phone, otp }) {
      const to = includePlus ? phone : phone.replace(/^\+/, '');

      await post({ phone: to }, 'create-contact');

      await post(
        {
          phone: to,
          actions: [{ action: 'set_field_value', field_name: fieldName, value: otp }],
        },
        'set-field',
      );

      await post({ phone: to, actions: [{ action: 'send_flow', flow_id: flowId }] }, 'send-flow');

      // Masked, and without the code. The point of logging at all is to be able
      // to answer "did we try to send to this number", which the mask supports.
      logger.info({ phone: maskPhone(phone) }, 'otp sent over whatsapp');
    },
  };
}
