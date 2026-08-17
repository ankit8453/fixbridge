import { cookies } from 'next/headers';
import { REFRESH_COOKIE_NAME } from './cookie';

/**
 * A cheap, server-side "is there any session at all" check for layouts.
 *
 * This is NOT authorization. It only knows the httpOnly refresh cookie is
 * present — never who the user is or which roles they hold, because both of
 * those live inside the access token, which this server process never sees
 * (see `session.ts`). Its only job is to skip shipping a protected layout's
 * client JavaScript to a request that is, with certainty, signed out — a
 * `redirect()` here for a bookmarked/shared link with no cookie at all saves
 * the round trip `RequireAuth` would otherwise spend discovering the same
 * thing client-side. A request that DOES have the cookie still goes through
 * `RequireAuth`/`RequireRole` (`./guards`) once mounted, because the cookie
 * only proves *a* session exists, not whose or with which roles.
 */
export async function hasSessionCookie(): Promise<boolean> {
  const store = await cookies();
  return store.has(REFRESH_COOKIE_NAME);
}
