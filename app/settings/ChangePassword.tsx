// app/settings/ChangePassword.tsx
// Password change for a signed-in user. Collapsed behind a button rather
// than sitting open: it's a rare action next to the brokerage defaults
// above it, which are the reason people actually come to this page.
//
// The current-password field is not ceremony — see changePassword in
// app/login/actions.ts for why a signed-in session isn't proof enough on
// its own.

"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { changePassword, type ChangePasswordState } from "@/app/login/actions";
import { MIN_PASSWORD_LENGTH, PASSWORD_REQUIREMENT } from "@/lib/passwordPolicy";


export default function ChangePassword({ hasPasswordLogin }: { hasPasswordLogin: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ChangePasswordState, FormData>(changePassword, null);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the fields once the change went through, so three filled password
  // boxes aren't left sitting on screen after they've stopped meaning
  // anything. Failures keep what was typed — retyping a long new password
  // because the *current* one had a typo is its own small punishment.
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <div className="rf-panel p-5">
      <h2 className="text-base font-semibold text-[var(--color-text)]">Password</h2>

      {!hasPasswordLogin ? (
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          You sign in with Google, so there&apos;s no RealtyFill password to change. Your password is managed in your
          Google account.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Change the password you use to sign in to RealtyFill.
          </p>

          {!open ? (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-semibold text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg)]"
            >
              Change password
            </button>
          ) : (
            <form ref={formRef} action={formAction} className="mt-4 flex flex-col gap-4">
              {/* Password managers key their "which account is this?" guess off
                  a username field. Hidden and unfocusable, but present. */}
              <input type="text" name="username" autoComplete="username" hidden readOnly value="" />

              <div className="max-w-sm">
                <label htmlFor="current_password" className="mb-1 block text-sm font-medium text-[var(--color-text)]">
                  Current password
                </label>
                <input
                  id="current_password"
                  name="current_password"
                  type="password"
                  required
                  autoComplete="current-password"
                  className="rf-field"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="new_password" className="mb-1 block text-sm font-medium text-[var(--color-text)]">
                    New password
                  </label>
                  <input
                    id="new_password"
                    name="new_password"
                    type="password"
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                    autoComplete="new-password"
                    className="rf-field"
                  />
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{PASSWORD_REQUIREMENT}</p>
                </div>
                <div>
                  <label htmlFor="confirm_password" className="mb-1 block text-sm font-medium text-[var(--color-text)]">
                    Confirm new password
                  </label>
                  <input
                    id="confirm_password"
                    name="confirm_password"
                    type="password"
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                    autoComplete="new-password"
                    className="rf-field"
                  />
                </div>
              </div>

              {state && (
                <p
                  role={state.ok ? "status" : "alert"}
                  className={
                    "rounded-md border px-3 py-2 text-sm " +
                    (state.ok
                      ? "border-[var(--color-ok-border)] bg-[var(--color-ok-bg)] text-[var(--color-ok-text)]"
                      : "border-[var(--color-error-border)] bg-[var(--color-error-bg)] text-[var(--color-error-text)]")
                  }
                >
                  {state.message}
                </p>
              )}

              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={pending}
                  className="rf-btn px-4 py-2.5"
                >
                  {pending ? "Updating…" : "Update password"}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-sm font-medium text-[var(--color-text-muted)] hover:underline"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}
