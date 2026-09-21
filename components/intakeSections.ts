// components/intakeSections.ts
// The rules that decide what the intake editor shows and what it counts as
// done, pulled out of components/IntakeFieldsEditor.tsx so they can be tested
// against the real schema.
//
// They lived inside the component until sections became collapsible. That
// made the "is this group finished?" rule load-bearing in a new way: it now
// decides which sections a realtor finds already folded away when they reopen
// a half-filled deal. A rule that only ever drew a red asterisk can be wrong
// quietly; a rule that hides fields cannot.

import type { IntakeField, IntakeFormSchema } from "@/lib/formTypes";

/**
 * Does this field's `condition` hold against the current answers?
 *
 * Conditions in the schema are a single `key == 'value'` comparison. Anything
 * this doesn't recognise is treated as visible: showing a field that should
 * have been hidden costs a realtor a moment of confusion, hiding one that
 * should have been shown costs them a blank on a legal form.
 */
export function fieldIsVisible(condition: string | undefined, answers: Record<string, string>): boolean {
  if (!condition) return true;
  const match = condition.match(/^(\w+)\s*==\s*'([^']*)'$/);
  if (!match) return true;
  const [, key, expected] = match;
  return answers[key] === expected;
}

/**
 * Is this field one a person still has to fill in?
 *
 * The same rule behind the red asterisk on a field and the counts in the
 * section headers and jump links, kept in one place so they can never
 * disagree about what "missing" means.
 *
 * Labels are the only signal the schema gives for "genuinely optional" —
 * see item 10 in REMAINING_WORK.md, where a review-page summary warning was
 * built on this rule and then removed because `"(optional)"` is too crude a
 * proxy for required. It's adequate for a per-field marker and for a count
 * next to a heading; it is not a validation gate, and nothing should turn it
 * into one without a real per-form notion of required.
 */
export function isMissingValue(field: IntakeField, answers: Record<string, string>): boolean {
  if (field.label.toLowerCase().includes("(optional)")) return false;
  if (field.type === "checkbox") return false;
  if (field.derived_from) return false;
  return !answers[field.key];
}

export interface IntakeSection {
  group: IntakeFormSchema["groups"][number];
  visibleFields: IntakeField[];
  missing: number;
}

/**
 * The groups worth rendering, each with its visible fields and how many of
 * them are still empty. Groups with nothing visible are dropped entirely
 * rather than rendered as an empty panel.
 */
export function intakeSections(schema: IntakeFormSchema, answers: Record<string, string>): IntakeSection[] {
  return schema.groups
    .map((group) => {
      const visibleFields = group.fields.filter((field) => !field.hidden && fieldIsVisible(field.condition, answers));
      const missing = visibleFields.filter((field) => isMissingValue(field, answers)).length;
      return { group, visibleFields, missing };
    })
    .filter((section) => section.visibleFields.length > 0);
}

/**
 * Group ids that should start collapsed: the ones the realtor has already
 * finished.
 *
 * Two conditions, and the second is not obvious. A group qualifies only if
 * every visible field is filled *and* it contains at least one field that
 * could have been reported missing in the first place.
 *
 * Without that second condition a group made entirely of checkboxes is
 * vacuously "complete" the moment the deal is created, because an unticked
 * checkbox is an answer (see `isMissingValue`). The Form 324 representation
 * group is exactly that — five checkboxes deciding who represents whom and
 * which brokerage pays — and it would have started folded shut on a brand-new
 * deal, hiding the representation choices behind a closed header. A section
 * nobody has touched must never open collapsed.
 *
 * A group with no visible fields isn't complete here, it's absent:
 * `intakeSections` has already dropped it, and returning it would collapse a
 * section that isn't rendered.
 */
export function initiallyCollapsedGroupIds(
  schema: IntakeFormSchema,
  answers: Record<string, string>,
): Set<string> {
  const answerable = (field: IntakeField) =>
    !field.label.toLowerCase().includes("(optional)") && field.type !== "checkbox" && !field.derived_from;

  return new Set(
    intakeSections(schema, answers)
      .filter((section) => section.missing === 0 && section.visibleFields.some(answerable))
      .map((section) => section.group.group),
  );
}

/**
 * Which group holds `key`, so a reveal request can open that section before
 * trying to focus the input inside it.
 */
export function groupOfField(schema: IntakeFormSchema, key: string): string | undefined {
  return schema.groups.find((group) => group.fields.some((field) => field.key === key))?.group;
}
