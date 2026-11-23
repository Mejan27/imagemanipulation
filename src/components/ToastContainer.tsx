import { X } from 'lucide-react';
import type { ToastMessage, ToastType } from '../types/converter';

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

const TOAST_STYLES: Record<ToastType, string> = {
  success: 'bg-emerald-600 text-white border-emerald-500',
  error: 'bg-rose-600 text-white border-rose-500',
  warning: 'bg-amber-600 text-white border-amber-500',
  info: 'bg-slate-800 dark:bg-[#1c263b] text-white border-slate-700 dark:border-[#2a3752]',
};

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (!toasts.length) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-4 sm:px-0"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={`pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 rounded-xl border shadow-lg text-xs font-semibold transition-all duration-150 ${TOAST_STYLES[toast.type]}`}
        >
          <span className="leading-snug">{toast.message}</span>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss notification"
            className="p-1 rounded-md opacity-80 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-white shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
