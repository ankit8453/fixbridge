import type { FaqItem } from '../seo';

export type { FaqItem };

/**
 * Native `<details>`/`<summary>` accordion — zero client JS for a widget
 * whose only job is "show/hide text on tap", which matters on the mobile-
 * first budget this surface designs to. Ported from
 * `legacy-next-src/components/marketing/Faq.tsx`.
 */
export function Faq({ title, items }: { title: string; items: FaqItem[] }) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
      <div className="mt-4 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
        {items.map((item) => (
          <details key={item.question} className="group p-4">
            <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-3 text-base font-medium text-slate-900 marker:content-none">
              {item.question}
              <span
                className="shrink-0 text-slate-400 transition-transform group-open:rotate-45"
                aria-hidden="true"
              >
                +
              </span>
            </summary>
            <p className="mt-2 text-sm text-slate-600">{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
