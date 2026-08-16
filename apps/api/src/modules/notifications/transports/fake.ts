import type { RenderedMessage } from '../render';
import { TransportSendError, type MessageTransport, type TransportMeta } from './types';

/**
 * The transport the tests drive.
 *
 * It records everything and can be told to fail, which is what makes the retry,
 * backoff and parking behaviour assertable without a network. It also holds the
 * whole-suite capture that the phone-redaction sweep runs over: every message
 * this system produced during a test run, checked for a full phone number.
 */

export interface SentMessage {
  to: string;
  message: RenderedMessage;
  meta: TransportMeta;
  at: Date;
}

export interface FakeTransport extends MessageTransport {
  readonly sent: SentMessage[];
  /** Fail the next `count` sends, then behave. Models a flaky vendor. */
  failNext(count: number): void;
  /** Fail every send until told otherwise. Models a vendor being down. */
  failAlways(value: boolean): void;
  reset(): void;
}

export function createFakeTransport(name = 'fake'): FakeTransport {
  const sent: SentMessage[] = [];
  let failures = 0;
  let alwaysFail = false;
  let counter = 0;

  return {
    name,
    sent,

    failNext(count) {
      failures = count;
    },

    failAlways(value) {
      alwaysFail = value;
    },

    reset() {
      sent.length = 0;
      failures = 0;
      alwaysFail = false;
      // Deliberately NOT resetting the counter: transport references must stay
      // unique across a whole process, exactly as a real vendor's ids are. The
      // fake gateway learned this the hard way in Phase 8.
    },

    async send(to, message, meta) {
      if (alwaysFail || failures > 0) {
        if (failures > 0) failures -= 1;
        throw new TransportSendError(name, `fake transport: send refused for ${meta.topic}`);
      }

      counter += 1;
      sent.push({ to, message, meta, at: new Date() });

      return { transportRef: `${name}-${String(counter).padStart(6, '0')}` };
    },
  };
}
