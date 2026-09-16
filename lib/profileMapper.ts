// lib/profileMapper.ts
// Maps one set of Deal Intake Form answers (keyed by intake_form_schema.json's
// field "key"s) into the [{field_id, page, value}] list scripts/fill_fillable_fields.py
// needs to fill one specific PDF (keyed by that form's own field IDs, per
// forms/schemas/<form>_raw.json).
//
// This is the "Property Profile reuse" logic: a single intake answer like
// tenant1_full_name fans out to txtbuyer1 on Form 400, txtbuyer1 + txtbuyersig1
// on Form 410/324/372 — see forms/schemas/deal_profile_schema.json for the
// full mapping table this was built from.
//
// Radio/checkbox fields are stored in intake answers as their value code
// already (e.g. "/1", "/2") since app/intake's UI writes the code, not the
// human label — see IntakeField.options in lib/schemas.ts.

import { FormId, IntakeFormSchema, RawFieldInfo, getIntakeFormSchema, getRawFormSchema } from "./schemas";
import { numberToWords } from "./numberToWords";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Values that aren't typed by the user but are assembled from ones that are.
 *
 * Computed here rather than in the client-side derived-answers hook because
 * generation reads whatever is stored in Postgres: anything only ever
 * computed in the browser is missing when answers arrive some other way (the
 * extraction endpoint writes them directly). Doing it at map time means the
 * value is always present and always consistent with its sources.
 *
 * Three kinds:
 *  - `property_address_oneline` — the address fields joined, because the new
 *    forms give one blank for the whole address where 2229E gives six boxes.
 *  - `<key>_words` for money — OREA forms print an amount twice, in digits
 *    and in words.
 *  - `<key>_day` / `_month` / `_year` for every date — these forms write
 *    dates as "the ___ day of ___, 20___", three separate blanks — plus
 *    `<key>_long` ("September 15, 2026") for forms with one date box.
 */
export function withComputedValues(answers: Record<string, string>): Record<string, string> {
  const out = { ...answers };

  // "203 College St #1706", the way a listing writes it — not "1706 203
  // College St", which is what a naive join produces.
  const unit = (answers.property_unit_number ?? "").trim();
  const streetLine = [
    [answers.property_street_number, answers.property_street_name]
      .map((p) => (p ?? "").trim())
      .filter(Boolean)
      .join(" "),
    unit ? (unit.startsWith("#") ? unit : `#${unit}`) : "",
  ]
    .filter(Boolean)
    .join(" ");
  const cityLine = [answers.property_city, answers.property_province, answers.property_postal_code]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" ");
  const oneline = [streetLine, cityLine].filter(Boolean).join(", ");
  if (oneline && !out.property_address_oneline) out.property_address_oneline = oneline;

  // property_city deliberately carries the TRREB district code appended to
  // the city ("Toronto C01"), because OREA forms give one address line and
  // the code has nowhere else to go. PropTx's board data forms (291/292)
  // print AREA, MUNICIPALITY and COMMUNITY as three separate columns, so
  // putting "Toronto C01" in the municipality box is wrong there.
  const city = (answers.property_city ?? "").trim();
  if (city) out.property_municipality_only ??= city.replace(/\s+[A-Z]\d{2}$/i, "").trim();

  for (const [key, target] of [
    ["purchase_price_amount", "purchase_price_words"],
    ["purchase_deposit_amount", "purchase_deposit_words"],
    // Was computed only by lib/useDerivedIntakeAnswers, which runs in the
    // browser. Answers can reach generation without either page having
    // rendered — the extraction endpoint writes straight to Postgres — and
    // Form 400's written-out rent then printed blank.
    ["monthly_rent_amount", "monthly_rent_words"],
    // 271/272 print the list price in words beside the digits, the same way
    // 101 prints the purchase price.
    ["listing_price", "listing_price_words"],
  ] as const) {
    if (answers[key] && !out[target]) out[target] = numberToWords(answers[key]);
  }

  // ISO yyyy-mm-dd is what <input type="date"> stores; anything else is left
  // alone rather than guessed at.
  for (const [key, value] of Object.entries(answers)) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value ?? "").trim());
    if (!m) continue;
    const [, year, month, day] = m;
    const monthName = MONTHS[Number(month) - 1];
    if (!monthName) continue;
    out[`${key}_day`] ??= String(Number(day));
    out[`${key}_month`] ??= monthName;
    out[`${key}_year`] ??= year.slice(2);
    // OREA forms split a date across three blanks; a form with a single date
    // box wants it written the way a person writes it. "2026-09-15" on a
    // document a client signs looks like a database field, not a date.
    out[`${key}_long`] ??= `${monthName} ${Number(day)}, ${year}`;

    // PropTx's MLS Data Information Forms (291/292) print dates as
    // MM / DD / YYYY in three labelled boxes — a numeric month and a FOUR
    // digit year, neither of which the three above can supply. `_year` is
    // "26" because OREA pre-prints the "20" and leaves two blanks; putting
    // that in a box captioned YYYY prints the year as 26. `_month` is
    // "September" because OREA writes dates in words; a box captioned MM
    // wants 09. Separate keys rather than changing the originals, which are
    // right for the forms they were built for.
    out[`${key}_month_num`] ??= month;
    out[`${key}_day_num`] ??= day;
    out[`${key}_year_full`] ??= year;
  }

  return out;
}

