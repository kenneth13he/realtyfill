// tests/intakeSections.test.ts
// The rules behind the intake editor's sections.
//
// These became load-bearing when sections started collapsing: `missing === 0`
// used to decide whether a heading said "Complete", and now also decides
// whether a realtor finds that section already folded shut. A group wrongly
// counted as finished doesn't just mislabel a heading, it hides fields that
// still need filling.
//
// Run against the real schema, not a fixture, for the cases where that's the
// point — a hand-written stub would prove the functions are self-consistent
// and say nothing about the 17 groups actually shipping.

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { IntakeField, IntakeFormSchema } from "../lib/formTypes";
import {
  initiallyCollapsedGroupIds,
  fieldIsVisible,
  groupOfField,
  intakeSections,
  isMissingValue,
} from "../components/intakeSections";

const realSchema: IntakeFormSchema = JSON.parse(
  readFileSync(join(__dirname, "..", "forms", "schemas", "intake_form_schema.json"), "utf8"),
);

const field = (over: Partial<IntakeField> & { key: string }): IntakeField =>
  ({ label: over.key, type: "text", ...over }) as IntakeField;

const schemaOf = (groups: { group: string; fields: IntakeField[] }[]) =>
  ({ groups: groups.map((g) => ({ ...g, label: g.group })) }) as IntakeFormSchema;

describe("fieldIsVisible", () => {
  test("a field with no condition is always visible", () => {
    assert.equal(fieldIsVisible(undefined, {}), true);
  });

  test("a condition is met only by an exact match", () => {
    assert.equal(fieldIsVisible("has_pets == 'yes'", { has_pets: "yes" }), true);
    assert.equal(fieldIsVisible("has_pets == 'yes'", { has_pets: "no" }), false);
    assert.equal(fieldIsVisible("has_pets == 'yes'", {}), false);
  });

  test("an unparseable condition shows the field rather than hiding it", () => {
    // Deliberate: a stray field is a moment of confusion, a wrongly hidden
    // one is a blank on a legal form.
    assert.equal(fieldIsVisible("has_pets != 'yes'", { has_pets: "yes" }), true);
  });
});

describe("isMissingValue", () => {
  test("an empty ordinary field is missing", () => {
    assert.equal(isMissingValue(field({ key: "rent" }), {}), true);
    assert.equal(isMissingValue(field({ key: "rent" }), { rent: "2400" }), false);
  });

  test("labels marked optional are never missing", () => {
    assert.equal(isMissingValue(field({ key: "t2", label: "Tenant 2 (optional)" }), {}), false);
  });

  test("checkboxes and derived fields are never missing", () => {
    // An unticked checkbox is an answer; a derived field is computed and
    // read-only, so neither is something a person has left undone.
    assert.equal(isMissingValue(field({ key: "pets", type: "checkbox" }), {}), false);
    assert.equal(isMissingValue(field({ key: "end", derived_from: "start" }), {}), false);
  });
});

describe("intakeSections", () => {
  test("drops groups with nothing visible instead of rendering empty panels", () => {
    const schema = schemaOf([
      { group: "a", fields: [field({ key: "x" })] },
      { group: "b", fields: [field({ key: "y", hidden: true })] },
      { group: "c", fields: [field({ key: "z", condition: "x == 'yes'" })] },
    ]);
    assert.deepEqual(
      intakeSections(schema, {}).map((s) => s.group.group),
      ["a"],
    );
  });

  test("counts only visible fields as missing", () => {
    const schema = schemaOf([
      { group: "a", fields: [field({ key: "x" }), field({ key: "z", condition: "x == 'yes'" })] },
    ]);
    // `z` is hidden while x != 'yes', so it must not be counted against the
    // section — otherwise a group could never reach Complete. With x answered
    // "no" the group is done at one field; answering "yes" reveals z and puts
    // the section back to one empty.
    assert.equal(intakeSections(schema, { x: "no" })[0].missing, 0);
    assert.equal(intakeSections(schema, { x: "yes" })[0].missing, 1);
    assert.equal(intakeSections(schema, { x: "yes", z: "filled" })[0].missing, 0);
  });
});

describe("initiallyCollapsedGroupIds", () => {
  test("a fully answered group is complete, a partly answered one is not", () => {
    const schema = schemaOf([
      { group: "done", fields: [field({ key: "a" })] },
      { group: "part", fields: [field({ key: "b" }), field({ key: "c" })] },
    ]);
    assert.deepEqual([...initiallyCollapsedGroupIds(schema, { a: "1", b: "2" })], ["done"]);
  });

  test("a group whose only fields are hidden is absent, not complete", () => {
    // It would otherwise be collapsed — a section that isn't rendered at all.
    const schema = schemaOf([{ group: "ghost", fields: [field({ key: "a", hidden: true })] }]);
    assert.equal(initiallyCollapsedGroupIds(schema, {}).size, 0);
  });

  test("a group of nothing but checkboxes never starts collapsed", () => {
    // An unticked checkbox is an answer, so such a group is vacuously
    // "complete" before anyone touches it. Form 324's representation group is
    // five checkboxes deciding who represents whom — folding that shut on a
    // new deal would hide a legal choice behind a closed header.
    const schema = schemaOf([
      { group: "reps", fields: [field({ key: "a", type: "checkbox" }), field({ key: "b", type: "checkbox" })] },
    ]);
    assert.equal(initiallyCollapsedGroupIds(schema, {}).size, 0);
    assert.equal(intakeSections(schema, {})[0].missing, 0, "still reports Complete in its heading");
  });

  test("nothing starts collapsed on a brand-new empty deal", () => {
    // The guarantee that matters: a fresh deal looks exactly as it did before
    // sections could collapse. This is the assertion that caught Form 324.
    assert.deepEqual([...initiallyCollapsedGroupIds(realSchema, {})], []);
  });

  test("a fully answered deal collapses every group that asked a question", () => {
    // Fill every field the real schema asks for, then assert each rendered
    // section reports itself complete. Catches a group that can never reach
    // Complete because of a condition that can't be satisfied.
    const answers: Record<string, string> = {};
    for (const group of realSchema.groups) {
      for (const f of group.fields) answers[f.key] = f.options?.[0]?.value ?? "x";
    }
    const sections = intakeSections(realSchema, answers);
    assert.deepEqual(
      sections.filter((s) => s.missing > 0).map((s) => s.group.group),
      [],
    );

    // Every section except the checkbox-only ones, which stay open by the
    // rule above even once the deal is finished.
    const expected = sections
      .filter((s) => s.visibleFields.some((f) => f.type !== "checkbox" && !f.derived_from && !f.label.toLowerCase().includes("(optional)")))
      .map((s) => s.group.group);
    assert.deepEqual([...initiallyCollapsedGroupIds(realSchema, answers)].sort(), [...expected].sort());
    assert.ok(expected.length > 0, "sanity: the real schema has groups that ask questions");
  });
});

describe("groupOfField", () => {
  test("finds the group holding a real field key", () => {
    const first = realSchema.groups[0];
    assert.equal(groupOfField(realSchema, first.fields[0].key), first.group);
  });

  test("returns undefined for a key that isn't in the schema", () => {
    // The reveal path relies on this: an unknown key must not throw, it must
    // simply expand nothing and leave the focus attempt to fail quietly.
    assert.equal(groupOfField(realSchema, "not_a_field"), undefined);
  });
});
