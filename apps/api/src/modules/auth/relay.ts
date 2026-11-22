import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import type { AppLogger } from '../../core/logger';
import type { Mailer } from '../../core/mailer';
import type { OtpTransport } from './transport';

/**
 * Sign-in codes delivered by a person, not a provider.
 *
 * ## Why this exists
 *
 * The pilot has no budget for SMS or the WhatsApp Business API, and Indian SMS
 * needs DLT registration that a not-yet-registered team cannot finish in time.
 * So during the pilot nothing is sent automatically. The code is kept here for
 * staff, the team is emailed, and a team member sends the code from their own
 * WhatsApp using the prefilled link — one tap from the alert email or from the
 * console's "Sign-in requests" page.
 *
 * It still proves the person owns the number: the code goes only to the
 * WhatsApp of the number that was typed, so typing someone else's number gets
 * the typist nothing.
 *
 * ## Moving off it
 *
 * Set `AUTH_OTP_TRANSPORT` to an automatic transport. The clients read
 * `delivery` from `/auth/otp/request` and switch their wording by themselves,
 * so no app update is needed.
 *
 * ## What is stored
 *
 * The plaintext code, for exactly as long as it is valid (the OTP TTL), in
 * Redis only — never Postgres, never a log. The OTP store keeps its own HMAC
 * as usual; this copy exists only so a human can read it out.
 */

export interface RelayRequest {
  id: string;
  /** E.164, unmasked: staff have to message this exact number. */
  phone: string;
  otp: string;
  createdAt: string;
  expiresAt: string;
  sentAt: string | null;
  /** Display name of the team member who tapped "Send on WhatsApp". */
  sentBy: string | null;
}

const KEYS = {
  request: (id: string) => `auth:relay:req:${id}`,
  byPhone: (phone: string) => `auth:relay:phone:${phone}`,
  index: 'auth:relay:index',
} as const;

/** More than this many people waiting at once would be an attack, not a queue. */
const LIST_LIMIT = 100;

export function createRelayStore(redis: Redis, ttlSeconds: number) {
  async function remove(id: string): Promise<void> {
    await redis.multi().del(KEYS.request(id)).zrem(KEYS.index, id).exec();
  }

  return {
    /**
     * Records a fresh code for `phone`. A newer code makes the older one
     * useless (the OTP store keeps one code per phone), so the older request
     * is dropped rather than left on the page to be sent by mistake.
     */
    async save(phone: string, otp: string, now = new Date()): Promise<RelayRequest> {
      const previous = await redis.get(KEYS.byPhone(phone));
      if (previous) await remove(previous);

      const request: RelayRequest = {
        id: randomUUID(),
        phone,
        otp,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
        sentAt: null,
        sentBy: null,
      };

      await redis
        .multi()
        .set(KEYS.request(request.id), JSON.stringify(request), 'EX', ttlSeconds)
        .set(KEYS.byPhone(phone), request.id, 'EX', ttlSeconds)
        .zadd(KEYS.index, now.getTime(), request.id)
        // Index entries whose request has certainly expired.
        .zremrangebyscore(KEYS.index, '-inf', now.getTime() - ttlSeconds * 1000)
        .exec();

      return request;
    },

    /** Every code still waiting, newest first. */
    async list(now = new Date()): Promise<RelayRequest[]> {
      const ids = await redis.zrevrange(KEYS.index, 0, LIST_LIMIT - 1);
      if (ids.length === 0) return [];

      const raw = await redis.mget(...ids.map(KEYS.request));
      const stale = ids.filter((_, index) => raw[index] === null);
      if (stale.length > 0) await redis.zrem(KEYS.index, ...stale);

      return raw
        .filter((value): value is string => value !== null)
        .map((value) => JSON.parse(value) as RelayRequest)
        .filter((request) => new Date(request.expiresAt) > now);
    },

    /** Notes who sent it, keeping the original expiry. Null if it has gone. */
    async markSent(id: string, sentBy: string, now = new Date()): Promise<RelayRequest | null> {
      const raw = await redis.get(KEYS.request(id));
      if (!raw) return null;

      const request: RelayRequest = {
        ...(JSON.parse(raw) as RelayRequest),
        sentAt: now.toISOString(),
        sentBy,
      };

      await redis.set(KEYS.request(id), JSON.stringify(request), 'KEEPTTL');
      return request;
    },

    /** The person has signed in: nothing left for the team to send. */
    async clearPhone(phone: string): Promise<void> {
      const id = await redis.get(KEYS.byPhone(phone));
      await redis.del(KEYS.byPhone(phone));
      if (id) await remove(id);
    },
  };
}

