/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where the API lives. Inlined at build time — see .env.example. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
