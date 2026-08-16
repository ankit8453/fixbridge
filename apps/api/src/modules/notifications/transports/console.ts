import type { AppLogger } from '../../../core/logger';
import { maskPhone } from '../../auth/phone';
import type { MessageTransport } from './types';

/**
 * The development transport: writes the message to the log.
 *
 * The point is that a developer with no vendor account can watch the whole
 * notification pipeline work — routing, quiet hours, language, retries — and
 * read the actual Hindi that a customer would have received.
 *
 * The phone is masked even here. A developer's terminal scrollback ends up in
 * pasted bug reports and CI artifacts, and "it was only the dev logger" is how
 * personal data leaves a company.
 */
export function createConsoleTransport(logger: AppLogger, name: string): MessageTransport {
  let counter = 0;

  return {
    name,

    async send(to, message, meta) {
      counter += 1;
      const transportRef = `${name}-${String(counter).padStart(6, '0')}`;

      logger.info(
        {
          channel: meta.channel,
          criticality: meta.criticality,
          topic: meta.topic,
          to: maskPhone(to),
          language: message.language,
          template: message.templateStem,
          title: message.title,
          body: message.body,
          transportRef,
        },
        'notification (console transport — nothing was actually sent)',
      );

      return { transportRef };
    },
  };
}
