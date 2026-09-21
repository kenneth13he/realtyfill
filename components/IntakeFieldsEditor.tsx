// components/IntakeFieldsEditor.tsx
// The grouped intake-field renderer — one section per schema group, one
// input per visible field — shared by app/intake/IntakeForm.tsx (the
// full "New/Edit Deal" page) and app/review/ReviewForm.tsx's inline editor,
// so both present/edit fields identically instead of drifting apart.

"use client";

import { useEffect, useState } from "react";
import type { IntakeField, IntakeFormSchema } from "@/lib/formTypes";
import {
  initiallyCollapsedGroupIds,
  fieldIsVisible,
  groupOfField,
  intakeSections,
  isMissingValue,
} from "@/components/intakeSections";

// Re-exported because this module was where they lived before the collapse
// work moved them somewhere testable.
export { fieldIsVisible, isMissingValue };

/**
 * A request from a parent to put one field in front of the user.
 *
 * `nonce` is what makes a *repeat* request work: clicking the same flagged
 * field twice sets the same `key`, so without a changing value the effect
 * that acts on this would not re-run and the second click would do nothing.
 */
export type RevealRequest = { key: string; nonce: number };

export const intakeInputClasses =
  "rf-field";

/**
 * Points down when the thing it controls is closed (click to open), up when
 * it's open. Shared by the section nav and each group header so the two
 * disclosures read as the same control rather than two similar ones.
 */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={
        "h-4 w-4 shrink-0 text-[var(--color-accent)] transition-transform duration-150 motion-reduce:transition-none" +
        (open ? " rotate-180" : "")
      }
    >
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

