// components/Toaster.tsx
// App-wide transient notifications.
//
// WHEN TO USE THIS, AND WHEN NOT TO — the distinction matters, because a
// toast is the wrong tool about half the time:
//
//   Inline (the red `role="alert"` box every form already has) stays for
//   errors tied to a form the user is looking at. They need to see the
//   message next to the thing that failed, and it needs to persist while
//   they fix it. A validation error that fades after eight seconds is a
//   worse experience, not a more polished one.
//
//   Toast is for the two cases the app previously had no surface for at all:
//   (a) success confirmations — saving settings used to say "Saved." in grey
//   next to a button at the bottom of a long page, which nobody sees; and
//   (b) failures of background work the user didn't explicitly trigger —
//   autosave, silent regeneration — where there is no submit button in focus
//   and no inline slot anywhere near their eye.
//
// Hand-rolled rather than `sonner` (which Next's own interactive-apps guide
// reaches for). Four call sites don't justify a dependency in a repo where
// the dependency-audit surface is an open issue, and the whole visual
// language here is --color-* tokens that a third-party toast would need
// overriding anyway.
//
// Accessibility notes, since this is the kind of component where it's easy to
// ship something that looks right and is unusable:
//   - Each toast carries its own role (`status` for polite, `alert` for
//     assertive) rather than the container being one big live region. Nested
//     live regions announce unpredictably; per-element roles announce on
//     insert, which is exactly the behaviour wanted.
//   - Auto-dismiss pauses on hover AND on focus-within. A timed message that
//     can't be paused fails WCAG 2.2.1, and more practically: a screen-reader
//     or keyboard user tabbing toward the dismiss button should not have the
//     target disappear from under them.
//   - Errors get twice the dwell time of successes. "Saved." is confirmable
//     at a glance; "Couldn't reach the server (ref a1b2c3)" is something you
//     might need to write down.

"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type ToastTone = "success" | "error";

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** How long each tone stays up, absent hover/focus. */
const DWELL_MS: Record<ToastTone, number> = { success: 4000, error: 8000 };

/**
 * Most toasts on screen at once. Beyond this the oldest is dropped: a column
 * of nine stacked failures is less readable than the three most recent, and
 * on a phone it would cover the page.
 */
const MAX_VISIBLE = 3;

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) {
    throw new Error("useToast must be used inside <ToastProvider> (mounted in app/layout.tsx)");
  }
  return api;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((tone: ToastTone, message: string) => {
    setToasts((prev) => {
      // Deduplicate by message. A failing autosave retries on every
      // keystroke-debounce, and without this the same sentence stacks up
      // four deep. Re-adding under a new id restarts the dwell timer, which
      // is the behaviour wanted anyway: the problem is still happening.
      const deduped = prev.filter((t) => !(t.tone === tone && t.message === message));
      const next = [...deduped, { id: nextId.current++, tone, message }];
      return next.slice(-MAX_VISIBLE);
    });
  }, []);

  // Stable across renders so consumers can safely list `toast` in effect
  // dependency arrays without re-firing.
  const api = useMemo<ToastApi>(
    () => ({
      success: (message: string) => push("success", message),
      error: (message: string) => push("error", message),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Fixed, above page content, and pointer-transparent except on the
          toasts themselves — otherwise an empty viewport would swallow
          clicks on whatever sits in the bottom-right corner of the page. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => onDismiss(toast.id), DWELL_MS[toast.tone]);
    return () => clearTimeout(timer);
    // Re-running on `paused` restarts the full dwell rather than resuming the
    // remainder. Deliberate: someone who hovered was reading, and giving them
    // the whole window back on exit is friendlier than half a second.
  }, [paused, toast.id, toast.tone, onDismiss]);

  const isError = toast.tone === "error";

  return (
    <div
      // `alert` interrupts, `status` waits for a pause in speech. An error the
      // user didn't ask for is worth interrupting; a save confirmation isn't.
      role={isError ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={`rf-toast rf-panel pointer-events-auto flex w-full max-w-sm items-start gap-3 px-4 py-3 ${
        isError ? "border-[var(--color-error-border)] bg-[var(--color-error-bg)] text-[var(--color-error-text)]" : ""
      }`}
    >
      {/* Signal rule down the leading edge — the same device the list rows
          and selected tiles use to mean "this one". On an error it takes the
          error colour instead, so tone is legible before the text is read. */}
      <span
        aria-hidden
        className="-my-3 -ml-4 mr-1 w-0.5 self-stretch"
        style={{ background: isError ? "var(--color-error-text)" : "var(--color-signal)" }}
      />
      <p className="flex-1 text-sm">{toast.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        // The message is already announced by the role; naming the button
        // "Dismiss notification" rather than just "Dismiss" keeps it
        // distinguishable when a screen reader lists the page's buttons.
        aria-label="Dismiss notification"
        className="-m-1 shrink-0 rounded p-1 text-lg leading-none opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
      >
        <span aria-hidden="true">&times;</span>
      </button>
    </div>
  );
}
