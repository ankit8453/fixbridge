/**
 * Split out of `api.ts` / `auth/session.ts` purely to keep those two modules
 * from importing each other (session needs the base URL for its own fetches
 * to the external API's unauthenticated endpoints; the api client needs
 * session's token functions for the 401 retry). A shared leaf module both can
 * import avoids a cycle without duplicating the constant.
 */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
