import type { RouteObject } from 'react-router-dom';

/**
 * Duplicates one route tree under `/` (Hindi, unprefixed — the default
 * locale) and `/en` (English), matching the URL scheme `buildLocalizedHref`
 * assumes: `hi` never gets a prefix, every other locale does. This is the
 * SPA equivalent of the old Next app's `middleware.ts` rewrite — there is no
 * middleware layer here, so the duplication happens once, at router
 * construction, instead of per-request.
 *
 * Explicit duplication rather than an optional `:locale?` path param: React
 * Router's optional-segment syntax would make a literal path segment like
 * `login` ambiguous with a locale value in `/:locale?/login` (does `/login`
 * mean "hi, page login" or "locale=login, no further segment"?). Two
 * concrete trees have no such ambiguity, at the cost of the route table
 * existing twice in the router's data structure — which is free at runtime
 * (React Router matches by walking objects, not compiling one regex per
 * call) and keeps `buildLocalizedHref`'s own logic — the one other thing in
 * this app that has to agree with this scheme — trivial to eyeball against.
 */
export function withLocalePrefix(routes: RouteObject[]): RouteObject[] {
  return [
    { path: '/', children: routes },
    { path: '/en', children: routes },
  ];
}
