// scripts/fill_audit.ts
// Half one of the offline fill audit. Answers every question in every set with
// a unique traceable token, maps them onto every form, and writes the result
// for scripts/fill_audit.py to fill and read back.
//
// Why a token rather than realistic prose: after filling, the audit reads each
// field's value straight out of the PDF and checks it is the token belonging
// to the intake key that claimed that target. That catches a whole class of
// bug a realistic fixture hides — two keys writing to the same box, a value
// silently truncated by the field's /MaxLen, or a comb field dropping
// characters — none of which raise an error anywhere in the pipeline.
//
// Costs nothing to run: no model call, no network. Extraction is checked in
// the same pass by building the real tool schema for each set and confirming
// every field it offers resolves to something fillable.
//
//   npx tsx scripts/fill_audit.ts [outDir]

import fs from "node:fs";
import path from "node:path";

import { ANSWER_KEY_OVERRIDES, buildFieldSchema } from "../app/api/extract-listing/route";
import { FORM_SETS, FORM_SET_IDS, SHARED_FORM_IDS, filterSchemaForSet, type FormId } from "../lib/formTypes";
import { mapIntakeToFormFields, withComputedValues } from "../lib/profileMapper";
import { getIntakeFormSchema, getRawFormSchema } from "../lib/schemas";

const outDir = process.argv[2] ?? path.join(process.cwd(), ".fill-audit");
fs.mkdirSync(outDir, { recursive: true });

const schema = getIntakeFormSchema();

/**
 * One distinct, short answer per intake key.
 *
 * Short because these forms are full of narrow boxes with a /MaxLen, and a
 * long fixture would truncate everywhere and drown the real findings. Dates
 * stay real ISO dates so profileMapper's derived parts (_day, _month_num,
 * _year_full, _words) compute from them the way they do in production.
 */
function syntheticAnswers(): { answers: Record<string, string>; tokenOf: Record<string, string> } {
  const answers: Record<string, string> = {};
  const tokenOf: Record<string, string> = {};
  let n = 0;

  for (const group of schema.groups) {
    for (const field of group.fields) {
      // Derived keys are written by withComputedValues, not answered.
      if (field.hidden && /_(day|month|year|words|long|num|full|only)$/.test(field.key)) continue;
      n += 1;
      const id = String(n).padStart(3, "0");
      let value: string;
      switch (field.type) {
        case "radio":
        case "checkbox":
          value = field.options?.[0]?.value ?? "/1";
          break;
        case "date":
          // Spread across the calendar so a day/month swap is visible.
          value = `20${26 + (n % 3)}-${String((n % 12) + 1).padStart(2, "0")}-${String((n % 27) + 1).padStart(2, "0")}`;
          break;
        case "currency":
        case "number":
          value = String(1000 + n);
          break;
        default:
          value = `K${id}`;
      }
      answers[field.key] = value;
      tokenOf[field.key] = value;
    }
  }
  return { answers, tokenOf };
}

const { answers, tokenOf } = syntheticAnswers();
const computed = withComputedValues(answers);

const report: Record<string, unknown> = {
  generatedAt: new Date().toISOString(),
  answerCount: Object.keys(answers).length,
  computedCount: Object.keys(computed).length,
  sets: {},
};

for (const setId of FORM_SET_IDS) {
  const visible = filterSchemaForSet(schema, setId);
  const visibleKeys = new Set(visible.groups.flatMap((g) => g.fields.map((f) => f.key)));

  // The extraction tool schema for this set, built exactly as the route does.
  const toolSchema = buildFieldSchema(setId);

  const forms: Record<string, unknown> = {};
  for (const formId of FORM_SETS[setId].formIds as FormId[]) {
    const raw = getRawFormSchema(formId);
    const byId = new Map(raw.map((f) => [f.field_id, f]));
    const targets = mapIntakeToFormFields(answers, formId, visible, raw);

    // Which intake key claimed each target, so the Python half can say whose
    // value should be in a given box.
    const owner: Record<string, string> = {};
    for (const group of visible.groups) {
      for (const field of group.fields) {
        for (const id of field.targets[formId] ?? []) {
          if (!byId.has(id)) continue;
          owner[id] = field.key;
        }
      }
    }

    forms[formId] = {
      targets,
      owner,
      rawFieldCount: raw.length,
      types: Object.fromEntries(raw.map((f) => [f.field_id, f.type])),
    };
  }

  (report.sets as Record<string, unknown>)[setId] = {
    label: FORM_SETS[setId].label,
    templateDir: FORM_SETS[setId].templateDir,
    formIds: FORM_SETS[setId].formIds,
    visibleQuestions: visibleKeys.size,
    toolSchema,
    // Every key the model may return, so the audit can confirm each one is a
    // real answer key that reaches at least one box.
    toolKeys: Object.keys(toolSchema),
    forms,
  };
}

// A date's targets live on its computed parts, not on the date itself, so
// the audit needs to know which parent a derived key belongs to.
const derivedParents: Record<string, string> = {};
for (const group of schema.groups) {
  for (const field of group.fields) {
    const m = /^(.*)_(day|month|year|day_num|month_num|year_full|long|words)$/.exec(field.key);
    if (m && schema.groups.some((g) => g.fields.some((f) => f.key === m[1]))) derivedParents[field.key] = m[1];
    if (field.derived_from) derivedParents[field.key] = field.derived_from;
  }
}

fs.writeFileSync(
  path.join(outDir, "targets.json"),
  JSON.stringify(
    { ...report, sharedFormIds: SHARED_FORM_IDS, answerKeyOverrides: ANSWER_KEY_OVERRIDES, derivedParents, answers, computed, tokenOf },
    null,
    1
  )
);
console.log(`wrote ${path.join(outDir, "targets.json")}`);
for (const setId of FORM_SET_IDS) {
  const s = (report.sets as Record<string, any>)[setId];
  const filled = Object.values(s.forms).reduce((n: number, f: any) => n + f.targets.length, 0);
  console.log(`  ${setId.padEnd(16)} ${String(s.visibleQuestions).padStart(3)} questions, ${String(s.toolKeys.length).padStart(3)} extractable, ${filled} boxes across ${s.formIds.length} forms`);
}
