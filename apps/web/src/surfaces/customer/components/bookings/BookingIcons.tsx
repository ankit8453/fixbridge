/**
 * Drawn icons for the booking surface, same rules as
 * `components/find/CategoryIcon.tsx`: stroke-only SVG on a 24px grid,
 * `currentColor` throughout so each caller tints its own, `aria-hidden`
 * because in every place these are used the meaning is already carried by
 * adjacent text.
 *
 * Written here rather than pulled from lucide because these are the shapes
 * lucide does not have — a booking's five states, a door handshake, a rupee
 * receipt. The five status glyphs in particular have to read as one
 * progression at 18px on a cheap phone, which a set assembled from unrelated
 * stock icons never does.
 */

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function Svg({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** An hourglass — sent, waiting on somebody else. */
export function IconWaiting({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M7 3.5h10M7 20.5h10" {...STROKE} />
      <path d="M8 3.5v3.2c0 1.4 1 2.4 4 5.3 3-2.9 4-3.9 4-5.3V3.5" {...STROKE} />
      <path d="M8 20.5v-3.2c0-1.4 1-2.4 4-5.3 3 2.9 4 3.9 4 5.3v3.2" {...STROKE} />
    </Svg>
  );
}

/** A tick inside a circle — somebody said yes. */
export function IconAccepted({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="8.5" {...STROKE} />
      <path d="m8.4 12.2 2.4 2.4 4.8-4.9" {...STROKE} />
    </Svg>
  );
}

/** A van in motion — on the way. */
export function IconEnRoute({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M3.5 16.5V8.2A1.2 1.2 0 0 1 4.7 7h7.6v9.5" {...STROKE} />
      <path d="M12.3 10h3.4l2.8 3.1v3.4" {...STROKE} />
      <circle cx="7.6" cy="17.6" r="1.7" {...STROKE} />
      <circle cx="16.4" cy="17.6" r="1.7" {...STROKE} />
      <path d="M9.3 17.6h5.4M3.5 16.5h.9M18.5 16.5h2" {...STROKE} />
    </Svg>
  );
}

/** A map pin with a hard dot — standing at the door. */
export function IconArrived({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <Svg className={className}>
      <path
        d="M12 21c3.7-4.2 5.6-7.2 5.6-9.6A5.6 5.6 0 0 0 6.4 11.4c0 2.4 1.9 5.4 5.6 9.6Z"
        {...STROKE}
      />
      <circle cx="12" cy="11.2" r="2.1" {...STROKE} />
    </Svg>
  );
}

/** A spanner turning — work actually happening. */
export function IconInProgress({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <Svg className={className}>
      <path
        d="M15.6 4.6a4.2 4.2 0 0 0-5.3 5.3L4.8 15.4a2 2 0 0 0 2.8 2.8l5.5-5.5a4.2 4.2 0 0 0 5.3-5.3l-2.4 2.4-2.3-.6-.6-2.3z"
        {...STROKE}
      />
    </Svg>
  );
}

/** A clipboard with a tick — the job is closed out. */
export function IconDone({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <Svg className={className}>
      <path
        d="M9 4.5H7.2A1.7 1.7 0 0 0 5.5 6.2v13.1a1.7 1.7 0 0 0 1.7 1.7h9.6a1.7 1.7 0 0 0 1.7-1.7V6.2A1.7 1.7 0 0 0 16.8 4.5H15"
        {...STROKE}
      />
      <rect x="9" y="2.8" width="6" height="3.4" rx="1.2" {...STROKE} />
      <path d="m8.8 13.4 2.2 2.2 4.2-4.3" {...STROKE} />
    </Svg>
  );
}

/** A circle with a slash — cancelled, expired, declined. */
export function IconStopped({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="8.5" {...STROKE} />
      <path d="m6.9 6.9 10.2 10.2" {...STROKE} />
    </Svg>
  );
}

/**
 * A door ajar with a key — the handshake this product is built around.
 * Used at the top of the OTP panel, the one moment where a stranger is
 * standing outside and the code is the proof.
 */
export function IconHandshake({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M4.5 20.5h9V3.5l-9 2.2v14.8Z" {...STROKE} />
      <circle cx="11" cy="12.4" r=".9" fill="currentColor" stroke="none" />
      <path d="M13.5 8.5h4.2a1.8 1.8 0 0 1 1.8 1.8v10.2" {...STROKE} />
      <path d="M16.5 14.2h3" {...STROKE} />
    </Svg>
  );
}

/** A rupee note — the money panels. */
export function IconRupee({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <Svg className={className}>
      <rect x="2.8" y="5.5" width="18.4" height="13" rx="2.2" {...STROKE} />
      <path d="M9.4 9.2h5.2M9.4 11.4h5.2M13 9.2a2.2 2.2 0 0 1 0 4.4H9.4l4 4" {...STROKE} />
    </Svg>
  );
}

/** A speech bubble with an exclamation — a complaint. */
export function IconComplaint({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <Svg className={className}>
      <path
        d="M20.5 12.8c0 3.6-3.4 6.4-7.6 6.4a9.4 9.4 0 0 1-2.5-.3L5.2 20.5l1-3.3a6 6 0 0 1-2.7-4.9c0-3.5 3.4-6.4 7.6-6.4h1.4c4.2 0 8 2.9 8 6.9Z"
        {...STROKE}
      />
      <path d="M12 9.6v3.1" {...STROKE} />
      <circle cx="12" cy="15.2" r=".85" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** A bell — notifications. */
export function IconBellDrawn({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M6.2 16.8V11a5.8 5.8 0 0 1 11.6 0v5.8l1.6 2H4.6l1.6-2Z" {...STROKE} />
      <path d="M10.2 21.2a2 2 0 0 0 3.6 0" {...STROKE} />
      <path d="M12 5.2V3.4" {...STROKE} />
    </Svg>
  );
}

/** A house with a pin dot — a saved address. */
export function IconAddress({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <Svg className={className}>
      <path
        d="M4 10.4 12 4l8 6.4v9a1.4 1.4 0 0 1-1.4 1.4H5.4A1.4 1.4 0 0 1 4 19.4v-9Z"
        {...STROKE}
      />
      <path d="M9.6 20.8v-5.4h4.8v5.4" {...STROKE} />
    </Svg>
  );
}

/** A person in a circle — the account screen. */
export function IconPerson({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="9" r="3.4" {...STROKE} />
      <path d="M5.6 20a6.6 6.6 0 0 1 12.8 0" {...STROKE} />
    </Svg>
  );
}

/** A price tag — the quote panel. */
export function IconTag({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <Svg className={className}>
      <path
        d="M11.3 3.5H4.9a1.4 1.4 0 0 0-1.4 1.4v6.4a1.4 1.4 0 0 0 .4 1l8.3 8.3a1.4 1.4 0 0 0 2 0l6.4-6.4a1.4 1.4 0 0 0 0-2l-8.3-8.3a1.4 1.4 0 0 0-1-.4Z"
        {...STROKE}
      />
      <circle cx="7.9" cy="7.9" r="1.3" {...STROKE} />
    </Svg>
  );
}

/**
 * The status glyph for a booking, by status string.
 *
 * Tolerant of an unknown status for the same reason `statusTheme` is — a new
 * server status should render plainly, not crash the list.
 */
export function BookingStatusIcon({
  status,
  className = 'h-5 w-5',
}: {
  status: string;
  className?: string;
}) {
  switch (status) {
    case 'REQUESTED':
      return <IconWaiting className={className} />;
    case 'ACCEPTED':
      return <IconAccepted className={className} />;
    case 'EN_ROUTE':
      return <IconEnRoute className={className} />;
    case 'ARRIVED':
      return <IconArrived className={className} />;
    case 'IN_PROGRESS':
      return <IconInProgress className={className} />;
    case 'WORK_DONE':
      return <IconDone className={className} />;
    default:
      return <IconStopped className={className} />;
  }
}
