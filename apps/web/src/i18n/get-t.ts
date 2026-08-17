import { createTranslator, type Translator } from './dictionaries';
import type { Locale } from './config';

/**
 * `t()` for server components and route handlers.
 *
 * Server components read the locale from their segment's `params.locale`
 * (every page under `src/app/[locale]/...` receives it) and pass it here —
 * there is no ambient "current locale" on the server the way `document.lang`
 * gives one in the browser, because a server has no single request in flight
 * to hang state off between calls. That is also why this takes `locale` as an
 * argument instead of reading a module-level variable: two requests for `/`
 * and `/en` can be mid-flight on the same server process at once.
 */
export function getT(locale: Locale): Translator {
  return createTranslator(locale);
}
