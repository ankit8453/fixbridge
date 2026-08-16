import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from '@fixbridge/shared';
import en from './locales/en.json';
import hi from './locales/hi.json';

type MessageNode = string | { [key: string]: MessageNode };
type Catalog = Record<string, MessageNode>;

const CATALOGS: Record<Locale, Catalog> = {
  hi: hi as Catalog,
  en: en as Catalog,
};

export type TranslationVars = Record<string, string | number>;
export type Translator = (key: string, vars?: TranslationVars) => string;

export { DEFAULT_LOCALE, SUPPORTED_LOCALES };
export type { Locale };

export function isSupportedLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Pick the best supported locale from an `Accept-Language` header.
 * Honours q-values, ignores region subtags (`en-IN` → `en`), falls back to `hi`.
 */
export function resolveLocale(acceptLanguage?: string | null): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;

  const ranked = acceptLanguage
    .split(',')
    .map((part, index) => {
      const [tagPart, ...params] = part.trim().split(';');
      const tag = (tagPart ?? '').trim().toLowerCase();
      const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const parsedQ = qParam === undefined ? 1 : Number.parseFloat(qParam.slice(2));
      const q = Number.isFinite(parsedQ) ? parsedQ : 0;
      return { tag, q, index };
    })
    .filter((entry) => entry.tag.length > 0 && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);

  for (const entry of ranked) {
    if (entry.tag === '*') return DEFAULT_LOCALE;
    const base = entry.tag.split('-')[0] ?? '';
    if (isSupportedLocale(base)) return base;
  }

  return DEFAULT_LOCALE;
}

function lookup(catalog: Catalog, key: string): string | undefined {
  let node: MessageNode | undefined = catalog;

  for (const segment of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = node[segment];
  }

  return typeof node === 'string' ? node : undefined;
}

function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * Resolve a key for a locale, falling back to the default locale and finally to
 * the key itself — a missing translation must never break a response.
 */
export function translate(locale: Locale, key: string, vars?: TranslationVars): string {
  const template = lookup(CATALOGS[locale], key) ?? lookup(CATALOGS[DEFAULT_LOCALE], key) ?? key;
  return interpolate(template, vars);
}

export function createTranslator(locale: Locale): Translator {
  return (key, vars) => translate(locale, key, vars);
}

/**
 * Whether a key really exists in a locale, with no fallback.
 *
 * `translate` deliberately never fails — a missing string must not break a
 * response. That is right at runtime and useless at build time, because it means
 * a template with no Hindi renders as the literal key and nothing complains.
 * This is what the notification completeness test asserts against.
 */
export function hasTranslation(locale: Locale, key: string): boolean {
  return lookup(CATALOGS[locale], key) !== undefined;
}
