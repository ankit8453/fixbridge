/**
 * The true-root 404 — sibling to `src/app/[locale]/...`, not inside it.
 *
 * Every real page in this app lives under `[locale]`, whose own layout
 * supplies `<html>`/`<body>` (see that file for why the locale can't be known
 * any higher up the tree). Next still needs to statically generate a
 * fallback `/404` for requests that never resolve to a locale segment at
 * all — and without a file here, that generation crashes at build time
 * (`useContext` on a null React dispatcher) because there is no root layout
 * above `[locale]` to provide the document shell it needs. This file has no
 * locale to render in, so it stays plain English/Hindi-neutral rather than
 * guessing; `[locale]`'s own `not-found.tsx` (added by whichever agent wants
 * a localised one) is what a normal in-app 404 inside a known locale hits.
 */
export default function RootNotFound() {
  return (
    <html lang="en">
      <body>
        <main style={{ padding: '2rem', textAlign: 'center', fontFamily: 'sans-serif' }}>
          <p>Page not found.</p>
        </main>
      </body>
    </html>
  );
}
