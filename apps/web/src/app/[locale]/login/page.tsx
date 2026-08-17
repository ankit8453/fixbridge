import type { Metadata } from 'next';
import { LoginScreen } from '@/components/customer/auth/LoginScreen';

/**
 * Shared sign-in entry point.
 *
 * Not under `[locale]/app/**` because it has to be reachable while signed
 * out — every guarded layout (`app`, `partner`, `admin`) redirects here by
 * default (`RequireAuth`/`RequireRole`'s `redirectTo` in
 * `src/lib/auth/guards.tsx`). It lives at the top level rather than inside
 * any one surface's owned tree for the same reason `(marketing)` and `app`
 * are siblings, not nested: phone+OTP authentication is not customer-specific
 * (a technician signs in through the exact same screen), so it cannot live
 * inside `components/customer` conceptually — only the screen's
 * implementation does, since surface B is the one being built this pass and
 * the phase spec assigns "login/onboarding" to it explicitly (§B.1).
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function LoginPage() {
  return <LoginScreen />;
}
