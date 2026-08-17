import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle, X } from 'lucide-react';
import type { Tone } from './Badge';

/**
 * A minimal toast stack. One provider, mounted once (`main.tsx`) above the
 * router, so any surface can call `useToast()` without threading a prop
 * through every layout. Auto-dismisses on a timer; also closable by hand,
 * because a slow 4G connection can mean a toast's subject (an upload, a
 * payment callback) is still relevant well past the default duration.
 */
export interface ToastOptions {
  title: string;
  description?: string;
  tone?: Tone;
  durationMs?: number;
}

interface ToastRecord extends Required<Pick<ToastOptions, 'title' | 'tone' | 'durationMs'>> {
  id: string;
  description?: string;
}

interface ToastContextValue {
  show: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_ICON: Record<Tone, typeof Info> = {
  neutral: Info,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
};

// Literal strings for Tailwind's scanner — see Card.tsx's StatTile for why
// this cannot be a `text-${tone}`-style template instead.
const TONE_ICON_CLASS: Record<Tone, string> = {
  neutral: 'text-slate-500',
  info: 'text-blue-600',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (options: ToastOptions) => {
      const id = crypto.randomUUID();
      const durationMs = options.durationMs ?? 5000;
      setToasts((current) => [
        ...current,
        {
          id,
          title: options.title,
          description: options.description,
          tone: options.tone ?? 'neutral',
          durationMs,
        },
      ]);
      window.setTimeout(() => dismiss(id), durationMs);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Bottom-centre: reachable by thumb on a phone, unobtrusive on desktop.
          `aria-live="polite"` announces new toasts without interrupting
          whatever the screen reader is already reading. */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((toast) => {
          const Icon = TONE_ICON[toast.tone];
          return (
            <div
              key={toast.id}
              role="status"
              className="pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 shadow-md"
            >
              <Icon
                className={`mt-0.5 h-4 w-4 shrink-0 ${TONE_ICON_CLASS[toast.tone]}`}
                aria-hidden="true"
                strokeWidth={2}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">{toast.title}</p>
                {toast.description ? (
                  <p className="mt-0.5 text-sm text-muted">{toast.description}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss"
                className="inline-flex min-h-[28px] min-w-[28px] shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside <ToastProvider>');
  return value;
}
