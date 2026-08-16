import { SUPPORTED_LOCALES, type Locale } from '@fixbridge/shared';
import { describe, expect, it } from 'vitest';
import { hasTranslation, translate } from '../../core/i18n';
import { materialise, P, parseStoredParams } from './params';
import {
  MissingTemplateParamError,
  canRender,
  firstNameOf,
  formatIstDateTime,
  formatRupees,
  positionalParams,
  renderDeepLink,
  renderMessage,
} from './render';
import { NOTIFICATION_ROUTES } from './routing';
import {
  TEMPLATES,
  TEMPLATE_IDS,
  TRANSLATED_PARAM_KEYS,
  bodyKeyOf,
  templateIdFromBodyKey,
  titleKeyOf,
} from './templates';

/**
 * The vocabulary, checked without a database.
 *
 * Everything a message says is decided by pure functions, so the entire
 * catalogue can be walked in both languages in milliseconds. That is what makes
 * "every template exists in Hindi" a build-time fact rather than a customer
 * support ticket.
 */

describe('template × locale completeness', () => {
  /**
   * The test this module exists for.
   *
   * Hindi is the primary language of this product. An English-only template does
   * not degrade gracefully — `translate` falls back to the *key*, so a customer
   * in Jabalpur would receive the literal string `notif.booking.accepted.body`.
   */
  it.each(SUPPORTED_LOCALES)('has every template title and body in %s', (locale) => {
    const missing: string[] = [];

    for (const id of TEMPLATE_IDS) {
      const spec = TEMPLATES[id];

      if (!hasTranslation(locale, titleKeyOf(spec))) missing.push(titleKeyOf(spec));
      if (!hasTranslation(locale, bodyKeyOf(spec))) missing.push(bodyKeyOf(spec));
    }

    expect(missing).toEqual([]);
  });

  /** Keys reached through a `{ t: 'key' }` parameter rather than by a template. */
  it.each(SUPPORTED_LOCALES)('has every indirectly-referenced key in %s', (locale) => {
    const missing = TRANSLATED_PARAM_KEYS.filter((key) => !hasTranslation(locale, key));

    expect(missing).toEqual([]);
  });

  /**
   * A parameter the template never mentions is dead weight; a placeholder the
   * template declares but the locale file does not use is a fact that silently
   * never reaches anybody.
   */
  it.each(SUPPORTED_LOCALES)('uses every declared parameter in the %s text', (locale) => {
    const unused: string[] = [];

    for (const id of TEMPLATE_IDS) {
      const spec = TEMPLATES[id];
      const text = translate(locale, titleKeyOf(spec)) + translate(locale, bodyKeyOf(spec));

      for (const param of spec.params) {
        if (!text.includes(`{{${param}}}`)) unused.push(`${id}.${param} (${locale})`);
      }
    }

    expect(unused).toEqual([]);
  });

  /** No placeholder in the text that the template does not declare. */
  it.each(SUPPORTED_LOCALES)('declares every placeholder the %s text uses', (locale) => {
    const undeclared: string[] = [];

    for (const id of TEMPLATE_IDS) {
      const spec = TEMPLATES[id];
      const text = translate(locale, titleKeyOf(spec)) + '|' + translate(locale, bodyKeyOf(spec));

      for (const match of text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) {
        const name = match[1] as string;
        const declared: readonly string[] = spec.params;
        if (!declared.includes(name)) undeclared.push(`${id}.${name} (${locale})`);
      }
    }

    expect(undeclared).toEqual([]);
  });

  it('recovers a template id from a stored body key', () => {
    for (const id of TEMPLATE_IDS) {
      expect(templateIdFromBodyKey(bodyKeyOf(TEMPLATES[id]))).toBe(id);
    }

    expect(templateIdFromBodyKey('notif.something.deleted.body')).toBeNull();
  });
});

describe('parameter validation', () => {
  it('refuses to render when a declared parameter is missing', () => {
    expect(() => renderMessage('bookingAccepted', { providerName: 'Ramesh' }, 'hi')).toThrow(
      MissingTemplateParamError,
    );
  });

  /**
   * The specific failure this guards against: a message that reads
   * "…दरवाज़े पर उन्हें यह कोड बताएँ: undefined". It is always found by a
   * customer rather than by a developer.
   */
  it('names exactly what was missing', () => {
    try {
      renderMessage('bookingAccepted', { providerName: 'Ramesh' }, 'hi');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(MissingTemplateParamError);
      expect((error as MissingTemplateParamError).missing).toEqual(['time', 'otp']);
    }
  });

  it('treats an empty string as missing, not as a value', () => {
    expect(canRender('bookingAccepted', { providerName: 'A', time: 'x', otp: '' })).toBe(false);
    expect(canRender('bookingAccepted', { providerName: 'A', time: 'x', otp: '4821' })).toBe(true);
  });

  it('renders nothing at all for a template with no parameters', () => {
    const message = renderMessage('providerReinstated', {}, 'hi');

    expect(message.body).not.toContain('{{');
    expect(message.body.length).toBeGreaterThan(0);
  });

  it('hands a vendor the parameters in the template order', () => {
    const params = { amount: '₹1,200', utr: 'UTR123' };

    expect(positionalParams('payoutPaid', params)).toEqual(['₹1,200', 'UTR123']);
  });
});

