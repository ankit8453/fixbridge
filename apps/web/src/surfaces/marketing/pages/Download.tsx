import { Card } from '@/components/ui';
import { APP_NAME } from '@/brand/tokens';
import { buildLocalizedHref } from '@/i18n/config';
import { useLocale, useT } from '@/i18n/useT';
import { useMarketingSeo } from '../useMarketingSeo';
import { CtaLink } from '../components/Cta';

/**
 * `/download` — the page this whole site exists to deliver somebody to.
 *
 * Android and iPhone are given genuinely different treatments because they
 * *are* different: Android can install from here, and iPhone cannot. Apple
 * does not permit installing apps from a website, so pretending otherwise —
 * a greyed "coming soon" button, an App Store badge that goes nowhere — would
 * just leave iPhone owners tapping at nothing. They are told plainly, and
 * pointed at the web app, which does everything the native one does.
 *
 * The APK links are relative paths served as static files. The version is
 * rendered from `VITE_APP_VERSION` so the page cannot claim a build that was
 * never published.
 */
const APK = {
  customer: '/downloads/fixbridge.apk',
  partner: '/downloads/fixbridge-partner.apk',
} as const;

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? '0.1.0';

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden="true">
      <path
        d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="mt-4 space-y-3">
      {items.map((text, i) => (
        <li key={text} className="flex gap-3">
          <span
            aria-hidden="true"
            className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand"
          >
            {i + 1}
          </span>
          <span className="text-sm leading-relaxed text-slate-600">{text}</span>
        </li>
      ))}
    </ol>
  );
}

export default function Download() {
  const t = useT();
  const locale = useLocale();

  useMarketingSeo({
    locale,
    pathname: '/download',
    title: t('marketing.download.metaTitle'),
    description: t('marketing.download.metaDescription', { app: APP_NAME }),
  });

  const androidSteps = [
    t('marketing.download.androidStep1'),
    t('marketing.download.androidStep2'),
    t('marketing.download.androidStep3'),
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900 [text-wrap:balance]">
        {t('marketing.download.heroTitle')}
      </h1>
      <p className="mt-3 text-lg leading-relaxed text-slate-600">
        {t('marketing.download.heroSubtitle')}
      </p>

      <div className="mt-8 space-y-4">
        <Card title={t('marketing.download.androidTitle')}>
          <Steps items={androidSteps} />

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            {/* Plain anchors, not router links: these leave the SPA and hand
                the file to the browser's own downloader. */}
            <a
              href={APK.customer}
              download
              className="inline-flex min-h-touch items-center justify-center gap-2 rounded-full bg-brand px-5 text-sm font-semibold text-brand-foreground shadow-sm transition-all hover:-translate-y-px hover:opacity-90"
            >
              <DownloadIcon />
              {t('marketing.download.androidCustomerCta')}
            </a>
            <a
              href={APK.partner}
              download
              className="inline-flex min-h-touch items-center justify-center gap-2 rounded-full border border-slate-200 px-5 text-sm font-semibold text-slate-700 transition-colors hover:border-brand hover:text-brand"
            >
              <DownloadIcon />
              {t('marketing.download.androidPartnerCta')}
            </a>
          </div>

          <p className="mt-4 text-xs text-slate-500">
            {t('marketing.download.versionLabel')} {APP_VERSION}
          </p>
        </Card>

        <Card title={t('marketing.download.iosTitle')}>
          <p className="text-sm leading-relaxed text-slate-600">
            {t('marketing.download.iosBody')}
          </p>
          <div className="mt-5">
            <CtaLink href={buildLocalizedHref(locale, '/app')} variant="secondary">
              {t('marketing.download.iosCta')}
            </CtaLink>
          </div>
        </Card>
      </div>

      {/* Sideloading means the usual store-shaped guarantee is absent, so the
          page has to supply the missing one: this is the only honest source. */}
      <p className="mt-8 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        {t('marketing.download.safetyNote')}
      </p>

      <p className="mt-6 text-sm text-slate-500">
        {t('marketing.download.webFallbackNote')}
      </p>
    </div>
  );
}
