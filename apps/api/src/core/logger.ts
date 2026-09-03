import pino, { type Logger } from 'pino';
import type { AppConfig } from './config';

export type AppLogger = Logger;

/**
 * JSON logs everywhere; human-readable only in local development.
 *
 * `base` replaces pino's default pid/hostname so every line carries the
 * configured app name instead of a hardcoded brand.
 */
export function createLogger(config: AppConfig): AppLogger {
  const prettyInDev = config.NODE_ENV === 'development';

  return pino({
    level: config.LOG_LEVEL,
    base: { app: config.APP_NAME, env: config.NODE_ENV },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    redact: {
      /**
       * The last four of these are payout details. They are redacted here as
       * well as masked at every boundary, because the boundary is the thing
       * that gets forgotten: a `logger.error({ input })` added in a hurry
       * while chasing a failed save is all it takes to put an account number
       * into a log file that outlives the bug.
       */
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.password',
        '*.otp',
        '*.token',
        '*.accountNumber',
        '*.confirmAccountNumber',
        '*.upiId',
        '*.pan',
      ],
      censor: '[redacted]',
    },
    ...(prettyInDev
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:HH:MM:ss.l',
              ignore: 'app,env',
              singleLine: false,
            },
          },
        }
      : {}),
  });
}