describe('language', () => {
  const params = {
    providerName: 'Ramesh',
    time: '16 Aug, 5:00 pm',
    otp: '4821',
  };

  it('renders Hindi for a hi reader and English for an en reader', () => {
    const hi = renderMessage('bookingAccepted', params, 'hi');
    const en = renderMessage('bookingAccepted', params, 'en');

    expect(hi.body).toContain('4821');
    expect(en.body).toContain('4821');
    expect(hi.body).not.toBe(en.body);
    // Devanagari present in one, absent in the other.
    expect(/[ऀ-ॿ]/.test(hi.body)).toBe(true);
    expect(/[ऀ-ॿ]/.test(en.body)).toBe(false);
  });

  /**
   * The reason parameters are stored tagged rather than rendered.
   *
   * A suspension reason is decided by the trust engine in no language at all;
   * it becomes Hindi or English at the moment somebody reads it, so the same
   * stored row serves a reader who switched languages last week.
   */
  it('resolves a nested i18n parameter into the reader’s language', () => {
    const stored = {
      reason: P.key('trust.suspension.repeatCancellation'),
      until: P.time(new Date('2026-08-20T06:30:00.000Z')),
    };

    const hi = renderMessage('providerSuspended', materialise(stored, 'hi'), 'hi');
    const en = renderMessage('providerSuspended', materialise(stored, 'en'), 'en');

    expect(hi.body).toContain(translate('hi', 'trust.suspension.repeatCancellation'));
    expect(en.body).toContain(translate('en', 'trust.suspension.repeatCancellation'));
    expect(hi.body).not.toContain('trust.suspension');
  });
});

describe('formatters', () => {
  /** IST, always. The product exists in one timezone and has no DST to worry about. */
  it('formats an instant in IST, in each language', () => {
    // 11:30 UTC = 17:00 IST.
    const instant = new Date('2026-08-16T11:30:00.000Z');

    expect(formatIstDateTime(instant, 'en')).toBe('16 Aug, 5:00 pm');
    expect(formatIstDateTime(instant, 'hi')).toBe('16 अगस्त, शाम 5:00 बजे');
  });

  it('crosses midnight into the next IST day', () => {
    // 19:00 UTC on the 16th is 00:30 IST on the 17th.
    const instant = new Date('2026-08-16T19:00:00.000Z');

    expect(formatIstDateTime(instant, 'en')).toBe('17 Aug, 12:30 am');
    expect(formatIstDateTime(instant, 'hi')).toBe('17 अगस्त, रात 12:30 बजे');
  });

  it('says the hour the way a Hindi speaker does', () => {
    // IST is UTC+05:30, so subtracting 330 minutes turns an IST hour into UTC.
    const at = (hourIst: number) =>
      formatIstDateTime(new Date(Date.UTC(2026, 7, 16, hourIst, -330)), 'hi');

    expect(at(9)).toContain('सुबह');
    expect(at(14)).toContain('दोपहर');
    expect(at(18)).toContain('शाम');
    expect(at(22)).toContain('रात');
  });

  it('formats money with Indian grouping and no paise when there are none', () => {
    expect(formatRupees(120_000)).toBe('₹1,200');
    expect(formatRupees(4_900)).toBe('₹49');
    expect(formatRupees(125_050)).toBe('₹1,250.50');
  });

  it('takes a first name and nothing else', () => {
    expect(firstNameOf('Ramesh Kumar Yadav', 'x')).toBe('Ramesh');
    expect(firstNameOf('  ', 'fallback')).toBe('fallback');
    expect(firstNameOf(null, 'fallback')).toBe('fallback');
  });

  it('interpolates a deep link and leaves unknown placeholders alone', () => {
    expect(renderDeepLink('booking/{{bookingId}}', { bookingId: 'abc' })).toBe('booking/abc');
    expect(renderDeepLink('booking/{{missing}}', {})).toBe('booking/{{missing}}');
    expect(renderDeepLink(undefined, {})).toBeNull();
  });
});

