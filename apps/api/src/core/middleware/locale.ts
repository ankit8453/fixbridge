import type { RequestHandler } from 'express';
import { createTranslator, resolveLocale } from '../i18n';

/** Resolve the caller's locale once per request and expose `req.t`. */
export const localeMiddleware: RequestHandler = (req, res, next) => {
  const locale = resolveLocale(req.header('accept-language'));

  req.locale = locale;
  req.t = createTranslator(locale);
  res.setHeader('Content-Language', locale);

  next();
};
