import en from '../locales/en.json';
import hi from '../locales/hi.json';
import marketingEn from '../locales/marketing.en.json';
import marketingHi from '../locales/marketing.hi.json';
import customerEn from '../locales/customer.en.json';
import customerHi from '../locales/customer.hi.json';
import partnerEn from '../locales/partner.en.json';
import partnerHi from '../locales/partner.hi.json';
import { DEFAULT_LOCALE, type Locale } from './config';

/**
 * The lookup engine, isomorphic on purpose — it imports nothing from `react`
 * or the DOM, so `useT()` (the only consumer now that there is no server
 * render) and any future non-component call site share one implementation.
 * Mirrors apps/api/src/core/i18n.ts's lookup/interpolate shape deliberately:
 * the web copy needs the same nested-key discipline the API's does, and
 * reusing the algorithm (not the code — API and web ship separately) means
 * anyone who has read one already knows the other.
 */

type MessageNode = string | { [key: string]: MessageNode };
type Catalog = Record<string, MessageNode>;

/**
 * One catalog per surface, merged at the top level.
 *
 * The alternative — a single `hi.json` per locale — turns every surface's copy
 * into edits on one file, which is a conflict every time two people touch the
 * app in the same week, and a merge nobody can review because JSON gives no
 * context. Splitting by surface means the marketing pitch, the customer app's
 * labels and the partner app's job screens are three separate files owned by
 * three separate concerns, and the namespaces (`marketing.*`, `app.*`,
 * `partner.*`) keep them from colliding at lookup time.
 *
 * A shallow merge is enough precisely because each file owns distinct top-level
 * keys; a deep merge would only be needed if two surfaces shared a namespace,
 * which is the thing this arrangement exists to prevent.
 */
const CATALOGS: Record<Locale, Catalog> = {
  hi: {
    ...(hi as Catalog),
    ...(marketingHi as Catalog),
    ...(customerHi as Catalog),
    ...(partnerHi as Catalog),
  },
  en: {
    ...(en as Catalog),
    ...(marketingEn as Catalog),
    ...(customerEn as Catalog),
    ...(partnerEn as Catalog),
  },
};

export type TranslationVars = Record<string, string | number>;
export type Translator = (key: string, vars?: TranslationVars) => string;

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
 * Resolves a key for a locale, falling back to the default locale and finally
 * to the key itself — a missing translation must never crash a render, same
 * reasoning as the API's `translate()`.
 */
export function translate(locale: Locale, key: string, vars?: TranslationVars): string {
  const template = lookup(CATALOGS[locale], key) ?? lookup(CATALOGS[DEFAULT_LOCALE], key) ?? key;
  return interpolate(template, vars);
}

/** A bound translator for one locale — what `useT()` returns. */
export function createTranslator(locale: Locale): Translator {
  return (key, vars) => translate(locale, key, vars);
}
