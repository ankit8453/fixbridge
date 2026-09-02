/**
 * Types for `paytmchecksum`, which ships none of its own.
 *
 * Hand-written against the package's source rather than guessed: `verify` is
 * synchronous and `generate` is not, which is easy to get backwards and which
 * the interface in `payments/gateway/types.ts` depends on — a `Promise<boolean>`
 * treated as a boolean is always truthy, so a wrong type here would make every
 * signature check pass.
 *
 * The package is a single dependency-free file wrapping Node's own crypto
 * (SHA-256 + AES-128-CBC). It has not been published since 2023, which for a
 * fixed algorithm with no dependencies is staleness rather than rot — and it is
 * what Paytm's own documentation tells merchants to use, so it is also what
 * their support will expect to see.
 */
declare module 'paytmchecksum' {
  export default class PaytmChecksum {
    /** Signs a JSON string. Asynchronous — it generates a random salt. */
    static generateSignature(params: string | object, key: string): Promise<string>;

    /** Verifies a JSON string against a checksum. Synchronous. */
    static verifySignature(params: string | object, key: string, checksum: string): boolean;
  }
}
