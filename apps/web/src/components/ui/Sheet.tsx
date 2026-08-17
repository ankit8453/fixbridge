import { useEffect, type ReactNode } from 'react';

/**
 * A bottom sheet, full stop — unlike `Modal`, this never becomes a centred
 * desktop dialog. For the partner/customer surfaces' one-thumb mobile flows
 * (pick a reason code, confirm cash collected, choose a slot) a sheet
 * sliding up from the thumb's natural resting position reads as "closer to
 * the action" than a dialog materialising in the middle of the screen — and
 * staying bottom-anchored even on a wide viewport keeps that one flow
 * consistent instead of behaving differently by breakpoint.
 *
 * `open` controls mount/unmount rather than a CSS-only show/hide so a sheet
 * with form state resets cleanly every time it reopens.
 */
export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-slate-900/40">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[85vh] w-full animate-[sheet-in_150ms_ease-out] overflow-y-auto rounded-t-2xl border border-border bg-surface shadow-lg"
      >
        {/* A short drag-handle affordance, decorative only — there is no
            drag-to-dismiss gesture in v1, and this must not be announced as
            an interactive element. */}
        <div className="flex justify-center pt-2" aria-hidden="true">
          <div className="h-1 w-10 rounded-full bg-slate-300" />
        </div>
        <header className="px-4 pb-3 pt-2">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        </header>
        {children}
      </div>
    </div>
  );
}