function Field({
  field,
  value,
  flagReason,
  onChange,
}: {
  field: IntakeField;
  value: string;
  flagReason?: string;
  onChange: (value: string) => void;
}) {
  const isDerived = Boolean(field.derived_from);
  // Labels already mark genuinely optional fields with "(optional)" (e.g.
  // "Tenant 2 — First Name (optional)") — anything else that's still empty
  // is flagged so it's obvious what's missing before generating forms.
  // The rule itself lives in isMissingValue below, shared with the section
  // counts in the nav so the asterisks and the numbers always agree.
  const isMissing = isMissingValue(field, { [field.key]: value });
  const missingInputClasses = isMissing ? " border-[var(--color-error-text)] focus:border-[var(--color-error-text)] focus:ring-[var(--color-error-text)]/20" : "";
  return (
    <div className={field.type === "long_text" ? "sm:col-span-2" : undefined}>
      <label htmlFor={field.key} className="mb-1 flex items-center gap-1 text-sm font-medium text-[var(--color-text)]">
        <span>{field.label}</span>
        {isMissing && (
          <span className="text-[var(--color-error-text)]" title="Missing — needed for the forms that use it">
            *
          </span>
        )}
      </label>
      {flagReason && (
        <p className="mb-1 text-xs italic text-[var(--color-text-muted)]">
          Not filled from listing — {flagReason}
        </p>
      )}
      {field.type === "radio" ? (
        <select
          id={field.key}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={intakeInputClasses + missingInputClasses}
        >
          <option value="" disabled>
            Select…
          </option>
          {field.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : field.type === "checkbox" ? (
        <input
          id={field.key}
          type="checkbox"
          checked={value === "/1"}
          onChange={(e) => onChange(e.target.checked ? "/1" : "/Off")}
          className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
        />
      ) : field.type === "long_text" ? (
        <textarea
          id={field.key}
          value={value || field.default || ""}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          className={intakeInputClasses + missingInputClasses}
        />
      ) : (
        <input
          id={field.key}
          type={field.type === "date" ? "date" : field.type === "number" || field.type === "currency" ? "number" : "text"}
          value={value || field.default || ""}
          onChange={(e) => onChange(e.target.value)}
          readOnly={isDerived}
          className={
            intakeInputClasses + (isDerived ? " bg-[var(--color-bg)] text-[var(--color-text-muted)]" : missingInputClasses)
          }
        />
      )}
    </div>
  );
}

export default function IntakeFieldsEditor({
  schema,
  answers,
  flaggedFields,
  onChange,
  reveal,
}: {
  schema: IntakeFormSchema;
  answers: Record<string, string>;
  flaggedFields?: Record<string, string>;
  onChange: (key: string, value: string) => void;
  /**
   * Ask the editor to scroll one field into view and focus it, expanding its
   * group first if that group is collapsed. Owned here rather than by the
   * caller because the collapse state is here: a caller doing its own
   * `getElementById` would find a `display:none` input and focus nothing.
   */
  reveal?: RevealRequest | null;
}) {
  // Computed once per render and reused by both the nav and the sections, so
  // the jump links and the headings always show the same numbers.
  const sections = intakeSections(schema, answers);

  const totalMissing = sections.reduce((sum, section) => sum + section.missing, 0);

  // The jump links run to three wrapped rows on a full form set, which is a
  // lot of a sticky bar to give up permanently — but they're also the only
  // way to move around a long form, so they stay open by default and the
  // realtor collapses them if they'd rather have the room. Collapsed still
  // shows the count, which is the part you want while typing.
  const [linksOpen, setLinksOpen] = useState(true);

  // Groups the user has folded away. Seeded once, on mount, with every group
  // that was already complete when the form opened — so returning to a deal
  // you've half-filled puts the finished sections out of the way and leaves
  // you looking at the work.
  //
  // Deliberately *not* re-run as you type. Collapsing a group the moment its
  // last field is filled would fold the section out from under the cursor
  // mid-keystroke and jump everything below it up the page. Auto-collapse is
  // a good idea on arrival and a hostile one while typing, so it happens only
  // on arrival. After that the control is the user's.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => initiallyCollapsedGroupIds(schema, answers));

  function expand(groupId: string) {
    setCollapsed((prev) => {
      if (!prev.has(groupId)) return prev;
      const next = new Set(prev);
      next.delete(groupId);
      return next;
    });
  }

  function toggleGroup(groupId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  // Expand the group that holds the requested field, then focus it.
  //
  // The two rAFs are the same trick the review page already used, for the
  // same reason: the expand above is a state update, so the input is still
  // hidden — and `focus()` on a `display:none` element is a no-op — until
  // React has committed the render that reveals it.
  const revealKey = reveal?.key;
  const revealNonce = reveal?.nonce;
  useEffect(() => {
    if (!revealKey) return;
    const groupId = groupOfField(schema, revealKey);
    if (groupId) expand(groupId);
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        const el = document.getElementById(revealKey);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        (el as HTMLElement).focus({ preventScroll: true });
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
    // `schema` is stable for the life of the page; re-running on every nonce
    // is the point, so the same field can be requested twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealKey, revealNonce]);

  return (
    <div className="flex flex-col gap-6">
      {/* The whole schema used to render as one undifferentiated scroll with
          no sense of position or of what was left. This is the cheap version
          of that fix: where you are, what's outstanding, and one click to
          each section. `sticky top-0` keeps it reachable from anywhere in a
          long form.

          Opaque, not translucent. This was `rf-panel/95 backdrop-blur` — but
          the `/95` opacity modifier only applies to Tailwind's own colour
          utilities, and `rf-panel` is a component class, so `rf-panel/95`
          matched no selector at all and the bar rendered with *no*
          background. Scrolled form fields showed straight through it, and
          the z-10 below painted that mess over the Continue bar at the
          bottom of the page. A sticky bar has one job — to stay readable
          over whatever passes beneath it — so it gets a solid surface. */}
      <nav
        aria-label="Intake sections"
        className="sticky top-0 z-10 -mx-1 flex flex-col gap-2 rf-panel px-4 py-3"
      >
        {/* type="button" is load-bearing, not boilerplate: this renders
            inside the intake <form>, where a button with no type defaults to
            submit — collapsing the nav would save and navigate to review. */}
        <button
          type="button"
          onClick={() => setLinksOpen((open) => !open)}
          aria-expanded={linksOpen}
          aria-controls="intake-section-links"
          className="flex w-full items-center justify-between gap-2 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2"
        >
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            {totalMissing === 0
              ? "All fields filled"
              : `${totalMissing} ${totalMissing === 1 ? "field" : "fields"} still empty`}
          </span>
          {/* The chevron is the whole affordance, so it gets the accent
              rather than the muted grey of the label beside it. */}
          <Chevron open={linksOpen} />
        </button>
        {/* Toggled with a display class rather than the `hidden` attribute:
            `[hidden]` and `.flex` have the same specificity, so a utility
            that sets display would quietly win and the list would stay
            visible. Kept in the DOM either way so aria-controls resolves. */}
        <ul id="intake-section-links" className={linksOpen ? "flex flex-wrap gap-1.5" : "hidden"}>
          {sections.map(({ group, missing }) => (
            <li key={group.group}>
              {/* Stays an <a> with a real href — it's a jump link, and that's
                  what gives it keyboard and middle-click behaviour for free.
                  The onClick only expands the target first, so a link to a
                  collapsed section lands on its fields instead of on a
                  closed header. Default anchor scrolling still does the
                  moving. */}
              <a
                href={`#section-${group.group}`}
                onClick={() => expand(group.group)}
                className="flex items-center gap-1.5 rounded-full border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-muted)] outline-none transition-colors hover:border-[var(--color-accent)]/60 hover:text-[var(--color-accent)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2"
              >
                {group.label}
                {missing > 0 && (
                  <span className="rounded-full bg-[var(--color-error-border)] px-1.5 text-[10px] font-bold tabular-nums text-[var(--color-error-text)]">
                    {missing}
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {sections.map(({ group, visibleFields, missing }) => {
        const isOpen = !collapsed.has(group.group);
        return (
          <div
            key={group.group}
            id={`section-${group.group}`}
            /* scroll-mt clears the sticky nav above — without it a jump link
               lands with the heading hidden behind the bar. */
            className="scroll-mt-28 rf-panel p-5"
          >
            {/* The whole header row is the toggle, not a separate icon
                button: at this size a 16px chevron is a poor target, and the
                label and the count are the obvious things to reach for.
                type="button" is load-bearing for the same reason as the nav's
                — inside the intake <form>, a typeless button submits. */}
            <h2 className="text-base font-semibold text-[var(--color-text)]">
              <button
                type="button"
                onClick={() => toggleGroup(group.group)}
                aria-expanded={isOpen}
                aria-controls={`fields-${group.group}`}
                className="flex w-full flex-wrap items-center justify-between gap-2 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2"
              >
                <span>{group.label}</span>
                <span className="flex items-center gap-2">
                  <span className="text-xs font-medium tabular-nums text-[var(--color-text-muted)]">
                    {missing === 0 ? "Complete" : `${missing} of ${visibleFields.length} empty`}
                  </span>
                  <Chevron open={isOpen} />
                </span>
              </button>
            </h2>
            {group.note && isOpen && <p className="mt-1 text-sm text-[var(--color-text-muted)]">{group.note}</p>}
            {/* Toggled with a display class rather than the `hidden`
                attribute — `[hidden]` and `.grid` have the same specificity,
                so the grid would quietly win and collapsing would do nothing.
                Same trap as the nav's list above. Kept mounted either way so
                aria-controls resolves and so a collapsed field keeps its
                value. */}
            <div
              id={`fields-${group.group}`}
              className={isOpen ? "mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2" : "hidden"}
            >
              {visibleFields.map((field) => (
                <Field
                  key={field.key}
                  field={field}
                  value={answers[field.key] ?? ""}
                  flagReason={flaggedFields?.[field.key]}
                  onChange={(value) => onChange(field.key, value)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
