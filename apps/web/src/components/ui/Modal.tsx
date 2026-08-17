import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * A centred dialog on `sm:` and up, a full-width bottom sheet below it — the
 * one shape most confirm/edit dialogs need. For a mobile-only action sheet
 * that should never become a centred dialog even on a wide viewport (a
 * partner's "cash collected?" confirmation, say), reach for `Sheet` instead.
 *
 * No click-outside-to-close: a form filled in on a slow connection is easy
 * to lose to a mistimed tap on the backdrop, and every dialog here has an
 * explicit close/cancel control.
 */
export function Modal({
  title,
  onClose,
  children,
  width = 'max-w-lg',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`max-h-[90vh] w-full ${width} overflow-y-auto rounded-t-2xl border border-border bg-surface shadow-lg sm:rounded-2xl`}
      >
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
          >
            <X className="h-5 w-5" aria-hidden="true" strokeWidth={1.75} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
