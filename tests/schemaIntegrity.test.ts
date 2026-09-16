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
  // The suffix vocabulary is PropTx's and OREA's, not ours, and it is wider
  // than it first looks: d/dd, m/mm/mmmm, y/yy/yyyy all appear. The first
  // version of this test only matched the two-letter forms and so walked
  // straight past Form 371's txtExpiringDate_m.
  const PART = /^(.*?)_(d|dd|m|mm|mmmm|y|yy|yyyy)$/;

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

// A question is worth asking only if its answer reaches a box on a form in
// the set being filled. The intake was asking 32 questions in the
// lease-landlord set alone whose every target was a lease-tenant form — the
// realtor typed the landlord's mailing address, the key deposit and the
// co-op brokerage into a set that prints none of them, and the extraction
// tool offered all 32 to the model, so we paid tokens for answers we threw
// away. Found by scripts/fill_audit.py; kept honest here.
describe("questions reach a box in every set that asks them", () => {
  // A date's targets sit on its computed parts, not on the date itself.
  const DERIVED = /^(.*)_(day|month|year|day_num|month_num|year_full|long|words)$/;

  // Deliberately answerable with nowhere to print. condo_apt_unit_no exists
  // so the model has a correct home for a suite number instead of putting it
  // on the condominium legal-description line — see lib/claude.ts and
  // scripts/extraction_eval.ts. Anything else here is an open question, not
  // a design decision: see ISSUES.md.
  const NO_BOX_BY_DESIGN = new Set(["condo_apt_unit_no", "property_address_oneline"]);

  test("no set offers a question none of its forms can print", () => {
    const keys = new Set(schema.groups.flatMap((g) => g.fields.map((f) => f.key)));
    const extra = new Map<string, Set<FormId>>();
    for (const group of schema.groups) {
      for (const field of group.fields) {
        const m = DERIVED.exec(field.key);
        const parent = field.derived_from ?? (m && keys.has(m[1]) ? m[1] : null);
        if (!parent) continue;
        const bucket = extra.get(parent) ?? new Set<FormId>();
        for (const f of Object.keys(field.targets) as FormId[]) bucket.add(f);
        extra.set(parent, bucket);
      }
    }

    for (const setId of FORM_SET_IDS) {
      const inSet = new Set<FormId>(FORM_SETS[setId].formIds);
      for (const group of filterSchemaForSet(schema, setId).groups) {
        for (const field of group.fields) {
          if (NO_BOX_BY_DESIGN.has(field.key)) continue;
          const reach = new Set<FormId>([
            ...(Object.keys(field.targets) as FormId[]),
            ...(extra.get(field.key) ?? []),
          ]);
          const lands = [...reach].some((f) => inSet.has(f));
          assert.ok(
            lands,
            `${setId} asks "${field.key}" but none of its forms (${[...inSet].join(", ")}) has a box for it`
          );
        }
      }
    }
  });
});

// The split-date test above asks whether every part of a date is mapped. It
// says nothing about WHAT is mapped to them, and that is a second bug with
// the same consequences: Form 400 aimed the raw `lease_start_date` at all
// three of txtp_closedate_mmmm / _d / _yyyy at once, so the Agreement to
// Lease printed its commencement date as "2028-05-18 / 2028- / 2028". Form
// 372 did the same with both of its authority dates. Nine boxes, and every
// completeness check passed the whole time.
describe("date-part boxes get date parts", () => {
  const BOX_PART = /_(d|dd|m|mm|mmmm|y|yy|yyyy)$/;
  const KEY_PART = /_(day|month|year|day_num|month_num|year_full)$/;

  test("no raw date or plain text is aimed at a box that wants one part of a date", () => {
    const bad: string[] = [];
    for (const group of schema.groups) {
      for (const field of group.fields) {
        if (KEY_PART.test(field.key)) continue;
        for (const [formId, ids] of Object.entries(field.targets)) {
          for (const id of ids ?? []) {
            if (BOX_PART.test(id)) bad.push(`${field.key} (${field.type}) -> ${formId}.${id}`);
          }
        }
      }
    }
    assert.deepEqual(bad, [], `these write a whole value into one box of a split date:\n  ${bad.join("\n  ")}`);
  });

  test("a date's parts never all point at the same box", () => {
    for (const group of schema.groups) {
      for (const field of group.fields) {
        for (const [formId, ids] of Object.entries(field.targets)) {
          const parts = (ids ?? []).filter((i) => BOX_PART.test(i));
          assert.ok(
            parts.length <= 1,
            `${field.key} targets ${parts.length} date-part boxes on ${formId} (${parts.join(", ")}) — one value cannot be the day AND the month AND the year`
          );
        }
      }
    }
  });
});

// A box's /MaxLen is enforced by the viewer, not by us: pypdf stores whatever
// it is given and the PDF reader shows the first N characters. So a value
// that is too long is not an error anywhere in the pipeline — it is simply a
// form that prints "On" where it should say "ON", which is what the province
// default did on nine forms.
describe("fixed values fit the boxes they are written into", () => {
  test("every schema default fits its targets' /MaxLen", () => {
    for (const group of schema.groups) {
      for (const field of group.fields) {
        if (!field.default) continue;
        for (const [formId, ids] of Object.entries(field.targets)) {
          const raw = getRawFormSchema(formId as FormId);
          for (const id of ids ?? []) {
            const box = raw.find((f) => f.field_id === id);
            if (!box?.max_len) continue;
            assert.ok(
              field.default.length <= box.max_len,
              `${field.key}'s default ${JSON.stringify(field.default)} is ${field.default.length} characters but ${formId}.${id} holds ${box.max_len} — it would print as ${JSON.stringify(field.default.slice(0, box.max_len))}`
            );
          }
        }
      }
    }
  });
});

// The mirror of "questions reach a box": a box whose question exists but is
// not asked in the set that prints it. Group filtering makes this easy to do
// by accident — a field in a group scoped to one set cannot appear in another
// no matter what it targets.
//
// This shipped on eight boxes. Forms 203 and 401 print "Schedule ___ ...
// dated the ___ day of ___", and the agreement_date questions lived in the
// Offer Terms group, which is sale_buyer only — so a schedule generated for a
// seller or a landlord carried no date identifying the agreement it attaches
// to. Forms 271 and 272 print "Schedule A, ___" with the same problem.
describe("every box a set prints can be filled by that set", () => {
  test("no form has a target whose question the set never asks", () => {
    const unreachable: string[] = [];
    for (const setId of FORM_SET_IDS) {
      const inSet = new Set<FormId>(FORM_SETS[setId].formIds);
      const asked = new Set(
        filterSchemaForSet(schema, setId).groups.flatMap((g) => g.fields.map((f) => f.key))
      );
      for (const group of schema.groups) {
        for (const field of group.fields) {
          if (asked.has(field.key)) continue;
          for (const [formId, ids] of Object.entries(field.targets)) {
            if (!inSet.has(formId as FormId)) continue;
            for (const id of ids ?? []) {
              unreachable.push(`${setId}: ${formId}.${id} needs "${field.key}", which ${setId} never asks`);
            }
          }
        }
      }
    }
    assert.deepEqual(unreachable, [], `\n  ${unreachable.join("\n  ")}`);
  });
});
