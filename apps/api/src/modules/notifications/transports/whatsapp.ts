import type { AppLogger } from '../../../core/logger';
import { maskPhone } from '../../auth/phone';
import { TransportSendError, type MessageTransport } from './types';

/**
 * WhatsApp Cloud API — the primary external channel.
 *
 * Cheaper than SMS, renders Devanagari properly on every phone, and sits outside
 * the DLT regime entirely. For a Jabalpur pilot it is also simply where people
 * are: a customer will read a WhatsApp and ignore an SMS.
 *
 * ## Why every message is a template, not text
 *
 * A business may only send free text inside a 24-hour window opened by the
 * *user* messaging first. Everything this system sends is business-initiated —
 * a booking was accepted, a payment was recorded — so it must go as a
 * pre-approved **template message**, with the text living in Meta's template
 * library and only the parameters travelling.
 *
 * That is why `WHATSAPP_TEMPLATE_MAP` exists: template stem → the name
 * registered with Meta. The `language.code` is the recipient's own, so a Hindi
 * user gets the Hindi registration of the same template — which means each
 * template must be registered in both hi and en before go-live.
 */

export interface WhatsappOptions {
  phoneNumberId: string;
  accessToken: string;
  /** Template stem → registered template name. */
  templateMap: Record<string, string>;
  logger: AppLogger;
  apiVersion?: string;
  endpointBase?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE = 'https://graph.facebook.com';
const DEFAULT_VERSION = 'v21.0';

export function createWhatsappTransport(options: WhatsappOptions): MessageTransport {
  const { phoneNumberId, accessToken, templateMap, logger } = options;

  if (!phoneNumberId || !accessToken) {
    throw new Error(
      'WhatsApp transport requires WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN',
    );
  }

  const base = options.endpointBase ?? DEFAULT_BASE;
  const version = options.apiVersion ?? DEFAULT_VERSION;
  const doFetch = options.fetchImpl ?? fetch;
  const url = `${base}/${version}/${phoneNumberId}/messages`;

  return {
    name: 'whatsapp_cloud',

    async send(to, message, meta) {
      const templateName = templateMap[meta.templateStem];

      if (!templateName) {
        throw new TransportSendError(
          'whatsapp_cloud',
          `no WhatsApp template registered for "${meta.templateStem}"`,
        );
      }

      const response = await doFetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: templateName,
            // The recipient's own language, not the platform default: the same
            // template is registered separately in hi and en.
            language: { code: message.language },
            components:
              meta.params.length === 0
                ? []
                : [
                    {
                      type: 'body',
                      parameters: meta.params.map((value) => ({
                        type: 'text',
                        text: String(value),
                      })),
                    },
                  ],
          },
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new TransportSendError(
          'whatsapp_cloud',
          `WhatsApp rejected the send: ${response.status} ${detail.slice(0, 300)}`,
          response.status,
        );
      }

      const body = (await response.json().catch(() => ({}))) as {
        messages?: { id?: string }[];
      };

      const transportRef = body.messages?.[0]?.id ?? `wa-${Date.now()}`;

      logger.debug(
        { to: maskPhone(to), template: meta.templateStem, transportRef },
        'whatsapp message sent',
      );

      return { transportRef };
    },
  };
}
