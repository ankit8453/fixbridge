/**
 * A circular avatar — a photo when there is one (verified providers get a
 * profile photo through the KYC flow), initials on a brand-tinted
 * background otherwise. Never a broken-image icon: this app's audience is on
 * patchy 4G, where an image failing to load is the common case, not the
 * exception.
 */
export function Avatar({
  name,
  src,
  size = 40,
}: {
  name?: string | null;
  src?: string | null;
  size?: number;
}) {
  const initials = (name ?? '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  if (src) {
    return (
      <img
        src={src}
        alt={name ?? ''}
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      role="img"
      aria-label={name ?? 'avatar'}
      // A flat slate tint rather than a `brand/10` opacity modifier — this
      // colour comes from a CSS custom property (see brand/tokens.ts), and
      // Tailwind's opacity modifiers cannot reliably derive an alpha variant
      // from a var() at build time.
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-slate-100 font-semibold text-brand"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials || '?'}
    </span>
  );
}
