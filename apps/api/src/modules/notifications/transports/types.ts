import type { RenderedMessage } from '../render';
import type { CriticalityName, NotificationChannelName } from '../routing';

/**
 * How a rendered message physically leaves the building.
 *
 * One interface, four implementations, chosen by config. The two real ones —
 * MSG91 and WhatsApp Cloud — are written against the vendors' documented HTTP
 * shapes but are **constructor-gated on credentials**: with no keys they are
 * never instantiated, which is enforced by the config schema rather than by a
 * runtime check somebody can forget. DLT registration is still in progress, and
 * the day it clears this should be an env change, not a sprint.
 */

export interface TransportMeta {
  channel: NotificationChannelName;
  criticality: CriticalityName;
  topic: string;
  notificationId: string;
  deliveryId: string;
  /**
   * The template that produced the text. Real vendors do not accept free text
   * for business-initiated messages — MSG91 wants a DLT template id and WhatsApp
   * wants a registered template name — so the transport needs to know which
   * template this is, not just what it says.
   */
  templateStem: string;
  /** Positional parameters, in the template's declared order. */
  params: readonly (string | number)[];
}

export interface TransportResult {
  /** Vendor-side message id, kept so "it never arrived" can be chased. */
  transportRef: string;
}

export interface MessageTransport {
  readonly name: string;
  /** `to` is E.164 (`+91…`). Implementations must never log it in full. */
  send(to: string, message: RenderedMessage, meta: TransportMeta): Promise<TransportResult>;
}

/** Thrown by a real transport when the vendor rejects or the network fails. */
export class TransportSendError extends Error {
  constructor(
    readonly transport: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'TransportSendError';
  }
}
