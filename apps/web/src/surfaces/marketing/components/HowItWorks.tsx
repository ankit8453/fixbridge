import { useT } from '@/i18n/useT';

/**
 * The shared 4-step list — the homepage's condensed "how it works" section
 * and the dedicated `/how-it-works` page both render the same four steps
 * (`marketing.howItWorks.s1..s4`); ported from
 * `legacy-next-src/components/marketing/HowItWorks.tsx`. No outer
 * `max-w`/`mx-auto` wrapper on purpose — both call sites already provide
 * their own container.
 */
export function HowItWorksSteps() {
  const t = useT();

  const steps = [1, 2, 3, 4].map((n) => ({
    title: t(`marketing.howItWorks.s${n}Title`),
    desc: t(`marketing.howItWorks.s${n}Desc`),
  }));

  return (
    <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {steps.map((step, index) => (
        <li key={step.title} className="rounded-xl border border-slate-200 bg-white p-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-sm font-bold text-brand-foreground">
            {index + 1}
          </span>
          <h3 className="mt-3 text-base font-semibold text-slate-900">{step.title}</h3>
          <p className="mt-1 text-sm text-slate-600">{step.desc}</p>
        </li>
      ))}
    </ol>
  );
}
