// tests/schemaIntegrity.test.ts
// Structural checks across the four form sets. These catch the class of bug
// that produced Form 244's shifted date parts and Form 101's mis-placed
// purchase price: a `targets` entry naming a field id that doesn't exist on
// that form fails silently — mapIntakeToFormFields just skips it, the PDF
// generates fine, and the blank stays empty. Nothing errors, so only a check
// like this one notices.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test, describe } from "node:test";

import { getIntakeFormSchema, getRawFormSchema } from "../lib/schemas";
import { FORM_SETS, FORM_SET_IDS, FORM_LABELS, ALL_FORM_IDS, BLANK_ONLY_FORM_IDS, SHARED_FORM_IDS, blankTemplateDir, filterSchemaForSet, type FormId } from "../lib/formTypes";

const TEMPLATES_DIR = path.join(process.cwd(), "forms", "blank_templates");
const schema = getIntakeFormSchema();

// PropTx 291/292 are deliberately in no set and have no extracted schema.
const formsInSets = new Set<FormId>(ALL_FORM_IDS);

describe("form sets", () => {
  test("every set's forms have a readable field schema", () => {
    for (const setId of FORM_SET_IDS) {
      for (const formId of FORM_SETS[setId].formIds) {
        const fields = getRawFormSchema(formId);
        // 291/292 are delivered as blanks and legitimately have none — but
        // only those two, checked against the declared list so a form that
        // loses its fields by accident still fails here.
        if (BLANK_ONLY_FORM_IDS.includes(formId)) {
          assert.equal(fields.length, 0, `${formId} is declared blank-only but has fields`);
        } else {
          assert.ok(fields.length > 0, `${formId} (${setId}) has an empty field schema`);
        }
      }
    }
  });

  test("every set's blank templates exist on disk where the generate route looks", () => {
    for (const setId of FORM_SET_IDS) {
      const set = FORM_SETS[setId];
      for (const formId of set.formIds) {
        // blankTemplateDir, not set.templateDir: shared forms live in shared/.
        const file = path.join(TEMPLATES_DIR, blankTemplateDir(setId, formId), `${formId}_blank.pdf`);
        assert.ok(fs.existsSync(file), `missing template: ${file}`);
      }
    }
  });

  test("every form id has a human label", () => {
    for (const formId of Object.keys(FORM_LABELS) as FormId[]) {
      assert.ok(FORM_LABELS[formId]?.length > 0, `${formId} has no label`);
    }
    for (const formId of formsInSets) {
      assert.ok(FORM_LABELS[formId], `${formId} is in a set but has no label`);
    }
  });

  test("no form appears in two sets, apart from the shared ones", () => {
    const seen = new Map<FormId, string>();
    for (const setId of FORM_SET_IDS) {
      for (const formId of FORM_SETS[setId].formIds) {
        if (SHARED_FORM_IDS.includes(formId)) continue;
        const prior = seen.get(formId);
        assert.equal(prior, undefined, `${formId} is in both ${prior} and ${setId}`);
        seen.set(formId, setId);
      }
    }
  });

  test("every shared form is in every set", () => {
    // RECO must be given to every client in every transaction, so a set
    // missing it is a compliance gap, not a styling choice.
    for (const shared of SHARED_FORM_IDS) {
      for (const setId of FORM_SET_IDS) {
        assert.ok(FORM_SETS[setId].formIds.includes(shared), `${setId} is missing ${shared}`);
      }
    }
  });
});

