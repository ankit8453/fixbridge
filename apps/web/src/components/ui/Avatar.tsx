import { useState } from 'react';

/**
 * A circular avatar — a photo when there is one, initials on a brand-tinted
 * background otherwise. Never a broken-image icon: this app's audience is on
 * patchy 4G, where an image failing to load is the common case, not the
 * exception.
 *
 * The photo is a technician's **ops-approved profile photo**, which is a
 * separate thing from the `photo` document in the KYC store — that one is
 * private evidence for a reviewer and is never served to a customer. See
 * `apps/api/src/modules/providers/profile-photo.ts`.
 *
 * `src` is typically a short-lived signed URL, which is exactly why the failure
 * path below is not theoretical: a URL that has expired, or a request that
 * failed on a weak connection, falls back to initials rather than leaving a
 * broken image where a person's face should be.
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
  /**
   * Which `src` failed, rather than a bare "it failed" boolean.
   *
   * A boolean would latch: one expired URL would pin this avatar to initials for
   * as long as it stayed mounted, even after a fresh, working URL arrived on the
   * next refetch — and these URLs are short-lived, so that refetch is routine.
   * Recording the failing URL instead means a new `src` is always given a real
   * attempt, with no effect and no key juggling by the caller.
   */
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const initials = (name ?? '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  if (src && failedSrc !== src) {
    return (
      <img
        src={src}
        alt={name ?? ''}
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
        onError={() => setFailedSrc(src)}
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
