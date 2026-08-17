'use client';

/**
 * The true-root fallback for an uncaught error anywhere in the tree —
 * Next's `_error` equivalent for the App Router. Required to be a Client
 * Component with its own `<html>`/`<body>` for the same reason
 * `not-found.tsx` needs them: there is no root layout above `[locale]` to
 * supply a document shell (see that layout for why the locale can't be known
 * any higher up). No locale, no brand copy — this is the one screen that
 * must render even when everything else, including this app's own
 * providers, has failed.
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main style={{ padding: '2rem', textAlign: 'center', fontFamily: 'sans-serif' }}>
          <p>Something went wrong.</p>
          <button type="button" onClick={() => reset()} style={{ marginTop: '1rem' }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
