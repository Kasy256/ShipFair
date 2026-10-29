import { type KeyboardEvent, type ReactNode, useEffect, useRef } from 'react';
import { useInputLock } from '../state/use-input-lock.ts';
import { Toasts } from './Toasts.tsx';

interface SheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Id of the heading that names the sheet. */
  labelledBy: string;
  /** `side`: a panel on the right on wide screens. `center`: a centred dialog. */
  variant: 'side' | 'center';
  testId?: string;
  children: ReactNode;
}

// Under 640 px (Tailwind `sm`) every sheet is a bottom sheet: full width, pinned to the bottom.
const BASE =
  'fixed m-0 mt-auto max-h-[88dvh] w-full max-w-none overflow-y-auto overscroll-contain ' +
  'rounded-t-2xl bg-ink-2 p-0 text-paper shadow-2xl backdrop:bg-ink/55';
const WIDE = {
  side: 'sm:my-4 sm:mr-4 sm:ml-auto sm:h-[calc(100dvh-2rem)] sm:max-h-none sm:w-[27rem] sm:rounded-2xl',
  center: 'sm:m-auto sm:max-h-[85dvh] sm:w-[min(92vw,46rem)] sm:rounded-2xl',
} as const;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), ' +
  'select:not([disabled]), [tabindex]:not([tabindex="-1"]), video[controls]';

/**
 * Wraps Tab inside the dialog. A native modal dialog makes the page inert, but Chromium still
 * lets Tab leave for the browser's own UI after the last control.
 */
function trapTab(e: KeyboardEvent<HTMLDialogElement>): void {
  if (e.key !== 'Tab') return;
  const focusable = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === e.currentTarget)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * A modal native <dialog>: it traps focus, closes on Esc, and makes the page behind it inert.
 * While open, the engine's input is off so keys typed here never move the avatar. A click on
 * the backdrop closes it too.
 */
export function Sheet({ isOpen, onClose, labelledBy, variant, testId, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useInputLock(isOpen);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={trapTab}
      aria-labelledby={labelledBy}
      data-testid={testId}
      className={`${BASE} ${WIDE[variant]}`}
    >
      {/* Padding lives here, so only a click on the backdrop itself hits the dialog element. */}
      <div className="min-h-full p-5">{isOpen && children}</div>
      {/* The page behind a modal dialog is inert, so toasts raised from here render here. */}
      {isOpen && <Toasts />}
    </dialog>
  );
}
