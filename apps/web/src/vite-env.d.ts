/// <reference types="vite/client" />

/**
 * Every `VITE_*` variable this app actually reads, typed as optional string —
 * Vite inlines these at build time and leaves an unset one `undefined` at
 * runtime, never throws, so the type has to admit that rather than lying
 * about a guarantee `.env.example` alone cannot enforce.
 */
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_RAZORPAY_KEY_ID?: string;
  readonly VITE_APP_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
