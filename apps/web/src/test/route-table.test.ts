import { describe, expect, it } from 'vitest';
import { matchRoutes, type RouteObject } from 'react-router-dom';
import { withLocalePrefix } from '../router/localePrefix';

/**
 * The bug this file exists to prevent: a blank homepage.
 *
 * `withLocalePrefix` mounts the surface routes as `children` of a `/` parent
 * (and a `/en` one). A child `path: '*'` matches a NON-EMPTY remainder, so it
 * covers `/services` but not `/` itself. With only a wildcard, the parent
 * matched on the homepage, no child did, and `RootLayout`'s `<Outlet/>`
 * rendered nothing — a blank page with the brand `<style>` tag and no content.
 *
 * It is worth its own test because of how it failed: **silently**. Nothing
 * threw, no console error, no failed request, no 404. React mounted happily
 * and painted nothing. Every existing test mounts a component directly inside
 * a `MemoryRouter`, so none of them exercise the assembled route table — the
 * whole app can be broken while all 56 of them pass.
 *
 * These assert route MATCHING, not rendering, so they stay fast and have no
 * jsdom/lazy-loading dependency. The rule enforced is simply: every path a
 * person can type must resolve to a child route, in both locales.
 */

/**
 * A structural mirror of `router.tsx`'s `surfaceRoutes` — ids instead of
 * elements, so this file never imports the real router (which would pull in
 * every lazily-loaded surface). Keep in step with `router.tsx`.
 */
const surfaceRoutes: RouteObject[] = [
  { index: true, id: 'marketing-index' },
  { path: '*', id: 'marketing-wildcard' },
  { path: 'login', id: 'customer-login' },
  { path: 'register', id: 'customer-register' },
  { path: 'partner/login', id: 'partner-login' },
  { path: 'partner/register', id: 'partner-register' },
  { path: 'admin/login', id: 'admin-login' },
  { path: 'admin/register', id: 'admin-register' },
  { path: 'app/*', id: 'customer-app' },
  { path: 'partner/*', id: 'partner-app' },
  { path: 'admin/*', id: 'admin-app' },
  { path: 'design', id: 'design' },
];

const routes = withLocalePrefix(surfaceRoutes);

/** The id of the deepest route that matched, or null if only the parent did. */
function leafFor(pathname: string): string | null {
  const matches = matchRoutes(routes, pathname);
  if (!matches || matches.length < 2) return null;
  return (matches[matches.length - 1].route as RouteObject & { id?: string }).id ?? null;
}

describe('the assembled route table', () => {
  it('renders something at the two locale roots — the blank-homepage regression', () => {
    // `/` and `/en` matched the parent and NO child before the index route
    // existed. This is the exact assertion that would have caught it.
    expect(leafFor('/')).toBe('marketing-index');
    expect(leafFor('/en')).toBe('marketing-index');
  });

  it.each([
    ['/', 'marketing-index'],
    ['/services', 'marketing-wildcard'],
    ['/services/electrician', 'marketing-wildcard'],
    ['/how-it-works', 'marketing-wildcard'],
    ['/contact', 'marketing-wildcard'],
    ['/privacy', 'marketing-wildcard'],
    ['/terms', 'marketing-wildcard'],
    ['/login', 'customer-login'],
    ['/register', 'customer-register'],
    ['/partner/login', 'partner-login'],
    ['/partner/register', 'partner-register'],
    ['/admin/login', 'admin-login'],
    ['/admin/register', 'admin-register'],
    ['/app', 'customer-app'],
    ['/app/bookings', 'customer-app'],
    ['/partner', 'partner-app'],
    ['/partner/slots', 'partner-app'],
    ['/admin', 'admin-app'],
    ['/admin/money', 'admin-app'],
    ['/design', 'design'],
    // A typo'd URL still has to land somewhere — the marketing surface's own
    // nested `path="*"` renders NotFound inside the marketing chrome.
    ['/nonsense-path-nobody-typed', 'marketing-wildcard'],
  ])('resolves %s to a child route', (pathname, expected) => {
    expect(leafFor(pathname)).toBe(expected);
  });

  it('resolves every one of those under /en too', () => {
    for (const [pathname, expected] of [
      ['/', 'marketing-index'],
      ['/services', 'marketing-wildcard'],
      ['/login', 'customer-login'],
      ['/partner/login', 'partner-login'],
      ['/admin/login', 'admin-login'],
      ['/app/bookings', 'customer-app'],
      ['/design', 'design'],
    ] as const) {
      const prefixed = pathname === '/' ? '/en' : `/en${pathname}`;
      expect(leafFor(prefixed), `${prefixed} should resolve`).toBe(expected);
    }
  });

  it('keeps each surface behind its own sign-in route, never a shared one', () => {
    // Login routes must be SIBLINGS of the guarded surfaces. If one were
    // nested inside the surface its own guard protects, a signed-out visitor
    // would be redirected to a login page that redirects back to itself.
    expect(leafFor('/login')).not.toBe('customer-app');
    expect(leafFor('/partner/login')).not.toBe('partner-app');
    expect(leafFor('/admin/login')).not.toBe('admin-app');
  });
});
