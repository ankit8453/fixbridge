/**
 * Spot illustrations for the homepage's story sections — same drawn language
 * as `HeroScene`: stroke shapes on soft colour blobs, brand indigo + amber,
 * no text baked into the artwork (the page's copy is localised; the drawings
 * must not be). All decorative — every root carries `aria-hidden`.
 */

const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** A phone showing a quotation: line items, a locked total, an approve tap. */
export function QuoteLockScene({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 420 360" fill="none" className={className} aria-hidden="true">
      <circle cx="210" cy="185" r="150" className="fill-brand-soft" opacity="0.8" />
      <circle cx="352" cy="80" r="42" className="fill-amber-100" />

      {/* Phone body */}
      <rect
        x="130"
        y="30"
        width="160"
        height="300"
        rx="24"
        className="fill-white stroke-slate-300"
        strokeWidth="3"
      />
      <rect x="185" y="44" width="50" height="8" rx="4" className="fill-slate-200" />

      {/* Quotation sheet */}
      <rect x="150" y="70" width="120" height="26" rx="8" className="fill-brand" />
      <rect x="160" y="79" width="56" height="8" rx="4" className="fill-white" opacity="0.85" />

      {/* Line items: label bar + amount bar */}
      {[112, 140, 168].map((y, i) => (
        <g key={y}>
          <rect
            x="152"
            y={y}
            width={i === 2 ? 44 : 62}
            height="9"
            rx="4.5"
            className="fill-slate-200"
          />
          <rect x="236" y={y} width="32" height="9" rx="4.5" className="fill-slate-300" />
        </g>
      ))}
      <path d="M152 196h116" className="stroke-slate-200" strokeWidth="2.5" strokeDasharray="4 6" />

      {/* Locked total row */}
      <rect x="150" y="208" width="120" height="34" rx="10" className="fill-brand-soft" />
      <rect x="162" y="220" width="40" height="10" rx="5" className="fill-brand" opacity="0.55" />
      <rect x="226" y="218" width="34" height="14" rx="7" className="fill-brand" />

      {/* Approve button */}
      <rect x="150" y="256" width="120" height="34" rx="17" className="fill-emerald-500" />
      <path d="m200 273 6.5 6.5L219 267" {...S} strokeWidth="4" className="stroke-white" />

      {/* Lock badge overlapping the phone */}
      <g>
        <circle cx="296" cy="212" r="34" className="fill-amber-400" />
        <rect x="282" y="208" width="28" height="22" rx="6" className="fill-white" />
        <path d="M288 208v-5a8 8 0 0 1 16 0v5" {...S} strokeWidth="4" className="stroke-white" />
        <circle cx="296" cy="218" r="3.4" className="fill-amber-500" />
      </g>

      {/* Rupee coin */}
      <g>
        <circle cx="118" cy="120" r="26" className="fill-white stroke-brand" strokeWidth="3" />
        <path
          d="M109 110h18M109 117h18M113 110c6 0 9 3 9 6.5S119 123 113 123l11 11"
          {...S}
          strokeWidth="3"
          className="stroke-brand"
        />
      </g>
    </svg>
  );
}

/** A phone running the app, with a WhatsApp-style update bubble beside it. */
export function AppPhoneScene({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 360 380" fill="none" className={className} aria-hidden="true">
      <circle cx="180" cy="196" r="140" className="fill-brand-soft" opacity="0.8" />

      {/* Phone */}
      <rect
        x="108"
        y="40"
        width="150"
        height="300"
        rx="26"
        className="fill-white stroke-slate-300"
        strokeWidth="3"
      />
      <rect x="158" y="54" width="50" height="8" rx="4" className="fill-slate-200" />
      <rect x="124" y="78" width="118" height="30" rx="10" className="fill-brand" />
      <rect x="134" y="88" width="52" height="9" rx="4.5" className="fill-white" opacity="0.85" />

      {/* Category tiles */}
      {[0, 1].map((row) =>
        [0, 1].map((col) => (
          <g key={`t${row}${col}`}>
            <rect
              x={124 + col * 62}
              y={122 + row * 58}
              width="56"
              height="48"
              rx="12"
              className="fill-slate-50 stroke-slate-200"
              strokeWidth="2"
            />
            <circle
              cx={140 + col * 62}
              cy={140 + row * 58}
              r="8"
              className={
                ['fill-amber-300', 'fill-sky-300', 'fill-violet-300', 'fill-emerald-300'][
                  row * 2 + col
                ]
              }
            />
            <rect
              x={128 + col * 62}
              y={154 + row * 58}
              width="34"
              height="7"
              rx="3.5"
              className="fill-slate-200"
            />
          </g>
        )),
      )}

      {/* Book bar */}
      <rect x="124" y="246" width="118" height="34" rx="17" className="fill-brand" />
      <rect x="156" y="259" width="54" height="9" rx="4.5" className="fill-white" opacity="0.9" />

      {/* Chat bubble — booking update */}
      <g>
        <path
          d="M244 300h84a14 14 0 0 0 14-14v-40a14 14 0 0 0-14-14h-56a14 14 0 0 0-14 14v40l-14 14z"
          className="fill-emerald-500"
        />
        <rect x="272" y="246" width="58" height="8" rx="4" className="fill-white" opacity="0.85" />
        <rect x="272" y="262" width="42" height="8" rx="4" className="fill-white" opacity="0.6" />
        <path d="m300 280 5 5 10-10" {...S} strokeWidth="3.5" className="stroke-white" />
      </g>

      {/* Signal dots from phone to bubble */}
      <path
        d="M262 218c14 6 22 14 26 26"
        {...S}
        strokeWidth="3"
        strokeDasharray="2 8"
        className="stroke-emerald-500"
      />
    </svg>
  );
}
