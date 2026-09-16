// components/IntakeFieldsEditor.tsx
// The grouped intake-field renderer — one section per schema group, one
// input per visible field — shared by app/intake/IntakeForm.tsx (the
// full "New/Edit Deal" page) and app/review/ReviewForm.tsx's inline editor,
// so both present/edit fields identically instead of drifting apart.

"use client";

import type { IntakeField, IntakeFormSchema } from "@/lib/formTypes";

export function fieldIsVisible(condition: string | undefined, answers: Record<string, string>): boolean {
  if (!condition) return true;
  const match = condition.match(/^(\w+)\s*==\s*'([^']*)'$/);
  if (!match) return true;
  const [, key, expected] = match;
  return answers[key] === expected;
}

export const intakeInputClasses =
  "rf-field";

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

/**
 * Is this field one a person still has to fill in?
 *
 * Same rule the red asterisk uses in `Field` above — kept in one place so the
 * per-field marker and the section counts can never disagree about what
 * "missing" means.
 */
function isMissingValue(field: IntakeField, answers: Record<string, string>): boolean {
  if (field.label.toLowerCase().includes("(optional)")) return false;
  if (field.type === "checkbox") return false;
  if (field.derived_from) return false;
  return !answers[field.key];
}

export default function IntakeFieldsEditor({
  schema,
  answers,
  flaggedFields,
  onChange,
}: {
  schema: IntakeFormSchema;
  answers: Record<string, string>;
  flaggedFields?: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  // Computed once per render and reused by both the nav and the sections, so
  // the jump links and the headings always show the same numbers.
  const sections = schema.groups
    .map((group) => {
      const visibleFields = group.fields.filter((field) => !field.hidden && fieldIsVisible(field.condition, answers));
      const missing = visibleFields.filter((field) => isMissingValue(field, answers)).length;
      return { group, visibleFields, missing };
    })
    .filter((section) => section.visibleFields.length > 0);

  const totalMissing = sections.reduce((sum, section) => sum + section.missing, 0);

  return (
    <div className="flex flex-col gap-6">
      {/* The whole schema used to render as one undifferentiated scroll with
          no sense of position or of what was left. This is the cheap version
          of that fix: where you are, what's outstanding, and one click to
          each section. `sticky top-0` keeps it reachable from anywhere in a
          long form. */}
      <nav
        aria-label="Intake sections"
        className="sticky top-0 z-10 -mx-1 flex flex-col gap-2 rf-panel/95 px-4 py-3 backdrop-blur"
      >
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          {totalMissing === 0
            ? "All fields filled"
            : `${totalMissing} ${totalMissing === 1 ? "field" : "fields"} still empty`}
        </p>
        <ul className="flex flex-wrap gap-1.5">
          {sections.map(({ group, missing }) => (
            <li key={group.group}>
              <a
                href={`#section-${group.group}`}
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
        return (
          <div
            key={group.group}
            id={`section-${group.group}`}
            /* scroll-mt clears the sticky nav above — without it a jump link
               lands with the heading hidden behind the bar. */
            className="scroll-mt-28 rf-panel p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-[var(--color-text)]">{group.label}</h2>
              <span className="text-xs font-medium tabular-nums text-[var(--color-text-muted)]">
                {missing === 0
                  ? "Complete"
                  : `${missing} of ${visibleFields.length} empty`}
              </span>
            </div>
            {group.note && <p className="mt-1 text-sm text-[var(--color-text-muted)]">{group.note}</p>}
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
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