describe('stored parameters', () => {
  it('round-trips through JSON', () => {
    const stored = {
      amount: P.money(120_000),
      time: P.time(new Date('2026-08-16T11:30:00.000Z')),
      name: P.text('Ramesh'),
      count: P.num(3),
      reason: P.key('trust.suspension.opsManual'),
    };

    const back = parseStoredParams(JSON.parse(JSON.stringify(stored)));
    const rendered = materialise(back, 'en');

    expect(rendered.amount).toBe('₹1,200');
    expect(rendered.time).toBe('16 Aug, 5:00 pm');
    expect(rendered.name).toBe('Ramesh');
    expect(rendered.count).toBe(3);
    expect(rendered.reason).toBe(translate('en', 'trust.suspension.opsManual'));
  });

  /** A row written by an older shape must not break somebody's whole inbox. */
  it('tolerates untagged values', () => {
    const rendered = materialise(parseStoredParams({ a: 'plain', b: 7 }), 'hi');

    expect(rendered).toEqual({ a: 'plain', b: 7 });
    expect(parseStoredParams(null)).toEqual({});
  });
});

describe('no phone numbers anywhere in the vocabulary', () => {
  /**
   * The static half of the redaction sweep.
   *
   * Notifications travel over channels the recipient does not control — a
   * forwarded WhatsApp outlives everything — so the other party's number never
   * goes in one. Unmasking lives in the apps, behind a booking in progress.
   */
  it('declares no parameter that could carry a phone number', () => {
    const suspicious = TEMPLATE_IDS.flatMap((id) =>
      TEMPLATES[id].params.filter((param) => /phone|mobile|contact|number$/i.test(param)),
    );

    expect(suspicious).toEqual([]);
  });

  it('has no ten-digit run in any template text', () => {
    const offences: string[] = [];

    for (const locale of SUPPORTED_LOCALES as readonly Locale[]) {
      for (const id of TEMPLATE_IDS) {
        const spec = TEMPLATES[id];
        const text = `${translate(locale, titleKeyOf(spec))} ${translate(locale, bodyKeyOf(spec))}`;

        if (/\d{10}/.test(text)) offences.push(`${id} (${locale})`);
      }
    }

    expect(offences).toEqual([]);
  });
});

describe('the routing table', () => {
  it('names a template that exists, for every audience of every route', () => {
    for (const [topic, route] of Object.entries(NOTIFICATION_ROUTES)) {
      expect(route.criticality, topic).toMatch(/^(critical|standard)$/);
      expect(route.audiences.length, topic).toBeGreaterThan(0);

      for (const audience of route.audiences) {
        expect(TEMPLATES[audience.template], `${topic} → ${audience.role}`).toBeDefined();
        expect(audience.channels.length, `${topic} → ${audience.role}`).toBeGreaterThan(0);

        if (audience.fallbackTemplate) {
          expect(TEMPLATES[audience.fallbackTemplate]).toBeDefined();
        }
      }
    }
  });

  /**
   * In-app is on everything, without exception.
   *
   * It costs nothing, it is the only channel that can hold a long message, and
   * it is the record a dispute is settled from. A route that only sent SMS would
   * leave nothing behind to point at.
   */
  it('puts every message in the inbox as well', () => {
    for (const [topic, route] of Object.entries(NOTIFICATION_ROUTES)) {
      for (const audience of route.audiences) {
        expect(audience.channels, `${topic} → ${audience.role}`).toContain('in_app');
      }
    }
  });

  /**
   * SMS costs money and needs DLT paperwork per template. It earns its place
   * exactly twice: cash recorded, and suspension — the two things somebody must
   * find out even with no data connection, and the two that cost them money if
   * they do not.
   */
  it('spends SMS on only the two messages that need it', () => {
    const withSms = Object.entries(NOTIFICATION_ROUTES)
      .filter(([, route]) => route.audiences.some((a) => a.channels.includes('sms')))
      .map(([topic]) => topic)
      .sort();

    expect(withSms).toEqual(['payment.cash_recorded', 'provider.suspended']);
  });

  it('marks everything that carries an OTP or stops somebody working as critical', () => {
    expect(NOTIFICATION_ROUTES['booking.accepted']?.criticality).toBe('critical');
    expect(NOTIFICATION_ROUTES['payment.cash_recorded']?.criticality).toBe('critical');
    expect(NOTIFICATION_ROUTES['provider.suspended']?.criticality).toBe('critical');
    expect(NOTIFICATION_ROUTES['provider.reinstated']?.criticality).toBe('critical');
  });
});
