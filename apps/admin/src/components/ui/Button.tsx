import { type ButtonHTMLAttributes, type ReactNode } from 'react';

/**
 * Hand-rolled UI primitives, and why there is no component library here.
 *
 * This console has about ten distinct widgets and one audience — our own ops
 * team, on a laptop or a tablet in one office. A design system would add a
 * dependency with its own upgrade cycle, its own theming model and its own
 * opinions about forms, in exchange for components we would immediately
 * constrain to one look. When the customer web app arrives in Phase 12 it will
 * make its own choice for its own reasons; nothing here should pre-empt that.
 *
 * The rule that keeps this honest: if a primitive here grows a third variant
 * that only one screen uses, it belongs on that screen instead.
 */

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-slate-900 text-white hover:bg-slate-700 border-slate-900',
  secondary: 'bg-white text-slate-900 hover:bg-slate-100 border-slate-300',
  // Destructive and money actions are red before the dialog, not only inside it.
  danger: 'bg-red-600 text-white hover:bg-red-700 border-red-600',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 border-transparent',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

export function Button({ variant = 'secondary', className = '', ...rest }: ButtonProps) {
  return (
    <button
      // Buttons default to `submit` inside a form, which turns an unrelated
      // "cancel" into a submission. Every button here is explicit instead.
      type={rest.type ?? 'button'}
      {...rest}
      className={`inline-flex items-center justify-center rounded border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
    />
  );
}