export type RelayStore = ReturnType<typeof createRelayStore>;

/** `+919876543210` → `+91 98765 43210`, for people to read. */
export function formatPhone(phone: string): string {
  const match = /^\+91(\d{5})(\d{5})$/.exec(phone);
  return match ? `+91 ${match[1]} ${match[2]}` : phone;
}

/**
 * The prefilled WhatsApp message, in both languages because a first-time
 * user's language is not known yet.
 */
export function relayMessage(otp: string, minutes: number): string {
  return [
    `FixBridge sign-in code: ${otp}`,
    `Valid for ${minutes} minutes. Do not share it with anyone.`,
    '',
    `FixBridge लॉग-इन कोड: ${otp}`,
    `${minutes} मिनट तक मान्य। इसे किसी को न बताएं।`,
  ].join('\n');
}

/** Opens WhatsApp (app or web) with the message ready to send. */
export function whatsappUrl(
  request: Pick<RelayRequest, 'phone' | 'otp' | 'expiresAt'>,
  now = new Date(),
): string {
  const minutes = Math.max(
    1,
    Math.ceil((new Date(request.expiresAt).getTime() - now.getTime()) / 60_000),
  );
  const digits = request.phone.replace(/\D/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(relayMessage(request.otp, minutes))}`;
}

function istTime(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** The alert the team gets on their phones. */
export function relayAlertEmail(
  request: RelayRequest,
  consoleUrl: string,
): { subject: string; text: string; html: string } {
  const phone = formatPhone(request.phone);
  const link = whatsappUrl(request, new Date(request.createdAt));
  const expires = istTime(request.expiresAt);

  const text = [
    'Someone is waiting to sign in to FixBridge.',
    '',
    `Phone: ${phone}`,
    `Code: ${request.otp}`,
    `Valid until: ${expires} IST`,
    '',
    `Send it on WhatsApp: ${link}`,
    '',
    `All waiting requests: ${consoleUrl}`,
    '',
    'Send the code only to this number, and never share it with anyone else.',
  ].join('\n');

  const html = `<div style="font-family:Arial,sans-serif;font-size:16px;color:#0f172a;max-width:480px">
  <p>Someone is waiting to sign in to FixBridge.</p>
  <p style="margin:0">Phone: <strong>${phone}</strong></p>
  <p style="font-size:32px;letter-spacing:6px;font-family:monospace;margin:12px 0"><strong>${request.otp}</strong></p>
  <p style="margin:0 0 20px;color:#475569">Valid until ${expires} IST</p>
  <p><a href="${link}" style="background:#16a34a;color:#ffffff;padding:14px 22px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Send on WhatsApp</a></p>
  <p><a href="${consoleUrl}">All waiting requests</a></p>
  <p style="color:#64748b;font-size:13px">Send the code only to this number, and never share it with anyone else.</p>
</div>`;

  return { subject: `Sign-in code for ${phone}`, text, html };
}

export interface TeamRelayDeps {
  redis: Redis;
  ttlSeconds: number;
  mailer: Mailer | null;
  alertEmails: string[];
  /** The console page, linked from the alert. */
  consoleUrl: string;
  logger: AppLogger;
}

export function createTeamRelayOtpTransport(deps: TeamRelayDeps): OtpTransport {
  const store = createRelayStore(deps.redis, deps.ttlSeconds);
  const alerting = deps.mailer !== null && deps.alertEmails.length > 0;

  if (!alerting) {
    deps.logger.warn(
      'AUTH_OTP_TRANSPORT=team_relay without OTP_RELAY_ALERT_EMAILS and SMTP — codes will wait on ' +
        'the console page, but nobody will be alerted',
    );
  }

  return {
    name: 'team_relay',

    async send({ phone, otp }) {
      const request = await store.save(phone, otp);

      if (!alerting || !deps.mailer) return;

      // Not awaited: the person asking for a code should not wait on Gmail.
      // A failed alert still leaves the code on the console page.
      const mailer = deps.mailer;
      void mailer
        .send({ to: deps.alertEmails, ...relayAlertEmail(request, deps.consoleUrl) })
        .catch((error: unknown) => {
          deps.logger.error(
            { err: error instanceof Error ? error.message : String(error) },
            'sign-in alert email failed — the code is still on the console page',
          );
        });
    },

    async onVerified(phone) {
      await store.clearPhone(phone);
    },
  };
}
