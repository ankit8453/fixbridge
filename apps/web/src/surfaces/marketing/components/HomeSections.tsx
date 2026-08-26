import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLocale, useT } from '@/i18n/useT';
import { buildLocalizedHref } from '@/i18n/config';
import type { CityTrustStats } from '../data';
import { QuoteLockScene, AppPhoneScene } from './Illustrations';

/**
 * The homepage's section library. One file on purpose: these sections share a
 * visual grammar and keeping them together is what keeps a long scroll
 * reading as one page rather than five widgets.
 *
 * Second pass on that grammar: the first version put everything in bordered
 * white cards, and the whole page read as boxes. This version is open —
 * sections breathe on the page ground, structure comes from type, colour
 * washes, connecting lines and illustration rather than from card borders.
 *
 * Every icon is drawn inline — the marketing surface renders before any
 * JS-heavy icon library needs to load, and emoji are banned across the
 * product for rendering inconsistently on cheap Android phones.
 */

/* -------------------------------------------------------------------------- */
/* Shared bits                                                                */
/* -------------------------------------------------------------------------- */

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function CheckDot({ className = 'text-brand' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`h-5 w-5 shrink-0 ${className}`} aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.12" stroke="none" />
      <path d="m7.5 12.3 3 3 6-6.3" {...STROKE} strokeWidth={2.2} />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Live trust band                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Real numbers from the live API, not marketing claims. A count that moves as
 * technicians verify is worth more than any adjective — and if the platform is
 * young, an honest small number still beats a fake big one.
 */
export function TrustBand({
  stats,
  serviceCount,
}: {
  stats: CityTrustStats | null;
  serviceCount: number | null;
}) {
  const t = useT();

  const cells: { value: string; label: string; hint?: string }[] = [];

  if (stats) {
    cells.push({
      value: String(stats.verifiedTechnicianCount),
      label: t('marketing.liveband.technicians'),
    });
  }
  if (serviceCount) {
    cells.push({ value: `${serviceCount}+`, label: t('marketing.liveband.services') });
  }
  if (stats?.averageRating) {
    cells.push({
      value: stats.averageRating.value.toFixed(1),
      label: t('marketing.liveband.rating'),
      hint: t('marketing.liveband.ratingOf'),
    });
  }

  if (cells.length === 0) return null;

  return (
    <section className="mx-auto max-w-5xl px-4 pb-4 pt-2 sm:px-6">
      <div className="flex flex-wrap items-center justify-center gap-x-14 gap-y-6 sm:gap-x-20">
        {cells.map((cell) => (
          <div key={cell.label} className="text-center">
            <p className="bg-gradient-to-br from-brand to-brand-accent-alt bg-clip-text text-4xl font-bold tabular-nums tracking-tight text-transparent sm:text-5xl">
              {cell.value}
              {cell.hint ? (
                <span className="ml-1.5 text-base font-semibold text-slate-400">{cell.hint}</span>
              ) : null}
            </p>
            <p className="mt-1 text-sm font-medium text-slate-500">{cell.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Steps — an open journey line, not four cards                               */
/* -------------------------------------------------------------------------- */

function StepGlyph({ n }: { n: number }) {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
      {n === 1 ? (
        <>
          <circle cx="11" cy="11" r="6.5" {...STROKE} />
          <path d="m16 16 4.5 4.5" {...STROKE} />
        </>
      ) : n === 2 ? (
        <>
          <rect x="3.5" y="5" width="17" height="15.5" rx="3" {...STROKE} />
          <path d="M3.5 10h17M8 3v4M16 3v4" {...STROKE} />
          <circle cx="12" cy="15" r="2" fill="currentColor" stroke="none" />
        </>
      ) : n === 3 ? (
        <>
          <rect x="6.5" y="3.5" width="11" height="17" rx="2.5" {...STROKE} />
          <path d="M10 17.5h4" {...STROKE} />
          <path d="M9.5 8h1.6M11.2 8h1.6M12.9 8h1.6" {...STROKE} strokeWidth={2.6} />
          <path d="M9.5 11h1.6M11.2 11h1.6M12.9 11h1.6" {...STROKE} strokeWidth={2.6} />
        </>
      ) : (
        <>
          <path
            d="M4 8.5h16M4 8.5V17a2.5 2.5 0 0 0 2.5 2.5h11A2.5 2.5 0 0 0 20 17V8.5M7.5 8.5v-2A2.5 2.5 0 0 1 10 4h4a2.5 2.5 0 0 1 2.5 2.5v2"
            {...STROKE}
          />
          <path d="m9.5 13.5 2 2 3.5-3.5" {...STROKE} />
        </>
      )}
    </svg>
  );
}

export function StepsRail() {
  const t = useT();
  const steps = [1, 2, 3, 4] as const;

  return (
    <ol className="relative grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
      {/* The connecting thread — only when the four sit in one row. */}
      <span
        aria-hidden="true"
        className="absolute left-[12%] right-[12%] top-7 hidden border-t-2 border-dashed border-brand/25 lg:block"
      />
      {steps.map((n) => (
        <li key={n} className="relative flex flex-col items-center gap-4 text-center lg:px-2">
          <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-accent-alt text-white shadow-lg shadow-brand/25">
            <StepGlyph n={n} />
            <span className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-amber-400 text-xs font-bold text-slate-900">
              {n}
            </span>
          </span>
          <div>
            <h3 className="text-base font-bold tracking-tight text-slate-900">
              {t(`marketing.steps2.s${n}t`)}
            </h3>
            <p className="mx-auto mt-1.5 max-w-[17rem] text-sm leading-relaxed text-slate-600">
              {t(`marketing.steps2.s${n}d`)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* -------------------------------------------------------------------------- */
/* Feature stories — illustration + copy, alternating sides                   */
/* -------------------------------------------------------------------------- */

/**
 * The two arguments that actually close a booking — the locked price and the
 * verified start — each told as an editorial row: drawn scene on one side,
 * claim + proof bullets on the other. Replaces the old 2×2 card grid.
 */
export function FeatureStories() {
  const t = useT();

  const rows = [
    {
      key: 'f1',
      scene: <QuoteLockScene className="h-auto w-full max-w-[440px]" />,
      flip: false,
    },
    {
      key: 'f2',
      // A real photograph, not a drawing — the safety claim lands harder
      // against an actual panel and actual PPE.
      scene: (
        <div className="relative max-w-[440px]">
          <span
            aria-hidden="true"
            className="absolute -inset-6 rounded-[3rem] bg-gradient-to-br from-brand-soft to-amber-100 opacity-70 blur-2xl"
          />
          <img
            src="/img/marketing/safety-panel.jpg"
            alt=""
            loading="lazy"
            className="relative aspect-[5/6] w-full rounded-[2.5rem] object-cover shadow-xl"
          />
          {/* Verified badge floating over the photo */}
          <span className="absolute -bottom-4 -left-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg">
            <svg viewBox="0 0 24 24" className="h-8 w-8" aria-hidden="true">
              <path d="m6.5 12.5 3.6 3.6 7.4-8" {...STROKE} strokeWidth={2.6} />
            </svg>
          </span>
        </div>
      ),
      flip: true,
    },
  ] as const;

  return (
    <div className="flex flex-col gap-16 sm:gap-24">
      {rows.map(({ key, scene, flip }) => (
        <div key={key} className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16">
          <div className={`flex justify-center ${flip ? 'lg:order-2' : ''}`}>{scene}</div>
          <div className={flip ? 'lg:order-1' : ''}>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand">
              {t(`marketing.feature.${key}Eyebrow`)}
            </p>
            <h3 className="mt-3 max-w-md text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl [text-wrap:balance]">
              {t(`marketing.feature.${key}Title`)}
            </h3>
            <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-slate-600">
              {t(`marketing.feature.${key}Body`)}
            </p>
            <ul className="mt-6 flex flex-col gap-3">
              {([1, 2, 3] as const).map((b) => (
                <li key={b} className="flex items-center gap-3 text-sm font-medium text-slate-700">
                  <CheckDot />
                  {t(`marketing.feature.${key}b${b}`)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Three quiet supporting promises under the stories — icon, line, done. */
export function FeatureStrip() {
  const t = useT();

  const glyphs = [
    // Rupee over an open hand — pay when done
    <g key="1">
      <circle cx="12" cy="9" r="6" {...STROKE} />
      <path
        d="M9.8 6.8h4.4M9.8 9h4.4M12.6 6.8c1.4 0 2 .8 2 1.6s-.6 1.6-2 1.6l2.4 2.6"
        {...STROKE}
        strokeWidth={1.5}
      />
      <path d="M5 18.5c2.2 1.6 4.6 2 7 2s4.8-.4 7-2" {...STROKE} />
    </g>,
    // Headset — a person answers
    <g key="2">
      <path d="M5.5 12a6.5 6.5 0 0 1 13 0" {...STROKE} />
      <rect x="4" y="11.5" width="3.4" height="5.5" rx="1.6" fill="currentColor" stroke="none" />
      <rect x="16.6" y="11.5" width="3.4" height="5.5" rx="1.6" fill="currentColor" stroke="none" />
      <path d="M18.3 17c0 2.4-2 3.4-4.3 3.4" {...STROKE} />
    </g>,
    // Star — earned ratings
    <g key="3">
      <path d="m12 4 2.2 4.6 5 .7-3.6 3.6.8 5-4.4-2.4-4.4 2.4.8-5L4.8 9.3l5-.7L12 4z" {...STROKE} />
    </g>,
  ];

  return (
    <div className="grid gap-8 border-t border-slate-200 pt-10 sm:grid-cols-3">
      {([1, 2, 3] as const).map((n) => (
        <div key={n} className="flex items-start gap-3.5">
          <span className="mt-0.5 text-brand">
            <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
              {glyphs[n - 1]}
            </svg>
          </span>
          <div>
            <h3 className="text-[15px] font-bold tracking-tight text-slate-900">
              {t(`marketing.feature.s${n}t`)}
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">
              {t(`marketing.feature.s${n}d`)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* AMC band                                                                   */
/* -------------------------------------------------------------------------- */

function AmcGlyph({ n }: { n: number }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
      {n === 1 ? (
        <>
          <rect x="3.5" y="5" width="17" height="15.5" rx="3" {...STROKE} />
          <path d="M3.5 10h17M8 3v4M16 3v4" {...STROKE} />
          <path d="m9 14.5 2 2 4-4" {...STROKE} />
        </>
      ) : n === 2 ? (
        <>
          <path
            d="M6.5 4.5h3l1.5 4-2 1.5a12 12 0 0 0 5 5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 6.7a2 2 0 0 1 2-2.2z"
            {...STROKE}
          />
        </>
      ) : n === 3 ? (
        <>
          <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" {...STROKE} />
          <path d="m4.5 7.5 7.5 5.5 7.5-5.5" {...STROKE} />
        </>
      ) : (
        <>
          <circle cx="9.5" cy="8.5" r="3.2" {...STROKE} />
          <path d="M4 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" {...STROKE} />
          <path d="m15.5 9.5 1.8 1.8 3.2-3.2" {...STROKE} />
        </>
      )}
    </svg>
  );
}

/**
 * The AMC identity is deliberately its own: amber on deep slate — machine-room
 * signage — while the rest of the page stays on the consumer indigo. The copy
 * sells only what the client experiences: scheduled visits, a dedicated line,
 * documentation, our own engineers. How visits are staffed internally is ops
 * detail and stays off the page.
 */
export function AmcBand() {
  const t = useT();
  const locale = useLocale();

  return (
    <section className="relative overflow-hidden bg-slate-900">
      {/* Blueprint grid — the drawing this product lives on. Decorative. */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.07]"
      >
        <defs>
          <pattern id="amc-grid" width="36" height="36" patternUnits="userSpaceOnUse">
            <path d="M36 0H0v36" fill="none" stroke="#f5bd5c" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#amc-grid)" />
      </svg>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-amber-400/10 blur-3xl"
      />

      <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-400">
            {t('marketing.amc.eyebrow')}
          </p>
          <h2 className="mt-3 max-w-xl text-3xl font-bold tracking-tight text-white sm:text-4xl [text-wrap:balance]">
            {t('marketing.amc.title')}
          </h2>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-slate-300">
            {t('marketing.amc.sub')}
          </p>

          <ul className="mt-8 flex flex-col gap-5">
            {([1, 2, 3, 4] as const).map((n) => (
              <li key={n} className="flex items-start gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-400/15 text-amber-300">
                  <AmcGlyph n={n} />
                </span>
                <div>
                  <h3 className="text-[15px] font-bold text-white">{t(`marketing.amc.f${n}t`)}</h3>
                  <p className="mt-0.5 max-w-md text-sm leading-relaxed text-slate-400">
                    {t(`marketing.amc.f${n}d`)}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Link
              to={buildLocalizedHref(locale, '/contact')}
              className="inline-flex min-h-touch items-center rounded-full bg-amber-400 px-7 text-[15px] font-bold text-slate-900 transition-all hover:-translate-y-px hover:bg-amber-300"
            >
              {t('marketing.amc.cta')}
            </Link>
            <span className="text-sm text-slate-400">{t('marketing.amc.ctaHint')}</span>
          </div>
        </div>

        {/* Photo collage: the rooftop plant AMC exists for, with the standby
            generator it keeps alive tucked over the corner. */}
        <div className="relative hidden justify-center lg:flex">
          <div className="relative w-full max-w-[460px]">
            <img
              src="/img/marketing/amc-rooftop.jpg"
              alt=""
              loading="lazy"
              className="aspect-[4/3] w-full rounded-[2.5rem] object-cover shadow-2xl ring-1 ring-amber-400/30"
            />
            <img
              src="/img/marketing/generator.jpg"
              alt=""
              loading="lazy"
              className="absolute -bottom-10 -left-8 w-44 rotate-[-4deg] rounded-3xl object-cover shadow-xl ring-4 ring-slate-900"
            />
            <span className="absolute -top-4 right-6 rounded-full bg-amber-400 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-slate-900 shadow-lg">
              AMC
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Partner band — full-bleed gradient, not a floating card                    */
/* -------------------------------------------------------------------------- */

export function PartnerBand() {
  const t = useT();
  const locale = useLocale();

  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-brand via-brand-deep to-brand-accent-alt">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-white/10 blur-3xl"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 right-10 h-72 w-72 rounded-full bg-amber-400/15 blur-3xl"
      />

      <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1fr_1.1fr]">
        <div className="relative hidden justify-center lg:flex">
          <div className="relative w-full max-w-[420px]">
            <img
              src="/img/marketing/partner-meter.jpg"
              alt=""
              loading="lazy"
              className="aspect-[4/5] w-full rounded-[2.5rem] object-cover shadow-2xl ring-4 ring-white/20"
            />
            {/* Earnings chip floating over the photo */}
            <span className="absolute -right-4 top-8 flex items-center gap-2 rounded-2xl bg-white px-4 py-3 shadow-xl">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <svg
                  viewBox="0 0 24 24"
                  className="h-4.5 w-4.5 h-[18px] w-[18px]"
                  aria-hidden="true"
                >
                  <path d="M12 19V5m0 0-6 6m6-6 6 6" {...STROKE} strokeWidth={2.4} />
                </svg>
              </span>
              <span className="text-sm font-bold text-slate-900">₹</span>
            </span>
          </div>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-white/70">
            {t('marketing.partnerBand.eyebrow')}
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl [text-wrap:balance]">
            {t('marketing.partnerBand.title')}
          </h2>
          <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-white/85">
            {t('marketing.partnerBand.sub')}
          </p>
          <ul className="mt-7 flex flex-col gap-3.5">
            {([1, 2, 3] as const).map((n) => (
              <li key={n} className="flex items-center gap-3">
                <CheckDot className="text-amber-300" />
                <span className="text-[15px] font-semibold text-white">
                  {t(`marketing.partnerBand.p${n}`)}
                </span>
              </li>
            ))}
          </ul>
          <Link
            to={buildLocalizedHref(locale, '/partner/register')}
            className="mt-8 inline-flex min-h-touch items-center rounded-full bg-white px-7 text-[15px] font-bold text-brand shadow-sm transition-transform hover:-translate-y-0.5"
          >
            {t('marketing.partnerBand.cta')}
          </Link>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Download band                                                              */
/* -------------------------------------------------------------------------- */

export function DownloadBand() {
  const t = useT();
  const locale = useLocale();

  return (
    <section className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-2 lg:gap-16">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand">
          {t('marketing.download2.eyebrow')}
        </p>
        <h2 className="mt-3 max-w-md text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl [text-wrap:balance]">
          {t('marketing.download2.title')}
        </h2>
        <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-slate-600">
          {t('marketing.download2.body')}
        </p>
        <Link
          to={buildLocalizedHref(locale, '/download')}
          className="mt-7 inline-flex min-h-touch items-center gap-2 text-[15px] font-bold text-brand hover:underline"
        >
          {t('marketing.download2.cta')}
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden="true">
            <path d="M4 12h15m0 0-6-6m6 6-6 6" {...STROKE} strokeWidth={2.2} />
          </svg>
        </Link>
      </div>
      <div className="flex justify-center">
        <AppPhoneScene className="h-auto w-full max-w-[380px]" />
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* FAQ — three audiences, underline tabs, open list                           */
/* -------------------------------------------------------------------------- */

const FAQ_GROUPS = {
  customers: ['c1', 'c2', 'c3', 'c4', 'c5'],
  partners: ['p1', 'p2', 'p3', 'p4', 'p5'],
  amc: ['a1', 'a2', 'a3', 'a4'],
} as const;

type FaqTab = keyof typeof FAQ_GROUPS;

export function HomeFaq() {
  const t = useT();
  const [tab, setTab] = useState<FaqTab>('customers');

  const tabs: { key: FaqTab; label: string }[] = [
    { key: 'customers', label: t('marketing.faq2.tabCustomers') },
    { key: 'partners', label: t('marketing.faq2.tabPartners') },
    { key: 'amc', label: t('marketing.faq2.tabAmc') },
  ];

  return (
    <div>
      <div
        role="tablist"
        aria-label={t('marketing.faq2.title')}
        className="flex gap-7 overflow-x-auto border-b border-slate-200 sm:justify-center"
      >
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`min-h-touch shrink-0 whitespace-nowrap border-b-2 pb-1 text-[15px] font-semibold transition-colors ${
              tab === key
                ? 'border-brand text-brand'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="divide-y divide-slate-200">
        {FAQ_GROUPS[tab].map((k) => (
          <details key={`${tab}-${k}`} className="group py-5">
            <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-semibold text-slate-900 marker:content-none sm:text-base">
              {t(`marketing.faq2.${k}q`)}
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5 shrink-0 text-brand transition-transform group-open:rotate-45"
                aria-hidden="true"
              >
                <path d="M12 5v14M5 12h14" {...STROKE} strokeWidth={2.2} />
              </svg>
            </summary>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600">
              {t(`marketing.faq2.${k}a`)}
            </p>
          </details>
        ))}
      </div>
    </div>
  );
}
