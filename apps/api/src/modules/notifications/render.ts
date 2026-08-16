import { PAISE_PER_RUPEE, type Locale } from '@fixbridge/shared';
import { translate } from '../../core/i18n';
import { IST_OFFSET_MINUTES } from '../bookings/slot-plan';
import { TEMPLATES, bodyKeyOf, titleKeyOf, type TemplateId, type TemplateSpec } from './templates';

/**
 * Turning a template plus parameters into the sentence a person actually reads.
 *
 * Pure — no database, no clock of its own, no context. Everything a message
 * needs arrives as arguments, which is what makes the whole vocabulary testable
 * without Postgres and what lets a test enumerate every template in both
 * languages in milliseconds.
 */

export type TemplateParams = Record<string, string | number | null | undefined>;

export interface RenderedMessage {
  title: string;
  body: string;
  /** The template that produced it — the hook DLT registration hangs off. */
  templateStem: string;
  language: Locale;
}

/**
 * Thrown when a template asks for something the event could not supply.
 *
 * Loud on purpose. The alternative — a silent `undefined` interpolated into a
 * WhatsApp message — is the classic way a templating system embarrasses a
 * company in front of its customers, and it is always found by a customer rather
 * than by a developer.
 */
export class MissingTemplateParamError extends Error {
  constructor(
    readonly templateId: string,
    readonly missing: readonly string[],
  ) {
    super(`template "${templateId}" is missing parameter(s): ${missing.join(', ')}`);
    this.name = 'MissingTemplateParamError';
  }
}

/** Which declared parameters have no usable value. Empty means renderable. */
export function missingParams(spec: TemplateSpec, params: TemplateParams): string[] {
  return spec.params.filter((name) => {
    const value = params[name];
    return value === undefined || value === null || value === '';
  });
}

export function canRender(templateId: TemplateId, params: TemplateParams): boolean {
  return missingParams(TEMPLATES[templateId], params).length === 0;
}

/**
 * Renders one template into one language.
 *
 * `params` are already materialised — money formatted, instants turned into IST
 * phrases, nested i18n keys resolved. See `params.ts` for why that happens here
 * rather than when the notification was written.
 */
export function renderMessage(
  templateId: TemplateId,
  params: TemplateParams,
  language: Locale,
): RenderedMessage {
  const spec: TemplateSpec = TEMPLATES[templateId];
  const missing = missingParams(spec, params);

  if (missing.length > 0) throw new MissingTemplateParamError(templateId, missing);

  const vars: Record<string, string | number> = {};
  for (const name of spec.params) {
    vars[name] = params[name] as string | number;
  }

  return {
    title: translate(language, titleKeyOf(spec), vars),
    body: translate(language, bodyKeyOf(spec), vars),
    templateStem: spec.stem,
    language,
  };
}

/** Parameters in the template's declared order — what real vendors want. */
export function positionalParams(
  templateId: TemplateId,
  params: TemplateParams,
): (string | number)[] {
  return TEMPLATES[templateId].params.map((name) => params[name] as string | number);
}

/** `booking/{{bookingId}}` → `booking/9f2…`. Unknown placeholders are left alone. */
export function renderDeepLink(pattern: string | undefined, params: TemplateParams): string | null {
  if (!pattern) return null;

  return pattern.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined || value === null ? match : String(value);
  });
}

/* -------------------------------------------------------------------------- */
/* Formatters                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Month and time-of-day names, written out rather than left to `Intl`.
 *
 * A hard dependency on ICU data being present in whatever Node the container
 * ships is a strange thing to bet a customer's appointment time on, and the
 * output would still not be the phrasing we want: Hindi says "शाम 5 बजे", not
 * "5:00 अपराह्न". Twelve nouns are cheaper than the uncertainty.
 */
const MONTHS: Record<Locale, readonly string[]> = {
  hi: [
    'जनवरी',
    'फ़रवरी',
    'मार्च',
    'अप्रैल',
    'मई',
    'जून',
    'जुलाई',
    'अगस्त',
    'सितंबर',
    'अक्टूबर',
    'नवंबर',
    'दिसंबर',
  ],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

/** How a Jabalpur speaker actually says the hour. */
function hindiDaypart(hour24: number): string {
  if (hour24 < 4) return 'रात';
  if (hour24 < 12) return 'सुबह';
  if (hour24 < 16) return 'दोपहर';
  if (hour24 < 20) return 'शाम';
  return 'रात';
}

/**
 * A booking time, in IST, in the recipient's language.
 *
 * Always IST: this product exists in one timezone and a technician reading a
 * time is standing in it. The offset is a fixed +05:30 with no DST, so plain
 * arithmetic is exactly right — see `bookings/slot-plan.ts`.
 */
export function formatIstDateTime(instant: Date, language: Locale): string {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MINUTES * 60_000);

  const day = shifted.getUTCDate();
  const month = MONTHS[language][shifted.getUTCMonth()] ?? '';
  const hour24 = shifted.getUTCHours();
  const minute = String(shifted.getUTCMinutes()).padStart(2, '0');

  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;

  if (language === 'hi') {
    return `${day} ${month}, ${hindiDaypart(hour24)} ${hour12}:${minute} बजे`;
  }

  return `${day} ${month}, ${hour12}:${minute} ${hour24 < 12 ? 'am' : 'pm'}`;
}

/**
 * Money, identically in both languages.
 *
 * Indian digit grouping and a ₹ sign read the same to everybody here, and a
 * number a customer has to reconcile against a bank SMS should not be spelled
 * two different ways depending on an app setting.
 */
export function formatRupees(amountPaise: number): string {
  const rupees = Math.floor(amountPaise / PAISE_PER_RUPEE);
  const paise = amountPaise % PAISE_PER_RUPEE;

  return paise === 0
    ? `₹${rupees.toLocaleString('en-IN')}`
    : `₹${rupees.toLocaleString('en-IN')}.${String(paise).padStart(2, '0')}`;
}

/**
 * A first name and nothing else.
 *
 * Notifications identify the other party by first name only. A full name plus a
 * time and a category is enough to find somebody, and these messages travel over
 * channels the recipient does not control — a forwarded WhatsApp lives forever.
 */
export function firstNameOf(name: string | null | undefined, fallback: string): string {
  const trimmed = (name ?? '').trim();
  if (trimmed.length === 0) return fallback;

  return trimmed.split(/\s+/)[0] ?? fallback;
}
