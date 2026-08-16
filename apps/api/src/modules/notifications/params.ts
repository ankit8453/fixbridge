import type { Locale } from '@fixbridge/shared';
import { formatIstDateTime, formatRupees, type TemplateParams } from './render';
import { translate } from '../../core/i18n';

/**
 * Template parameters, stored raw and rendered late.
 *
 * ## Why they are tagged rather than strings
 *
 * A notification is written once and read many times, potentially by somebody
 * who has since switched their app to English. If "16 अगस्त, शाम 5:00 बजे" were
 * baked in at write time, their whole inbox would stay in a language they no
 * longer read — and the WhatsApp copy would have to be rendered separately
 * anyway, so the formatting would exist in two places regardless.
 *
 * So the row stores `{"time":{"t":"time","v":"2026-08-16T11:30:00.000Z"}}` and
 * every reader materialises it into their own language. Money, times and nested
 * i18n phrases are the three things that actually differ; a name does not.
 *
 * The tags are deliberately terse — this is a JSONB column that will hold a row
 * per notification per user forever.
 */

export type NotificationParam =
  | { t: 'text'; v: string }
  | { t: 'num'; v: number }
  /** Paise. Rendered as ₹ with Indian grouping, identically in both languages. */
  | { t: 'money'; v: number }
  /** ISO-8601 instant, rendered in IST in the reader's language. */
  | { t: 'time'; v: string }
  /**
   * An i18n key, resolved in the reader's language.
   *
   * This is what a suspension reason is: decided by the trust engine hours
   * earlier, in no language at all, and it has to become Hindi or English at the
   * moment a technician reads it.
   */
  | { t: 'key'; v: string };

export type NotificationParams = Record<string, NotificationParam>;

/** Constructors, so a route's parameter bag reads like a sentence. */
export const P = {
  text: (v: string): NotificationParam => ({ t: 'text', v }),
  num: (v: number): NotificationParam => ({ t: 'num', v }),
  money: (paise: number): NotificationParam => ({ t: 'money', v: paise }),
  time: (instant: Date): NotificationParam => ({ t: 'time', v: instant.toISOString() }),
  key: (i18nKey: string): NotificationParam => ({ t: 'key', v: i18nKey }),
};

export function materialise(params: NotificationParams, language: Locale): TemplateParams {
  const out: TemplateParams = {};

  for (const [name, param] of Object.entries(params)) {
    switch (param.t) {
      case 'money':
        out[name] = formatRupees(param.v);
        break;
      case 'time':
        out[name] = formatIstDateTime(new Date(param.v), language);
        break;
      case 'key':
        out[name] = translate(language, param.v);
        break;
      default:
        out[name] = param.v;
    }
  }

  return out;
}

/**
 * Reads a stored `params` JSONB column back.
 *
 * Tolerant on purpose: rows written by an older shape, or by a seed, must not
 * make somebody's whole inbox fail to load. Anything unrecognised becomes text.
 */
export function parseStoredParams(raw: unknown): NotificationParams {
  if (raw === null || typeof raw !== 'object') return {};

  const out: NotificationParams = {};

  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value !== null && typeof value === 'object' && 't' in value && 'v' in value) {
      out[name] = value as NotificationParam;
    } else if (typeof value === 'number') {
      out[name] = P.num(value);
    } else {
      out[name] = P.text(String(value));
    }
  }

  return out;
}
