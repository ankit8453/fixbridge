import { Routes, Route } from 'react-router-dom';
import NotFound from '@/router/NotFound';
import { MarketingLayout } from './MarketingLayout';
import Home from './pages/Home';
import ServicesIndex from './pages/ServicesIndex';
import ServiceDetail from './pages/ServiceDetail';
import HowItWorksPage from './pages/HowItWorksPage';
import ForPartners from './pages/ForPartners';
import Download from './pages/Download';
import Contact from './pages/Contact';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';

/**
 * Surface A — the public marketing/SEO site (PHASE12_PROMPT.md §A), ported
 * from `legacy-next-src/app/[locale]/(marketing)/**`.
 *
 * `router.tsx` mounts this at a wildcard so the surface owns its own nested
 * routing, the same shape `CustomerAppEntry`/`PartnerAppEntry`/`AdminAppEntry`
 * already use for `/app/*`, `/partner/*`, `/admin/*` — see this port's own
 * report for the one-line `router.tsx` change (`index: true` -> `path: '*'`)
 * that this required, since the scaffold had marketing wired as a single
 * exact-match index route with no room for `/services`, `/contact`, etc.
 *
 * Every route here is reachable outside any auth guard — a signed-out
 * visitor from a WhatsApp link must reach a fully rendered page on the first
 * request, matching the old Next `(marketing)` route group's own contract
 * (see `MarketingLayout`'s comment).
 */
export default function MarketingEntry() {
  return (
    <Routes>
      <Route element={<MarketingLayout />}>
        <Route index element={<Home />} />
        <Route path="services" element={<ServicesIndex />} />
        <Route path="services/:slug" element={<ServiceDetail />} />
        <Route path="how-it-works" element={<HowItWorksPage />} />
        <Route path="for-partners" element={<ForPartners />} />
        <Route path="download" element={<Download />} />
        <Route path="contact" element={<Contact />} />
        <Route path="privacy" element={<Privacy />} />
        <Route path="terms" element={<Terms />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
