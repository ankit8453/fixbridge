/**
 * Renders one `<script type="application/ld+json">` block.
 *
 * `dangerouslySetInnerHTML` is genuinely safe here: `data` always comes from
 * `components/marketing/seo.ts`'s builders, which only ever assemble it from
 * category names and prices the API itself returned (already HTML-safe JSON
 * values, never raw markup) — there is no user-typed string on this path for
 * `JSON.stringify` to need escaping against.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
  );
}
