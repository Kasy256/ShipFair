import { useUiStore } from '../state/ui-store.ts';

/** Short confirmations ("Link copied"). A polite live region, so screen readers hear them. */
export function Toasts() {
  const toasts = useUiStore((s) => s.toasts);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-36 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-24"
    >
      {toasts.map((toast) => (
        <p
          key={toast.id}
          className="animate-toast rounded-full bg-paper px-4 py-2 font-semibold text-ink text-sm shadow-lg motion-reduce:animate-none"
        >
          {toast.text}
        </p>
      ))}
    </div>
  );
}
