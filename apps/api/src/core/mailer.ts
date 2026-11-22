import nodemailer from 'nodemailer';
import type { AppConfig } from './config';
import type { AppLogger } from './logger';

export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
  html: string;
}

/**
 * Outgoing email. Today its only job is telling the team that somebody is
 * waiting for a sign-in code (`team_relay`), so it is deliberately tiny.
 */
export interface Mailer {
  readonly name: string;
  send(message: MailMessage): Promise<void>;
}

/**
 * SMTP — Gmail with an App password during the pilot, because it is free and
 * the team already has the account. Any SMTP host works the same way.
 */
export function createSmtpMailer(config: AppConfig, logger: AppLogger): Mailer | null {
  if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASS) return null;

  const transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    // 465 speaks TLS from the first byte; anything else upgrades with STARTTLS.
    secure: config.SMTP_PORT === 465,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
    // An alert that takes longer than this to send is no longer an alert.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

  const from = config.SMTP_FROM ?? `FixBridge <${config.SMTP_USER}>`;

  return {
    name: 'smtp',
    async send(message) {
      await transporter.sendMail({ from, ...message });
      logger.info({ recipients: message.to.length }, 'email sent');
    },
  };
}
