// app/reset-password/page.tsx
// Step 2 of password recovery — where the emailed link lands after
// /auth/callback has exchanged the recovery code for a session. Not listed
// in proxy.ts's PROTECTED_PREFIXES: the user arriving here is mid-recovery
// and the action itself verifies there's a real session before changing
// anything, so gating the page too would just turn an expired link into a
// confusing redirect instead of a clear message.

import type { Metadata } from "next";
import Link from "next/link";
import Wordmark from "@/components/Wordmark";
import { updatePassword } from "@/app/login/actions";
import { MIN_PASSWORD_LENGTH, PASSWORD_REQUIREMENT } from "@/lib/passwordPolicy";

export const metadata: Metadata = {
  title: "Set a new password — RealtyFill",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    // Matches app/login/page.tsx exactly — these two are the same moment in the
    // flow, so they share the deep-ink field and white card.
    <main className="flex min-h-screen flex-col justify-center bg-[var(--brand-deep)] px-6 py-12">
      <div className="mx-auto w-full max-w-sm">
        <Link href="/" className="inline-block text-2xl">
          <Wordmark tone="dark" />
        </Link>

        <div className="mt-6 rounded-2xl bg-[var(--color-surface)] p-7 shadow-2xl shadow-black/25">
          <h1 className="text-xl font-semibold tracking-tight text-[var(--color-text)]">Set a new password</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">Enter a new password for your account.</p>

          {error && (
            <p role="alert" className="mt-4 rounded-md border border-[var(--color-error-border)] bg-[var(--color-error-bg)] px-3 py-2 text-sm text-[var(--color-error-text)]">
              {error}
            </p>
          )}

          <form action={updatePassword} className="mt-6 flex flex-col gap-4">
            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium text-[var(--color-text)]">
                New password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                className="rf-field"
              />
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">{PASSWORD_REQUIREMENT}</p>
            </div>
            <button
              type="submit"
              className="mt-2 w-full rf-btn px-4 py-2.5"
            >
              Update password
            </button>
          </form>

          <p className="mt-4 text-sm text-[var(--color-text-muted)]">
            <Link href="/login" className="font-medium text-[var(--color-accent)] hover:underline">
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
