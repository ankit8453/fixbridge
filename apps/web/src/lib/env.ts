/**
 * Split out of `api.ts` / `auth/session.ts` purely to keep those two modules
 * from importing each other (session needs the base URL for its own fetches
 * to the external API's unauthenticated endpoints; the api client needs
 * session's token functions for the 401 retry). A shared leaf module both can
 * import avoids a cycle without duplicating the constant.
 */
export const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

/**
 * The Razorpay checkout key id — a public identifier, safe to ship in the
 * bundle (see `.env.example`). `null` rather than a fake default: a surface
 * that tries to open checkout with no key configured should fail loudly, not
 * silently point at a placeholder that looks like it might work.
 */
export const RAZORPAY_KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID ?? null;
