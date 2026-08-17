import { lazy } from 'react';
import { createBrowserRouter, Navigate, useLocation, type RouteObject } from 'react-router-dom';
import { RootLayout } from './RootLayout';
import { withLocalePrefix } from './localePrefix';
import { RequireAuth, RequireRole } from '../lib/auth/guards';
import CustomerLogin from '../routes/auth/CustomerLogin';
import CustomerRegister from '../routes/auth/CustomerRegister';
import PartnerLogin from '../routes/auth/PartnerLogin';
import PartnerRegister from '../routes/auth/PartnerRegister';
import AdminLogin from '../routes/auth/AdminLogin';
import AdminRegisterPlaceholder from '../routes/auth/AdminRegisterPlaceholder';

/**
 * The whole app's route table.
 *
 * Every surface is `React.lazy`-loaded — the initial bundle a first-time
 * visitor downloads (very often over 4G, to a marketing page) should not
 * include the admin console's code, and vice versa for an ops user who never
 * touches the marketing site again after onboarding. `RootLayout`'s single
 * `<Suspense>` boundary covers all of them.
 *
 * The four auth routes (`/login`, `/register`, `/partner/login`,
 * `/partner/register`, `/admin/login`, `/admin/register`) are deliberately
 * NOT lazy — they are small, and are the first thing an unauthenticated
 * visitor waits on; splitting them into their own chunk would trade a
 * network round trip for a marginal bundle-size saving.
 */
const MarketingEntry = lazy(() => import('../surfaces/marketing/MarketingEntry'));
const CustomerAppEntry = lazy(() => import('../surfaces/customer/CustomerAppEntry'));
const PartnerAppEntry = lazy(() => import('../surfaces/partner/PartnerAppEntry'));
const AdminAppEntry = lazy(() => import('../surfaces/admin/AdminAppEntry'));
const DesignSystemShowcase = lazy(() => import('../routes/design/DesignSystemShowcase'));

/**
 * Strips an explicit `/hi` prefix — mirrors the old Next middleware's
 * behaviour of redirecting `/hi/...` to the unprefixed equivalent, so the
 * default locale never has two canonical URLs for the same page (which
 * would split SEO ranking signal on the marketing surface, and is simply
 * confusing everywhere else). `useLocation` rather than route params: this
 * renders under a wildcard (`/hi/*`), so the remainder of the path is
 * whatever `location.pathname` says after stripping the two-character prefix.
 */
function RedirectStripLocale() {
  const { pathname, search } = useLocation();
  const stripped = pathname.replace(/^\/hi(?=\/|$)/, '') || '/';
  return <Navigate to={`${stripped}${search}`} replace />;
}

/**
 * Every route below is written locale-unprefixed — `withLocalePrefix`
 * mounts this exact tree once under `/` (Hindi) and once under `/en`.
 *
 * Auth routes sit as SIBLINGS of the guarded `*Entry` routes, not nested
 * inside them — nesting a login page under a route `RequireAuth` wraps would
 * redirect a signed-out visitor to a login page that immediately redirects
 * back to itself. Each guarded surface names its own `redirectTo` so a
 * customer, a technician and an ops user each land on their own sign-in
 * screen rather than one shared page.
 */
const surfaceRoutes: RouteObject[] = [
  // Wildcard, not `index: true` — the marketing surface owns nine routes
  // (/, /services, /services/:slug, /how-it-works, /for-partners, /download,
  // /contact, /privacy, /terms), the same "surface owns its own nested
  // routing" shape `app/*`/`partner/*`/`admin/*` already use below. Flagged
  // in the marketing port's own report: this was a one-line change from the
  // scaffold's original `index: true`, which could only ever match `/`
  // itself and would have 404'd every other marketing route.
  { path: '*', element: <MarketingEntry /> },

  { path: 'login', element: <CustomerLogin /> },
  { path: 'register', element: <CustomerRegister /> },
  { path: 'partner/login', element: <PartnerLogin /> },
  { path: 'partner/register', element: <PartnerRegister /> },
  { path: 'admin/login', element: <AdminLogin /> },
  // No public admin/register form — see AdminRegisterPlaceholder's own
  // comment for why, and that this route was added on a mid-task
  // clarification worth a second look from the product owner.
  { path: 'admin/register', element: <AdminRegisterPlaceholder /> },

  {
    path: 'app/*',
    element: (
      <RequireAuth redirectTo="/login">
        <CustomerAppEntry />
      </RequireAuth>
    ),
  },
  {
    // RequireAuth, not RequireRole('technician') — see PartnerLogin's own
    // comment: a signed-in non-technician has to reach this route to see
    // the "become a partner" pitch, not bounce back to /partner/login.
    path: 'partner/*',
    element: (
      <RequireAuth redirectTo="/partner/login">
        <PartnerAppEntry />
      </RequireAuth>
    ),
  },
  {
    path: 'admin/*',
    element: (
      <RequireRole role={['ops', 'admin']} redirectTo="/admin/login">
        <AdminAppEntry />
      </RequireRole>
    ),
  },

  { path: 'design', element: <DesignSystemShowcase /> },
  // No catch-all here on purpose. The marketing wildcard above already matches
  // every unclaimed path, and `MarketingEntry`'s own nested `path="*"` renders
  // `NotFound` inside the marketing header/footer — which is the better 404
  // anyway, since it gives a lost visitor somewhere to go. A second `path: '*'`
  // at this level is unreachable dead code: React Router ranks by specificity,
  // and between two equally-ranked wildcards the first one declared wins.
];

export const router = createBrowserRouter(
  [
    { path: '/hi', element: <RedirectStripLocale /> },
    { path: '/hi/*', element: <RedirectStripLocale /> },
    ...withLocalePrefix(surfaceRoutes).map((root) => ({ ...root, element: <RootLayout /> })),
  ],
  // Opting into React Router v7's behaviour now rather than carrying two
  // deprecation warnings into every future agent's test/dev output — see
  // https://reactrouter.com/v6/upgrading/future.
  { future: { v7_relativeSplatPath: true } },
);
