import type { AppConfig } from '../../core/config';
import { AppError } from '../../core/errors';
import type { AppLogger } from '../../core/logger';
import { createMbgOtpTransport } from './mbg-otp';

export interface OtpMessage {
  phone: string;
  otp: string;
  expiresInSeconds: number;
}

/**
 * How an OTP reaches a human.
 *
 * One interface, three implementations chosen by config — the same discipline
 * as the payment gateway and the KYC adapters, and for the same reason: the
 * thing on the other side is a third party we do not control and will want to
 * replace.
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
 * Boots, but cannot send. For a deployment standing up before its messaging
 * credentials exist.
 *
 * The distinction that matters is **where it fails**. The logger transport is
 * refused at startup because it would succeed at the wrong thing — printing a
 * login code into a log file. This one fails at the point of use, with a
 * message that says why, so everything that does not depend on signing in —
 * the health check, the service catalogue, search, the TLS certificate — comes
 * up and can be verified while the messaging side is still being arranged.
 *
 * It has to be asked for explicitly (`AUTH_OTP_TRANSPORT=disabled`). Nobody
 * reaches this state by forgetting to configure something, which is the whole
 * point: a silently sign-in-less production is worse than one that refuses to
 * start.
 */
export function createDisabledOtpTransport(logger: AppLogger): OtpTransport {
  return {
    name: 'disabled',
    async send({ phone }) {
      logger.error(
        { phone },
        'otp requested but delivery is disabled — set AUTH_OTP_TRANSPORT once a channel is configured',
      );

      throw new AppError(503, 'OTP_DELIVERY_UNAVAILABLE', 'We cannot send codes just yet', {
        messageKey: 'errors.auth.otpDeliveryUnavailable',
      });
    },
  };
}

/**
 * Picks the transport, and refuses the dangerous combination.
 *
 * `logger` in production is the one case that throws at startup rather than at
 * send time: an app that prints login codes into its own logs is worse than an
 * app that will not start, and the failure needs to happen where somebody is
 * watching a deploy rather than three weeks later.
 */
export function createOtpTransport(
  logger: AppLogger,
  nodeEnv: string,
  transport: AppConfig['AUTH_OTP_TRANSPORT'] = 'logger',
  config?: AppConfig,
): OtpTransport {
  if (transport === 'mbg') {
    if (!config) {
      throw new Error('the mbg OTP transport needs the config to build its client');
    }

    return createMbgOtpTransport({
      baseUrl: config.MBG_API_BASE_URL,
      // The schema guarantees these are present for this branch.
      accessToken: config.MBG_ACCESS_TOKEN as string,
      flowId: config.MBG_OTP_FLOW_ID as string,
      fieldName: config.MBG_OTP_FIELD_NAME,
      includePlus: config.MBG_PHONE_INCLUDE_PLUS,
      timeoutMs: config.MBG_TIMEOUT_MS,
      logger,
    });
  }

  if (transport === 'disabled') {
    if (nodeEnv === 'production') {
      logger.warn(
        'AUTH_OTP_TRANSPORT=disabled — the API will start, but nobody can sign in until a ' +
          'messaging channel is configured',
      );
    }

    return createDisabledOtpTransport(logger);
  }

  if (nodeEnv === 'production') {
    throw new Error(
      'No production OTP transport is configured. The development transport logs OTPs in ' +
        'plaintext and must never run in production. Set AUTH_OTP_TRANSPORT=disabled to start ' +
        'without sign-in while a real channel is being arranged.',
    );
  }

  return createLoggerOtpTransport(logger);
}