describe("intake schema targets", () => {
  test("every target names a field that actually exists on that form", () => {
    const problems: string[] = [];
    for (const group of schema.groups) {
      for (const field of group.fields) {
        for (const [formId, targetIds] of Object.entries(field.targets) as [FormId, string[]][]) {
          if (!formsInSets.has(formId)) continue; // 291/292 have no schema by design
          const known = new Set(getRawFormSchema(formId).map((f) => f.field_id));
          for (const id of targetIds) {
            if (!known.has(id)) problems.push(`${field.key} -> ${formId}.${id}`);
          }
        }
      }
    }
    assert.deepEqual(problems, [], `targets pointing at non-existent fields:\n  ${problems.join("\n  ")}`);
  });

  test("field keys are unique across the whole schema", () => {
    const seen = new Set<string>();
    for (const group of schema.groups) {
      for (const field of group.fields) {
        assert.ok(!seen.has(field.key), `duplicate intake key: ${field.key}`);
        seen.add(field.key);
      }
    }
  });

  test("radio fields declare their options", () => {
    for (const group of schema.groups) {
      for (const field of group.fields) {
        if (field.type === "radio") {
          assert.ok((field.options?.length ?? 0) > 0, `${field.key} is a radio with no options`);
        }
      }
    }
  });

  test("checkbox targets use the /1 and /Off pair the editor hardcodes", () => {
    // components/IntakeFieldsEditor.tsx writes literally "/1" or "/Off" for
    // every checkbox rather than reading per-field values, so a checkbox
    // whose PDF uses a different on-state would fail the Python validator at
    // generate time — after the user has filled everything in.
    const problems: string[] = [];
    for (const group of schema.groups) {
      for (const field of group.fields) {
        if (field.type !== "checkbox") continue;
        for (const [formId, targetIds] of Object.entries(field.targets) as [FormId, string[]][]) {
          if (!formsInSets.has(formId)) continue;
          const byId = new Map(getRawFormSchema(formId).map((f) => [f.field_id, f]));
          for (const id of targetIds) {
            const info = byId.get(id);
            if (!info || info.type !== "checkbox") continue; // covered by the targets test above
            if (info.checked_value !== "/1" || info.unchecked_value !== "/Off") {
              problems.push(`${field.key} -> ${formId}.${id} (on=${info.checked_value}, off=${info.unchecked_value})`);
            }
          }
        }
      }
    }
    assert.deepEqual(problems, [], `checkboxes the editor can't set correctly:\n  ${problems.join("\n  ")}`);
  });

  test("a field's `sets` only names sets whose forms it actually targets", () => {
    // A field restricted to sets it can't fill is dead weight; a field left
    // unrestricted that only targets one set's forms asks every deal a
    // question most of them don't need.
    for (const group of schema.groups) {
      for (const field of group.fields) {
        if (!field.sets) continue;
        for (const setId of field.sets) {
          assert.ok(FORM_SETS[setId], `${field.key} names unknown set ${setId}`);
        }
      }
    }
  });
});

describe("filterSchemaForSet", () => {
  test("each set gets a non-empty, strictly smaller-or-equal question list", () => {
    const total = schema.groups.reduce((n, g) => n + g.fields.length, 0);
    for (const setId of FORM_SET_IDS) {
      const filtered = filterSchemaForSet(schema, setId);
      const count = filtered.groups.reduce((n, g) => n + g.fields.length, 0);
      assert.ok(count > 0, `${setId} filtered down to zero questions`);
      assert.ok(count <= total, `${setId} somehow gained questions`);
    }
  });

  test("drops groups that end up with no fields", () => {
    for (const setId of FORM_SET_IDS) {
      for (const group of filterSchemaForSet(schema, setId).groups) {
        assert.ok(group.fields.length > 0, `${setId} kept empty group ${group.group}`);
      }
    }
  });

  test("a set's questions can fill at least one field on each of its forms", () => {
    for (const setId of FORM_SET_IDS) {
      const visible = filterSchemaForSet(schema, setId);
      for (const formId of FORM_SETS[setId].formIds) {
        if (BLANK_ONLY_FORM_IDS.includes(formId)) continue; // nothing to fill, by design
        const reachable = visible.groups.some((g) => g.fields.some((f) => f.targets[formId]?.length));
        assert.ok(reachable, `${setId}: no visible question targets ${formId}`);
      }
    }
  });
});

// A date on these forms is not one blank, it is two to four side by side:
// "the ___ day of ______, 20__" on OREA's, and MM / DD / YYYY on PropTx's
// board data forms. Mapping some of the parts and not the rest produces a
// document that generates cleanly and prints a date with a hole in it, which
// no other check here notices — the ids all exist, they are just not all used.
//
// This shipped: Forms 271/272 printed a listing agreement whose expiry date
// read "31 ________ 26", because listing_expiry_date_month was never created
// as a key, and 291/292 had the same hole in both of their dates.
describe("split date blanks", () => {
  const PART = /^(.*?)_(d|dd|mm|mmmm|yy|yyyy)$/;

  test("a date is either fully mapped or not mapped at all", () => {
    for (const formId of ALL_FORM_IDS) {
      const targeted = new Set(
        schema.groups.flatMap((g) => g.fields.flatMap((f) => f.targets[formId] ?? []))
      );
      const groups = new Map<string, { id: string; mapped: boolean }[]>();
      for (const { field_id } of getRawFormSchema(formId)) {
        const m = PART.exec(field_id);
        if (!m) continue;
        const list = groups.get(m[1]) ?? [];
        list.push({ id: field_id, mapped: targeted.has(field_id) });
        groups.set(m[1], list);
      }
      for (const [base, parts] of groups) {
        const filled = parts.filter((p) => p.mapped);
        if (filled.length === 0) continue; // the whole date is unmapped: fine
        const blank = parts.filter((p) => !p.mapped).map((p) => p.id);
        assert.deepEqual(
          blank,
          [],
          `${formId}: ${base} would print partially filled — ${blank.join(", ")} has no intake key`
        );
      }
    }
  });
});
