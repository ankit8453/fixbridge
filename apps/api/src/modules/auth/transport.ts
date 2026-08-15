import type { AppLogger } from '../../core/logger';

export interface OtpMessage {
  phone: string;
  otp: string;
  expiresInSeconds: number;
}

/**
 * How an OTP reaches a human. Real SMS/WhatsApp delivery is Phase 10 — this
 * interface exists now so that phase only adds an implementation and swaps the
 * wiring, with no change to the auth service.
 */
export interface OtpTransport {
  readonly name: string;
  send(message: OtpMessage): Promise<void>;
}

/**
 * Development transport: writes the OTP to the log so a developer can read it
 * out of the terminal.
 *
 * Note this deliberately bypasses the logger's `*.otp` redaction by naming the
 * field `devOtp` — the whole point is to make it visible locally. It is refused
 * outright in production by `createOtpTransport` below.
 */
export function createLoggerOtpTransport(logger: AppLogger): OtpTransport {
  return {
    name: 'logger',
    async send({ phone, otp, expiresInSeconds }) {
      logger.info(
        { phone, devOtp: otp, expiresInSeconds },
        'otp generated (development transport — not sent over SMS)',
      );
    },
  };
}

/**
 * Refuses to hand back a transport that prints OTPs when running in production.
 * Phase 10 replaces this with a real SMS/WhatsApp adapter.
 */
export function createOtpTransport(logger: AppLogger, nodeEnv: string): OtpTransport {
  if (nodeEnv === 'production') {
    throw new Error(
      'No production OTP transport is configured. Real SMS/WhatsApp delivery arrives in Phase 10; ' +
        'the development transport logs OTPs in plaintext and must never run in production.',
    );
  }

  return createLoggerOtpTransport(logger);
}