export interface FillableField {
  field_id: string;
  page: number;
  value: string;
}

// Signature fields are never written to, on any form, per the project's firm
// product/legal boundary — matched by common naming patterns across all five forms.
const SIGNATURE_FIELD_PATTERN = /sig|Signature/i;

// Exception: txtbuyersig#/txtsellersig#/txtTenantNSig are the printed-NAME
// column of each landlord/tenant signature row, not the signature itself,
// despite the misleading "sig" in their field ID — confirmed by inspecting
// the actual PDF layout (2229E page 7: each row prints "Name | Signature |
// Date" as three columns, but only ONE fillable field exists per row, and
// its rect (x: 17.7-251.7 of a ~612pt page) lines up with the leftmost
// "Name" column only — the real Signature/Date columns have no fillable
// field at all, so there's nothing for this exception to accidentally
// collide with). This file's own header comment already documented these
// exact fields as intended fill targets before the blanket pattern above
// was added and silently broke that — this restores it precisely rather
// than loosening the rule for every "sig"-named field on every form.
const NAME_FIELD_EXCEPTION = /^txt(?:buyer|seller)sig\d+$|^txtTenant\dSig$/;

// The forms added by scripts/add_form_fields.py name every field after the
// label printed beside it (`p1_designated_representative_s`), so the loose
// substring rule above misfires on ordinary English: "de-SIG-nated",
// "SIG-ned", "as-SIG-ned" are not signature fields, and silently dropping
// them left the designated-representative line blank on Forms 271, 272 and
// 371. These ids are matched on whole words instead. Their real signature
// lines are label-less (the caption sits under the rule, not beside it), so
// they end up as unnamed `_cont` fields that nothing maps to.
const SYNTHESIZED_FIELD_ID = /^p\d+_/;
const SIGNATURE_WORD = /(?:^|_)(?:sig|sign|signature|signatures|signed_by)(?:_|$)/i;

export function isSignatureField(fieldId: string): boolean {
  if (SYNTHESIZED_FIELD_ID.test(fieldId)) return SIGNATURE_WORD.test(fieldId);
  return SIGNATURE_FIELD_PATTERN.test(fieldId) && !NAME_FIELD_EXCEPTION.test(fieldId);
}

export function mapIntakeToFormFields(
  intakeAnswers: Record<string, string>,
  formId: FormId,
  schema: IntakeFormSchema = getIntakeFormSchema(),
  rawFields: RawFieldInfo[] = getRawFormSchema(formId)
): FillableField[] {
  const pageByFieldId = new Map(rawFields.map((f) => [f.field_id, f.page]));
  const answers = withComputedValues(intakeAnswers);
  const out: FillableField[] = [];

  for (const group of schema.groups) {
    for (const field of group.fields) {
      const targetIds = field.targets[formId];
      if (!targetIds) continue;

      const answer = answers[field.key];
      if (answer === undefined || answer === null || answer === "") continue;

      for (const fieldId of targetIds) {
        if (isSignatureField(fieldId)) continue;
        const page = pageByFieldId.get(fieldId);
        if (page === undefined) continue; // field not present on this form/page — skip rather than error
        out.push({ field_id: fieldId, page, value: answer });
      }
    }
  }

  return out;
}
