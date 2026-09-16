// app/deals/[dealId]/intake/IntakeForm.tsx
// Client-side renderer for one deal's Deal Intake Form. Phase 2: takes
// `dealId` from the URL (via the page) and reads/writes
// /api/deals/[dealId]/intake instead of the old Phase 1 singleton
// /api/intake. Field rendering is unchanged — still the shared
// components/IntakeFieldsEditor.tsx used by the review page's inline editor.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { IntakeFormSchema } from "@/lib/formTypes";
import { useDerivedIntakeAnswers } from "@/lib/useDerivedIntakeAnswers";
import IntakeFieldsEditor, { intakeInputClasses } from "@/components/IntakeFieldsEditor";

export default function IntakeForm({
  dealId,
  schema,
  initialAnswers = {},
}: {
  dealId: string;
  schema: IntakeFormSchema;
  initialAnswers?: Record<string, string>;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listingText, setListingText] = useState("");
  const [listingFiles, setListingFiles] = useState<File[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [flaggedFields, setFlaggedFields] = useState<Record<string, string>>({});

  useDerivedIntakeAnswers(answers, setAnswers);

  function setField(key: string, value: string) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    // Editing a field by hand means the realtor has provided it — clear any unresolved flag.
    setFlaggedFields((prev) => {
      if (!(key in prev)) return prev;
      const { [key]: _removed, ...rest } = prev;
      return rest;
    });
  }

  async function runExtraction(request: () => Promise<Response>) {
    setExtracting(true);
    setExtractError(null);
    try {
      const res = await request();
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Extraction failed");
      setAnswers((prev) => ({ ...prev, ...body.answers }));
      if (body.flagged && typeof body.flagged === "object") {
        setFlaggedFields((prev) => ({ ...prev, ...body.flagged }));
      }
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setExtracting(false);
    }
  }

  async function handleExtractListingText() {
    if (!listingText.trim()) return;
    await runExtraction(() =>
      fetch(`/api/extract-listing?dealId=${dealId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: listingText, currentAnswers: answers }),
      })
    );
  }

  async function handleExtractListingFile() {
    if (listingFiles.length === 0) return;
    const formData = new FormData();
    for (const file of listingFiles) formData.append("file", file);
    await runExtraction(() => fetch(`/api/extract-listing?dealId=${dealId}`, { method: "POST", body: formData }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/intake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(answers),
      });
      if (!res.ok) throw new Error("Failed to save intake answers");
      router.push(`/deals/${dealId}/review`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6 pb-24">
      <div className="rounded-xl border border-[var(--color-accent)]/20 bg-[var(--color-accent)]/5 p-5">
        <h2 className="text-base font-semibold text-[var(--color-text)]">Pre-fill from a listing export (optional)</h2>
        <p className="mt-1.5 text-sm text-[var(--color-text-muted)]">
          Upload or paste a listing export to pre-fill this form. Where the listing is genuinely ambiguous about
          something (e.g. whether a utility is included in rent, not just present in the unit), the field is left
          blank with a note instead of guessing.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <label htmlFor="listing-file" className="mb-1.5 block text-sm font-medium text-[var(--color-text)]">
              Upload listing file(s) — PDF or .txt
            </label>
            <p className="mb-1.5 text-xs text-[var(--color-text-muted)]">
              Link the main listing sheet plus any Schedules/Addenda — details like rent payment method are often on
              those rather than the main sheet, and reading them together lets us pull from whichever one actually
              states each fact. Add files one at a time or select several at once (Ctrl/Cmd+click in the picker).
            </p>
            <input
              id="listing-file"
              type="file"
              accept="application/pdf,.pdf,text/plain,.txt"
              multiple
              onChange={(e) => {
                const newFiles = Array.from(e.target.files ?? []);
                setListingFiles((prev) => [...prev, ...newFiles]);
                e.target.value = ""; // reset so picking the same file again still fires onChange
              }}
              className="block w-full text-sm text-[var(--color-text-muted)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--color-accent)]/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-[var(--color-accent)] hover:file:bg-[var(--color-accent)]/20"
            />
            {listingFiles.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                {listingFiles.map((file, i) => (
                  <li key={`${file.name}-${i}`} className="flex items-center justify-between gap-2">
                    <span className="truncate">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => setListingFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      className="shrink-0 text-[var(--color-error-text)] hover:underline"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={handleExtractListingFile}
              disabled={extracting || listingFiles.length === 0}
              className="mt-3 w-full rf-btn px-3 py-2 text-sm"
            >
              {extracting
                ? "Extracting…"
                : listingFiles.length > 1
                  ? `Extract from ${listingFiles.length} files`
                  : "Extract from file"}
            </button>
          </div>

          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <label htmlFor="listing-text" className="mb-1.5 block text-sm font-medium text-[var(--color-text)]">
              Paste listing text
            </label>
            <textarea
              id="listing-text"
              value={listingText}
              onChange={(e) => setListingText(e.target.value)}
              rows={3}
              placeholder="Paste listing text here…"
              className={intakeInputClasses}
            />
            <button
              type="button"
              onClick={handleExtractListingText}
              disabled={extracting || !listingText.trim()}
              className="mt-3 w-full rf-btn px-3 py-2 text-sm"
            >
              {extracting ? "Extracting…" : "Extract from pasted text"}
            </button>
          </div>
        </div>

        {extractError && (
          <p role="alert" className="mt-3 rounded-md border border-[var(--color-error-border)] bg-[var(--color-error-bg)] px-3 py-2 text-sm text-[var(--color-error-text)]">
            {extractError}
          </p>
        )}
      </div>

      <IntakeFieldsEditor schema={schema} answers={answers} flaggedFields={flaggedFields} onChange={setField} />

      {error && (
        <p role="alert" className="rounded-md border border-[var(--color-error-border)] bg-[var(--color-error-bg)] px-3 py-2 text-sm text-[var(--color-error-text)]">
          {error}
        </p>
      )}

      {/* z-20 puts this above the section nav's z-10. Both are sticky and the
          form is short enough on a laptop for the two to meet in the middle
          of a scroll; without this, the nav's chips paint over the Continue
          button. The submit control is the one thing on this page that must
          never be obscured. */}
      <div className="sticky bottom-0 z-20 -mx-6 border-t border-[var(--color-border)] bg-[var(--color-bg)]/95 px-6 py-4 backdrop-blur">
        <button
          type="submit"
          disabled={saving}
          className="w-full rf-btn px-4 py-3 text-base sm:w-auto"
        >
          {saving ? "Saving…" : "Continue to review →"}
        </button>
      </div>
    </form>
  );
}
