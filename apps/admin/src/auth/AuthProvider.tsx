import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { logoutSession } from '../api/endpoints';
import type { AuthSession, SessionUser } from '../api/types';
import {
  apiRequest,
  clearSession,
  getDeviceId,
  getRefreshToken,
  onSessionLost,
  setAccessToken,
  setRefreshToken,
} from '../lib/api';

/**
 * Who is signed in, and whether they are allowed to be here.
 *
 * The role gate is the reason this file exists rather than a `useState` in the
 * login page. A customer or a technician holds a perfectly valid token for this
 * API; nothing stops them completing the same OTP login against this origin. The
 * server refuses every `/admin` route for them with a `403`, so the danger is
 * not access — it is a console full of red error states that reads like an
 * outage. Refusing at the door, in words, is the honest answer.
 */

export const OPS_ROLES = ['ops', 'admin'] as const;

export const hasOpsAccess = (roles: readonly string[] | undefined): boolean =>
  (roles ?? []).some((role) => (OPS_ROLES as readonly string[]).includes(role));

export interface AuthState {
  status: 'restoring' | 'signedOut' | 'signedIn';
  user: SessionUser | null;
  /** Why the last sign-in attempt was refused. Survives the redirect to /login. */
  refusal: string | null;
  adopt: (session: AuthSession) => void;
  signOut: () => void;
  clearRefusal: () => void;
}

export const AuthContext = createContext<AuthState | null>(null);

const NOT_OPS_MESSAGE =
  'This console is for the operations team. Your account does not have the ops or admin role, so you have been signed out. If you are a customer or a technician, use the app instead.';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState['status']>('restoring');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const signOut = useCallback(() => {
    const token = getRefreshToken();

    clearSession();
    setUser(null);
    setStatus('signedOut');

    // Best-effort revocation. The local session is already gone either way —
    // failing to reach the API must never leave somebody stuck signed in.
    if (token) void logoutSession(token).catch(() => undefined);
  }, []);

  const adopt = useCallback(
    (session: AuthSession) => {
      if (!hasOpsAccess(session.user.roles)) {
        /**
         * Refused at the door, and signed out properly.
         *
         * Keeping the tokens would leave a customer's live session sitting in
         * this origin's storage for the next 30 days for no reason at all.
         */
        setRefusal(NOT_OPS_MESSAGE);
        setAccessToken(session.accessToken);
        setRefreshToken(session.refreshToken);
        signOut();
        return;
      }

      setAccessToken(session.accessToken);
      setRefreshToken(session.refreshToken);
      setUser(session.user);
      setRefusal(null);
      setStatus('signedIn');
    },
    [signOut],
  );

  /**
   * Restores a session across a reload.
   *
   * The access token deliberately does not survive a refresh of the page (it
   * lives in memory — see lib/api.ts), so the refresh token is exchanged once at
   * boot. A failure here is not an error worth showing: it means the token
   * expired or was rotated away, and the answer is simply the login screen.
   */
  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      const refreshToken = getRefreshToken();

      if (!refreshToken) {
        setStatus('signedOut');
        return;
      }

      try {
        const session = await apiRequest<AuthSession>('/api/v1/auth/refresh', {
          method: 'POST',
          body: { refreshToken, deviceId: getDeviceId() },
          skipAuth: true,
        });

        if (cancelled) return;
        adopt(session);
      } catch {
        if (cancelled) return;
        clearSession();
        setStatus('signedOut');
      }
    };

    void restore();
    return () => {
      cancelled = true;
    };
  }, [adopt]);

  // The API client cannot import this provider without a cycle, so it calls back
  // instead: a refresh that fails mid-session lands the user on /login rather
  // than on a screen quietly full of 401s.
  useEffect(() => {
    onSessionLost(() => {
      setUser(null);
      setStatus('signedOut');
    });
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      refusal,
      adopt,
      signOut,
      clearRefusal: () => setRefusal(null),
    }),
    [status, user, refusal, adopt, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
