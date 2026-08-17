'use client';

import { useEffect, type ReactNode } from 'react';

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
      {/* Bottom sheet on a phone-width screen (items-end, full width, rounded
          top corners only), a centred dialog from `sm:` up. No click-outside-
          to-close: a form filled in on a slow connection is easy to lose to a
          mistimed tap on the backdrop, and every dialog here has an explicit
          close/cancel control. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`max-h-[90vh] w-full ${width} overflow-y-auto rounded-t-2xl border border-slate-300 bg-white shadow-lg sm:rounded-2xl`}
      >
        <header className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        </header>
        {children}
      </div>
    </div>
  );
}
