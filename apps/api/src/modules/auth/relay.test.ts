import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../core/config';
import {
  formatPhone,
  relayAlertEmail,
  relayMessage,
  whatsappUrl,
  type RelayRequest,
} from './relay';

const PHONE = '+919876500001';

const request: RelayRequest = {
  id: '00000000-0000-4000-8000-000000000001',
  phone: PHONE,
  otp: '482913',
  createdAt: '2026-11-23T04:30:00.000Z',
  expiresAt: '2026-11-23T04:45:00.000Z',
  sentAt: null,
  sentBy: null,
};

describe('formatPhone', () => {
  it('spaces an Indian number the way people read it', () => {
    expect(formatPhone(PHONE)).toBe('+91 98765 00001');
  });

  it('leaves anything else alone', () => {
    expect(formatPhone('12345')).toBe('12345');
  });
});

describe('relayMessage', () => {
  it('carries the code and its validity in both languages', () => {
    const message = relayMessage('482913', 15);

    expect(message).toContain('FixBridge sign-in code: 482913');
    expect(message).toContain('Valid for 15 minutes');
    expect(message).toContain('लॉग-इन कोड: 482913');
    expect(message).toContain('15 मिनट');
  });
});

describe('whatsappUrl', () => {
  it('opens a chat with that number and the message filled in', () => {
    const url = new URL(whatsappUrl(request, new Date('2026-11-23T04:30:00.000Z')));

    expect(url.origin).toBe('https://wa.me');
    // wa.me wants the number with no plus sign.
    expect(url.pathname).toBe(`/${PHONE.slice(1)}`);
    expect(url.searchParams.get('text')).toBe(relayMessage('482913', 15));
  });

  it('states the time actually left, never zero', () => {
    const almostExpired = new Date('2026-11-23T04:44:50.000Z');
    const text = new URL(whatsappUrl(request, almostExpired)).searchParams.get('text');

    expect(text).toContain('Valid for 1 minutes');
  });
});

describe('relayAlertEmail', () => {
  it('names the number, shows the code, and links straight to WhatsApp and the console', () => {
    const email = relayAlertEmail(request, 'https://www.fixbridge.me/admin/sign-in-requests');

    expect(email.subject).toBe('Sign-in code for +91 98765 00001');
    expect(email.text).toContain('Code: 482913');
    expect(email.text).toContain('https://wa.me/');
    expect(email.text).toContain('https://www.fixbridge.me/admin/sign-in-requests');
    // 04:45 UTC is 10:15 in India.
    expect(email.text).toMatch(/10:15\s?am IST/i);
    expect(email.html).toContain('Send on WhatsApp');
    expect(email.html).toContain('482913');
  });
});

describe('relay config', () => {
  const base = { ...process.env };

  function parse(extra: Record<string, string | undefined>) {
    return parseConfig({ ...base, ...extra });
  }

  it('reads a comma-separated list of alert addresses', () => {
    const config = parse({
      OTP_RELAY_ALERT_EMAILS: ' a@example.com, b@example.com ,',
      SMTP_HOST: 'smtp.example.com',
      SMTP_USER: 'sender@example.com',
      SMTP_PASS: 'app-password',
    });

    expect(config.OTP_RELAY_ALERT_EMAILS).toEqual(['a@example.com', 'b@example.com']);
    expect(config.SMTP_PORT).toBe(465);
  });

  it('has no alert addresses by default', () => {
    expect(parse({ OTP_RELAY_ALERT_EMAILS: undefined }).OTP_RELAY_ALERT_EMAILS).toEqual([]);
  });

  it('refuses alert addresses with no way to send them', () => {
    expect(() =>
      parse({
        OTP_RELAY_ALERT_EMAILS: 'a@example.com',
        SMTP_HOST: undefined,
        SMTP_USER: undefined,
        SMTP_PASS: undefined,
      }),
    ).toThrow(/SMTP_HOST/);
  });

  it('refuses something that is not an email address', () => {
    expect(() => parse({ OTP_RELAY_ALERT_EMAILS: 'not-an-email' })).toThrow();
  });
});
