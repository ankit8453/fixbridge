import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Hand-rolled UI primitives — no component library. A handful of widgets for
 * a system with its own opinions beats a dependency with somebody else's,
 * and the four surface teams building on top of this need one small,
 * consistent vocabulary rather than a generic kit's hundred props. Every
 * interactive control in this file enforces a 44px touch target and 16px+
 * text — below 16px, iOS Safari zooms the whole page on focus, which is
 * worse than a slightly bigger button, and the primary audience is a
 * ₹8,000 Android phone, not a desktop.
 */

type Variant = 'primary' | 'shop' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  /** The partner and marketing surfaces' indigo. */
  primary: 'bg-brand text-brand-foreground hover:opacity-90 border-transparent',
  /**
   * The customer storefront's plum.
   *
   * A separate variant rather than a token swap because all three surfaces
   * share this kit: the ops console is teal, the partner app indigo, and the
   * customer app plum. A button that picked one of them globally would be
   * wrong on two surfaces out of three.
   */
  shop: 'bg-shop text-shop-foreground hover:bg-shop-deep border-transparent',
  secondary: 'bg-white text-slate-900 hover:bg-slate-50 border-slate-300',
  danger: 'bg-danger text-danger-foreground hover:opacity-90 border-transparent',
  ghost: 'bg-transparent text-slate-700 hover:bg-slate-100 border-transparent',
};

// Padding/text scale up together; min-height never drops below the 44px
// touch floor regardless of size, so `sm` saves horizontal space (dense
// admin toolbars) without ever shrinking the tappable target on a phone.
const SIZES: Record<Size, string> = {
  sm: 'min-h-touch px-3 py-1.5 text-sm gap-1.5',
  md: 'min-h-touch px-4 py-2.5 text-base gap-2',
  lg: 'min-h-[52px] px-5 py-3 text-base gap-2',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Full-width is the common case on a phone-width screen; opt out per call site. */
  fullWidth?: boolean;
  /** Shows a spinner in place of the leading edge and disables the button — a mutation's `isPending`. */
  loading?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  loading = false,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      // Buttons default to `submit` inside a form, turning an unrelated
      // "cancel" into a submission. Every button here is explicit instead.
      type={rest.type ?? 'button'}
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center rounded-lg border font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" strokeWidth={2.5} />
      ) : null}
      {children}
    </button>
  );
}
