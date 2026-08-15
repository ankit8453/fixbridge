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
      paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.otp', '*.token'],
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
