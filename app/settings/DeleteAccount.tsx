// app/settings/DeleteAccount.tsx
// Irreversible account deletion. Deliberately gated behind typing DELETE
// rather than a single click or a browser confirm() — this wipes every deal
// and every generated PDF with no undo, so an accidental click shouldn't be
// able to do it.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteAccount() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to delete account");
      }
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setDeleting(false);
    }
  }

  return (
    <div className="rounded-xl border border-[var(--color-error-border)] bg-[var(--color-error-bg)] p-5">
      <h2 className="text-base font-semibold text-[var(--color-error-text)]">Delete account</h2>
      <p className="mt-1 text-sm text-[var(--color-error-text)]">
        Permanently deletes your account, every deal, and every PDF you&apos;ve generated. This cannot be undone.
      </p>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 rounded-lg border border-[var(--color-error-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-semibold text-[var(--color-error-text)] transition-colors hover:bg-[var(--color-error-bg)]"
        >
          Delete my account
        </button>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <label htmlFor="confirm-delete" className="text-sm font-medium text-[var(--color-error-text)]">
            Type <span className="font-mono font-bold">DELETE</span> to confirm
          </label>
          <input
            id="confirm-delete"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoComplete="off"
            className="w-full max-w-xs rounded-md border border-[var(--color-error-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-error-border)]"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={confirmText !== "DELETE" || deleting}
              onClick={handleDelete}
              className="rounded-lg bg-[var(--color-error-text)] px-4 py-2 text-sm font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            >
              {deleting ? "Deleting…" : "Permanently delete"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setConfirmText("");
                setError(null);
              }}
              className="text-sm font-medium text-[var(--color-text-muted)] hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-[var(--color-error-text)]">
          {error}
        </p>
      )}
    </div>
  );
}
