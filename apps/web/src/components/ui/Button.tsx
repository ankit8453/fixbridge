import { type ButtonHTMLAttributes, type ReactNode } from 'react';

/**
 * Hand-rolled UI primitives — no component library, same call admin's UI kit
 * makes and for the same reason (see apps/admin/src/components/ui/Button.tsx):
 * a handful of widgets for a system with its own opinions beats a dependency
 * with somebody else's. The difference here is the audience — a ₹8,000
 * Android phone, not an ops laptop — which is why every interactive control
 * in this file enforces a 44px touch target and 16px+ text (below 16px, iOS
 * Safari zooms the whole page on focus, which is worse than a slightly bigger
 * button).
 *
 * No `'use client'` directive: this component has no hooks, so it renders
 * fine from a Server Component and is bundled for the client automatically
 * when a Client Component imports it and passes an `onClick`.
 */

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-brand-foreground hover:opacity-90 border-transparent',
  secondary: 'bg-white text-slate-900 hover:bg-slate-50 border-slate-300',
  danger: 'bg-red-600 text-white hover:bg-red-700 border-red-600',
  ghost: 'bg-transparent text-slate-700 hover:bg-slate-100 border-transparent',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Full-width is the common case on a phone-width screen; opt out per call site. */
  fullWidth?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'secondary',
  fullWidth = false,
  className = '',
  ...rest
}: ButtonProps) {
  return (
    <button
      // Buttons default to `submit` inside a form, turning an unrelated
      // "cancel" into a submission. Every button here is explicit instead.
      type={rest.type ?? 'button'}
      {...rest}
      className={`inline-flex min-h-touch items-center justify-center rounded-lg border px-4 py-2.5 text-base font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${fullWidth ? 'w-full' : ''} ${className}`}
    />
  );
}
