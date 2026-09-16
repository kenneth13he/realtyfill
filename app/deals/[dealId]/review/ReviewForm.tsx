// app/deals/[dealId]/review/ReviewForm.tsx
// Client-side review + form-selection + generate UI for one deal. Phase 2:
// reads/writes /api/deals/[dealId]/intake and /api/deals/[dealId]/generate
// instead of the old Phase 1 singleton /api/intake and /api/generate.
//
// `initialResults`/`initialSelected` let the page show forms that were
// already generated on a previous visit — Phase 1 never needed this since
// output was ephemeral and scoped to one demo deal, but now that a deal's
// generated PDFs actually persist in Storage, revisiting it should show what
// was already made rather than looking freshly empty every time.

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toaster";
import { FORM_LABELS, FormId, IntakeFormSchema } from "@/lib/formTypes";
import { useDerivedIntakeAnswers } from "@/lib/useDerivedIntakeAnswers";
import IntakeFieldsEditor from "@/components/IntakeFieldsEditor";

export default function ReviewForm({
  dealId,
  answers: initialAnswers,
  schema,
  initialResults = [],
  formIds,
}: {
  dealId: string;
  answers: Record<string, string>;
  schema: IntakeFormSchema;
  initialResults?: { form: FormId; downloadUrl: string }[];
  /** The forms in this deal's set — not every form the app knows about. */
  formIds: FormId[];
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers);
  const [editing, setEditing] = useState(false);
  const [autosaving, setAutosaving] = useState(false);
  const [selected, setSelected] = useState<Set<FormId>>(new Set(initialResults.map((r) => r.form)));
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ form: FormId; downloadUrl: string }[]>(initialResults);
  const [hasGenerated, setHasGenerated] = useState(initialResults.length > 0);
  const [previewing, setPreviewing] = useState<FormId | null>(null);
  const [updateText, setUpdateText] = useState("");
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateFlagged, setUpdateFlagged] = useState<Record<string, string>>({});
  const [changedKeys, setChangedKeys] = useState<Set<string>>(new Set());
  const toast = useToast();

  useDerivedIntakeAnswers(answers, setAnswers);

  // Flagged fields are reported by their schema key ("tenant1_full_name");
  // a person needs the label that's printed beside the input.
  const fieldLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const group of schema.groups) {
      for (const field of group.fields) labels[field.key] = field.label;
    }
    return labels;
  }, [schema]);

  /**
   * Open the editor if it's closed, scroll the field into view and focus it.
   *
   * The rAF is not decoration: when the editor was closed, the input doesn't
   * exist in the DOM yet at the moment this runs, so the lookup has to wait
   * for React to commit the render that setEditing(true) triggers.
   */
  function revealField(key: string) {
    setEditing(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.getElementById(key);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        (el as HTMLElement).focus({ preventScroll: true });
      });
    });
  }

  function dismissFlag(key: string) {
    setUpdateFlagged((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  // Mirrors `answers` for the debounced autosave below, so the save always
  // sends the latest values even though the setTimeout callback closes over
  // whatever `answers` looked like when it was scheduled.
  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function toggle(formId: FormId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(formId)) next.delete(formId);
      else next.add(formId);
      return next;
    });
  }

  // `announce` separates the two ways this runs. Clicking "Generate" is an
  // explicit act and deserves a confirmation; the same function also runs as
  // a silent regeneration after an autosave, and toasting on every debounced
  // keystroke would turn the corner of the screen into a strobe.
  async function handleGenerate({ announce = false }: { announce?: boolean } = {}) {
    setGenerating(true);
    setError(null);
    setResults([]);
    try {
      const res = await fetch(`/api/deals/${dealId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedForms: Array.from(selectedRef.current) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to generate");
      setResults(body.results);
      setHasGenerated(true);
      if (announce) {
        const n = body.results.length;
        toast.success(n === 1 ? "1 form generated." : `${n} forms generated.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setGenerating(false);
    }
  }

  function setField(key: string, value: string) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    // Deliberately not marked in `changedKeys` — that drives the "Updated"
    // badge/highlight, which exists to surface what the AI changed on your
    // behalf via "Update with more info". A field you just typed into
    // yourself needs no such flag — you already know you changed it.
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      void autosaveAndMaybeRegenerate();
    }, 800);
  }

  async function autosaveAndMaybeRegenerate() {
    setAutosaving(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/intake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(answersRef.current),
      });
      if (!res.ok) throw new Error("Failed to save changes");
      if (hasGenerated && selectedRef.current.size > 0) {
        await handleGenerate();
      }
    } catch (err) {
      // Toast rather than the inline box. This runs 800ms after the user
      // stopped typing, with no submit button in focus and quite possibly
      // several screens away from where the inline error renders — so an
      // inline message here can fail silently in practice. Losing edits
      // quietly is the one failure on this page that must not be missable.
      toast.error(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setAutosaving(false);
    }
  }

  async function handleUpdateAndRegenerate() {
    if (!updateText.trim()) return;
    setUpdating(true);
    setUpdateError(null);
    try {
      const extractRes = await fetch(`/api/extract-listing?dealId=${dealId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: updateText, currentAnswers: answers }),
      });
      const extractBody = await extractRes.json();
      if (!extractRes.ok) throw new Error(extractBody.error ?? "Failed to read that update");

      const mergedAnswers = { ...answers, ...extractBody.answers };
      setAnswers(mergedAnswers);
      setUpdateFlagged(extractBody.flagged ?? {});
      setChangedKeys((prev) => new Set([...prev, ...Object.keys(extractBody.answers ?? {})]));

      const saveRes = await fetch(`/api/deals/${dealId}/intake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mergedAnswers),
      });
      if (!saveRes.ok) throw new Error("Failed to save updated answers");

      setUpdateText("");
      // Only regenerate if there's actually something to regenerate. This
      // box is available before the first generate too (paste the listing
      // details in, then generate once), and calling generate with nothing
      // selected would fail with "selectedForms must include at least one
      // form" — an error about a step the user hasn't taken yet.
      if (hasGenerated && selectedRef.current.size > 0) {
        await handleGenerate();
      }
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setUpdating(false);
    }
  }

  const groupsWithAnswers = schema.groups
    .map((group) => ({
      ...group,
      fields: group.fields.filter((field) => {
        if (field.hidden) return false;
        const value = answers[field.key];
        return value !== undefined && value !== "" && value !== "/Off";
      }),
    }))
    .filter((group) => group.fields.length > 0);

  const hasAnswers = groupsWithAnswers.length > 0;

  // (An empty-field warning used to live here. Removed: "(optional)" in the
  // label is too crude a proxy for "required" — it counted ~37 fields on a
  // realistic deal, most of them things a realtor legitimately wouldn't have
  // or need, which made it noise rather than a signal. The per-field red
  // asterisks in the editor already cover this at the point of entry.)

  const affectedForms = new Set<FormId>();
  if (changedKeys.size > 0) {
    for (const group of schema.groups) {
      for (const field of group.fields) {
        if (!changedKeys.has(field.key)) continue;
        for (const formId of Object.keys(field.targets) as FormId[]) affectedForms.add(formId);
      }
    }
  }

  // Everything slow on this page (autosave, generate, "update with more info")
  // reports itself with a text swap somewhere on screen and no focus change.
  // This is the same information routed to a screen reader. One region rather
  // than three, because only one of these runs at a time.
  const liveStatus = generating
    ? `Generating ${selected.size} ${selected.size === 1 ? "form" : "forms"}.`
    : updating
      ? "Reading your update."
      : autosaving
        ? "Saving your answers."
        : results.length > 0
          ? `${results.length} ${results.length === 1 ? "form is" : "forms are"} ready.`
          : "";

  return (
    <div className="flex flex-col gap-6 pb-16">
      <p aria-live="polite" className="sr-only">
        {liveStatus}
      </p>

      <div className="rf-panel p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--color-text)]">Answers on file</h2>
          <div className="flex items-center gap-3">
            {editing && autosaving && (
              <span className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                <Spinner className="h-3 w-3" />
                Saving…
              </span>
            )}
            <button
              type="button"
              onClick={() => setEditing((prev) => !prev)}
              className="rounded text-sm font-medium text-[var(--color-accent)] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2"
            >
              {editing ? "Done editing" : "Edit answers"}
            </button>
          </div>
        </div>

        {editing ? (
          <div className="mt-4">
            <IntakeFieldsEditor schema={schema} answers={answers} flaggedFields={updateFlagged} onChange={setField} />
          </div>
        ) : !hasAnswers ? (
          <p className="mt-3 text-sm text-[var(--color-text-muted)]">
            No intake data yet —{" "}
            <button type="button" onClick={() => setEditing(true)} className="font-medium text-[var(--color-accent)] hover:underline">
              fill in the answers
            </button>
            .
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-5">
            {groupsWithAnswers.map((group) => (
              <div key={group.group}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  {group.label}
                </h3>
                <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                  {group.fields.map((field) => {
                    const rawValue = answers[field.key];
                    const displayValue =
                      field.type === "radio"
                        ? field.options?.find((o) => o.value === rawValue)?.label ?? rawValue
                        : field.type === "checkbox"
                          ? rawValue === "/1"
                            ? "Yes"
                            : "No"
                          : rawValue;
                    const wasChanged = changedKeys.has(field.key);
                    return (
                      <div
                        key={field.key}
                        className={
                          "flex justify-between gap-3 border-b py-1.5 text-sm" +
                          (wasChanged
                            ? " -mx-2 rounded-md border-transparent bg-[var(--color-warn-bg)] px-2 ring-1 ring-inset ring-[var(--color-warn-border)]"
                            : " border-[var(--color-border)]/60")
                        }
                      >
                        <dt className="text-[var(--color-text-muted)]">
                          {field.label}
                          {wasChanged && (
                            <span className="ml-1.5 rounded-full bg-[var(--color-warn-border)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-warn-text)]">
                              Updated
                            </span>
                          )}
                        </dt>
                        <dd className="text-right font-medium text-[var(--color-text)]">{displayValue}</dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rf-panel p-5">
        <h2 className="text-base font-semibold text-[var(--color-text)]">Select forms to generate</h2>
        <div className="mt-3 flex flex-col gap-2">
          {formIds.map((formId) => (
            <label
              key={formId}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--color-border)] px-3 py-2.5 text-sm transition-colors has-[:checked]:border-[var(--color-accent)] has-[:checked]:bg-[var(--color-accent)]/5"
            >
              <input
                type="checkbox"
                checked={selected.has(formId)}
                onChange={() => toggle(formId)}
                className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
              />
              <span className="font-medium text-[var(--color-text)]">{FORM_LABELS[formId]}</span>
            </label>
          ))}
        </div>
        <button
          onClick={() => handleGenerate({ announce: true })}
          disabled={generating || selected.size === 0 || !hasAnswers}
          className="mt-4 flex w-full items-center justify-center gap-2 rf-btn px-4 py-3 text-base sm:w-auto"
        >
          {generating && <Spinner className="h-5 w-5" />}
          {generating ? "Generating…" : "Generate selected forms"}
        </button>

        {/* Deliberately NOT a per-form progress bar. The generate route fills
            every selected form in one server-side loop and responds once
            (app/api/deals/[dealId]/generate/route.ts), so the browser cannot
            know which form is in flight — animating through them one by one
            would be inventing progress we can't observe. This says what is
            actually true: the whole set is running, and here's how long that
            normally takes. Real per-form progress needs the route to stream. */}
        {generating && (
          <div className="mt-3 flex flex-col gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3.5 py-3">
            <p className="text-sm font-medium text-[var(--color-text)]">
              Filling {selected.size} {selected.size === 1 ? "form" : "forms"} — usually a few seconds.
            </p>
            <p className="text-xs text-[var(--color-text-muted)]">
              {Array.from(selected)
                .map((formId) => FORM_LABELS[formId])
                .join(" · ")}
            </p>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-[var(--color-error-border)] bg-[var(--color-error-bg)] px-3 py-2 text-sm text-[var(--color-error-text)]">
          {error}
        </p>
      )}

      {/* Shown before the first generate too, not just after — pasting the
          details in is often the first thing you'd want to do on a new deal,
          and hiding this until after a generate made that non-obvious. */}
      <div className="rf-panel p-5">
          <h2 className="text-base font-semibold text-[var(--color-text)]">Update with more info</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Paste any new or corrected details (an email, a note, an updated listing) and matching fields are filled
            in for you.
            {hasGenerated ? " The forms you've generated are then updated automatically." : ""}
          </p>
          <textarea
            value={updateText}
            onChange={(e) => setUpdateText(e.target.value)}
            rows={3}
            placeholder="Paste additional or corrected info here…"
            className="mt-3 rf-field"
          />
          <button
            type="button"
            onClick={handleUpdateAndRegenerate}
            disabled={updating || generating || !updateText.trim()}
            className="mt-3 flex w-full items-center justify-center gap-2 rf-btn px-4 py-3 text-base sm:w-auto"
          >
            {updating && <Spinner className="h-5 w-5" />}
            {updating ? "Updating…" : hasGenerated ? "Update & regenerate forms" : "Add this info"}
          </button>
          {updateError && (
            <p role="alert" className="mt-3 rounded-md border border-[var(--color-error-border)] bg-[var(--color-error-bg)] px-3 py-2 text-sm text-[var(--color-error-text)]">
              {updateError}
            </p>
          )}
          {/* Previously one grey italic sentence listing raw field keys. It
              named things like "tenant1_full_name", gave no way to act on
              them, and left you scrolling the editor to find the field it
              meant. Each one is now the field's real label plus a button
              that opens the editor and puts the cursor in it. */}
          {Object.keys(updateFlagged).length > 0 && (
            <div className="mt-3 rounded-lg border border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-3">
              <p className="text-sm font-medium text-[var(--color-warn-text)]">
                {Object.keys(updateFlagged).length === 1
                  ? "One field needs your call"
                  : `${Object.keys(updateFlagged).length} fields need your call`}
              </p>
              <p className="mt-0.5 text-xs text-[var(--color-warn-text)]">
                These were left as they were, rather than guessed at.
              </p>
              <ul className="mt-2 flex flex-col gap-2">
                {Object.entries(updateFlagged).map(([key, reason]) => (
                  <li key={key} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                    <span className="font-medium text-[var(--color-warn-text)]">{fieldLabels[key] ?? key}</span>
                    <span className="text-xs text-[var(--color-warn-text)]">— {reason}</span>
                    <button
                      type="button"
                      onClick={() => revealField(key)}
                      className="rounded border border-[var(--color-warn-border)] bg-[var(--color-surface)] px-2 py-0.5 text-xs font-medium text-[var(--color-warn-text)] transition-colors hover:bg-[var(--color-warn-border)]"
                    >
                      Go to field
                    </button>
                    <button
                      type="button"
                      onClick={() => dismissFlag(key)}
                      aria-label={`Dismiss ${fieldLabels[key] ?? key}`}
                      className="text-xs text-[var(--color-warn-text)] underline transition-colors hover:text-[var(--color-warn-text)]"
                    >
                      Dismiss
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
      </div>

      {results.length > 0 && (
        <div className="rounded-xl border border-[var(--color-ok-border)] bg-[var(--color-ok-bg)] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-[var(--color-ok-text)]">Generated PDFs</h2>
              <p className="mt-1 text-sm text-[var(--color-ok-text)]">
                Click a form to preview it. You can edit fields directly in the viewer below — use its own toolbar
                (not a button here) to save, since that&apos;s what actually captures your edits.
              </p>
            </div>
            {/* The payoff of the whole flow, so it's the accent button rather
                than another outline — and an <a>, not a fetch: the response
                is served as an attachment, so the browser downloads it
                without navigating away and without us touching a Blob URL.
                Only worth showing for a set; with one form the row's own
                Download button is the same click. */}
            {results.length > 1 && (
              <a
                href={`/api/deals/${dealId}/download-all`}
                className="rf-btn shrink-0 focus-visible:ring-2 focus-visible:ring-[var(--color-ok-text)] focus-visible:ring-offset-2"
              >
                Download all ({results.length})
              </a>
            )}
          </div>
          <ul className="mt-3 flex flex-col gap-2">
            {results.map((r) => {
              const isOpen = previewing === r.form;
              return (
                <li key={r.form} className="rounded-lg border border-[var(--color-ok-border)] bg-[var(--color-surface)]">
                  <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => setPreviewing((prev) => (prev === r.form ? null : r.form))}
                      aria-expanded={isOpen}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ok-text)] focus-visible:ring-offset-2"
                    >
                      <span aria-hidden className="text-[var(--color-ok-text)]">
                        {isOpen ? "▲" : "▼"}
                      </span>
                      <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-[var(--color-ok-text)]">
                        {FORM_LABELS[r.form]}
                        {affectedForms.has(r.form) && (
                          <span className="rounded-full bg-[var(--color-warn-border)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-warn-text)]">
                            Updated
                          </span>
                        )}
                      </span>
                    </button>
                    {/* The inline preview is an iframe inside an accordion
                        inside a scrolling page — three nested scroll contexts,
                        which is unusable on a phone. This escape hatch is
                        always available and is the primary route on small
                        screens, where the iframe below is hidden outright. */}
                    <div className="flex shrink-0 items-center gap-1.5">
                      <a
                        href={`${r.downloadUrl}?inline=1`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded border border-[var(--color-ok-border)] px-2 py-1 text-xs font-medium text-[var(--color-ok-text)] outline-none transition-colors hover:bg-[var(--color-ok-bg)] focus-visible:ring-2 focus-visible:ring-[var(--color-ok-text)] focus-visible:ring-offset-2"
                      >
                        Open in new tab
                      </a>
                      {/* Same route without `inline=1`, which is what makes
                          Storage sign the URL with a download disposition —
                          so this saves the file instead of opening a viewer.
                          The label names the form, since "Download" repeated
                          down a list of five tells a screen reader nothing
                          about which one it's on. */}
                      <a
                        href={r.downloadUrl}
                        aria-label={`Download ${FORM_LABELS[r.form]}`}
                        className="rounded border border-[var(--color-ok-border)] px-2 py-1 text-xs font-medium text-[var(--color-ok-text)] outline-none transition-colors hover:bg-[var(--color-ok-bg)] focus-visible:ring-2 focus-visible:ring-[var(--color-ok-text)] focus-visible:ring-offset-2"
                      >
                        Download
                      </a>
                    </div>
                  </div>
                  {isOpen && (
                    <>
                      {/* `view=FitH` is what actually makes this readable.
                          The frame is far wider than it is tall, and a
                          letter page is the opposite, so the viewer was
                          scaling to fit the *height* and leaving wide grey
                          margins either side — the page rendered at roughly
                          three-quarters of the width available to it.
                          Fitting the width instead uses the whole frame, at
                          the cost of scrolling down inside it to reach the
                          bottom of the page. Both parameters are PDF open
                          parameters, understood by Chrome's built-in viewer
                          and by Firefox's pdf.js respectively; a viewer that
                          knows neither ignores the fragment and renders as
                          it did before.

                          Height is capped by the viewport no matter what, so
                          88vh is close to the most this can be without the
                          surrounding page disappearing entirely. "Open in
                          new tab" above stays the route to a full window. */}
                      <iframe
                        title={`Preview of ${FORM_LABELS[r.form]}`}
                        src={`${r.downloadUrl}?inline=1#view=FitH&zoom=page-width`}
                        className="hidden h-[88vh] w-full border-t border-[var(--color-ok-border)] sm:block"
                      />
                      <p className="border-t border-[var(--color-ok-border)] px-3 py-3 text-xs text-[var(--color-ok-text)] sm:hidden">
                        PDF previews don&apos;t work well on a small screen — use{" "}
                        <span className="font-medium">Open in new tab</span> to view or download this form.
                      </p>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
