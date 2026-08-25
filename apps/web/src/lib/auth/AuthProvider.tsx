import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthUser, Role } from '@fixbridge/shared';
import {
  adminLogin as sessionAdminLogin,
  login as sessionLogin,
  logout as sessionLogout,
  onSessionLost,
  refreshAccessToken,
  requestOtp,
} from './session';

/**
 * Who is signed in, everywhere in this app.
 *
 * Mounted once, in `main.tsx`, above the router — including marketing routes,
 * not just the ones that require a session. The marketing header needs to
 * know "already signed in" to change its own CTA, and the surface switcher
 * (`components/shell/SurfaceSwitcher`) needs it on every route it might
 * render on. Surfaces that actually require a session layer `RequireAuth`/
 * `RequireRole` (`./guards`) on top of this, they do not replace it.
 */

export type AuthStatus = 'restoring' | 'signedOut' | 'signedIn';

export interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  /** Convenience over `user?.roles ?? []` — every guard and nav item reads this. */
  roles: Role[];
  requestOtp: (phone: string) => Promise<{ phone: string; expiresInSeconds: number }>;
  login: (phone: string, otp: string) => Promise<void>;
  /** Sign in an ops/admin user via email and password */
  adminLogin: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('restoring');
  const [user, setUser] = useState<AuthUser | null>(null);

  const handleSessionLost = useCallback(() => {
    setUser(null);
    setStatus('signedOut');
  }, []);

  const login = useCallback(async (phone: string, otp: string) => {
    const session = await sessionLogin(phone, otp);
    setUser(session.user);
    setStatus('signedIn');
  }, []);

  const adminLogin = useCallback(async (email: string, password: string) => {
    const session = await sessionAdminLogin(email, password);
    setUser(session.user);
    setStatus('signedIn');
  }, []);

  const logout = useCallback(async () => {
    await sessionLogout();
    handleSessionLost();
  }, [handleSessionLost]);

  /**
   * Restores a session across a reload.
   *
   * The access token deliberately does not survive a reload (it lives in
   * memory — see `session.ts`), so the refresh token kept in `localStorage`
   * is exchanged once at boot. A failure here — no stored token, an expired
   * one, the API being briefly unreachable — is not an error worth
   * surfacing: it just means the visitor starts signed out, same as anyone
   * else.
   */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const session = await refreshAccessToken();
      if (cancelled) return;

      if (session) {
        setUser(session.user);
        setStatus('signedIn');
      } else {
        setStatus('signedOut');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // api.ts calls this when a refresh fails mid-session (not just at boot) —
  // it cannot import this provider directly without a cycle, so it calls back
  // through session.ts's onSessionLost instead.
  useEffect(() => {
    onSessionLost(handleSessionLost);
  }, [handleSessionLost]);

  const roles = useMemo(() => user?.roles ?? [], [user]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      roles,
      requestOtp,
      login,
      adminLogin,
      logout,
    }),
    [status, user, roles, login, adminLogin, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
