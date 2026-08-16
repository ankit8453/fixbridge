import type { AppConfig } from '../../../core/config';
import type { AppLogger } from '../../../core/logger';
import { createConsoleTransport } from './console';
import { createFakeTransport, type FakeTransport } from './fake';
import { createMsg91Transport } from './msg91';
import { createWhatsappTransport } from './whatsapp';
import type { MessageTransport } from './types';

export * from './types';
export { createFakeTransport } from './fake';
export type { FakeTransport, SentMessage } from './fake';

/**
 * The transports the app actually holds, one per external channel.
 *
 * `in_app` has no transport and never will: an inbox row *is* the delivery, and
 * inventing a null transport for it would only invite somebody to make it
 * failable.
 *
 * Defaults are `console` outside production, so a fresh clone runs the entire
 * notification pipeline with no vendor account and no network. Production
 * refuses `fake` outright — the same shape of guard as the payment gateway,
 * because a production build that silently swallows every suspension notice
 * would be indistinguishable from one that works.
 */
export interface MessagingTransports {
  whatsapp: MessageTransport;
  sms: MessageTransport;
}

function parseTemplateMap(raw: string | undefined, label: string, logger: AppLogger) {
  if (!raw) return {};

  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    logger.error({ label }, 'template map is not valid JSON; treating it as empty');
    return {};
  }
}

export function createMessageTransports(config: AppConfig, logger: AppLogger): MessagingTransports {
  const whatsapp = ((): MessageTransport => {
    switch (config.NOTIFY_WHATSAPP_TRANSPORT) {
      case 'whatsapp_cloud':
        return createWhatsappTransport({
          // The schema guarantees these for this branch.
          phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID as string,
          accessToken: config.WHATSAPP_ACCESS_TOKEN as string,
          templateMap: parseTemplateMap(
            config.WHATSAPP_TEMPLATE_MAP,
            'WHATSAPP_TEMPLATE_MAP',
            logger,
          ),
          apiVersion: config.WHATSAPP_API_VERSION,
          logger,
        });
      case 'fake':
        return createFakeTransport('fake');
      default:
        return createConsoleTransport(logger, 'console');
    }
  })();

  const sms = ((): MessageTransport => {
    switch (config.NOTIFY_SMS_TRANSPORT) {
      case 'msg91':
        return createMsg91Transport({
          authKey: config.MSG91_AUTH_KEY as string,
          senderId: config.MSG91_SENDER_ID as string,
          templateMap: parseTemplateMap(config.MSG91_TEMPLATE_MAP, 'MSG91_TEMPLATE_MAP', logger),
          logger,
        });
      case 'fake':
        return createFakeTransport('fake');
      default:
        return createConsoleTransport(logger, 'console');
    }
  })();

  logger.info(
    { whatsapp: whatsapp.name, sms: sms.name },
    'notification transports ready (in_app needs none)',
  );

  return { whatsapp, sms };
}

/** Narrows a transport to the fake, for tests that need to inspect or break it. */
export function asFakeTransport(transport: MessageTransport): FakeTransport {
  if (transport.name !== 'fake') {
    throw new Error(`expected the fake transport, got "${transport.name}"`);
  }

  return transport as FakeTransport;
}
