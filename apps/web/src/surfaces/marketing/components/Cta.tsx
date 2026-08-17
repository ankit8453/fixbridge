import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

type Variant = 'primary' | 'secondary';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-brand-foreground hover:opacity-90 border-transparent',
  secondary: 'bg-white text-slate-900 hover:bg-slate-50 border-slate-300',
};

/**
 * A `<Link>` styled like `components/ui/Button`'s primary/secondary variants
 * — ported from `legacy-next-src/components/marketing/Cta.tsx`. Not a
 * re-export of `Button` itself: every call site here is a navigation (book
 * now, become a partner, ...), and a `<button>` with no `type="submit"`
 * inside no `<form>` is the wrong element for "go to this URL".
 */
export function CtaLink({
  href,
  variant = 'primary',
  children,
}: {
  href: string;
  variant?: Variant;
  children: ReactNode;
}) {
  return (
    <Link
      to={href}
      className={`inline-flex min-h-touch items-center justify-center rounded-lg border px-5 py-3 text-base font-semibold transition-colors ${VARIANTS[variant]}`}
    >
      {children}
    </Link>
  );
}
