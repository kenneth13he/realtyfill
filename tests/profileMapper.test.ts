// tests/profileMapper.test.ts
// The mapping layer is where every silent form-filling bug so far has lived:
// a wrong value lands in a real PDF and nothing errors, so these are the
// checks that would have caught them.

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import { isSignatureField, withComputedValues, mapIntakeToFormFields } from "../lib/profileMapper";
import { getIntakeFormSchema } from "../lib/schemas";

describe("isSignatureField", () => {
  test("blocks real signature fields on the legacy WEBForms templates", () => {
    for (const id of ["txtSignature1", "txtLandlordSig", "sigTenant", "txtSignatureDate"]) {
      assert.equal(isSignatureField(id), true, `${id} should be treated as a signature field`);
    }
  });

  test("allows the printed-NAME columns that merely look like signature fields", () => {
    // 2229E page 7 prints "Name | Signature | Date" but only the Name column
    // is fillable — see the NAME_FIELD_EXCEPTION comment in profileMapper.
    for (const id of ["txtbuyersig1", "txtsellersig2", "txtTenant1Sig"]) {
      assert.equal(isSignatureField(id), false, `${id} is a printed-name field, not a signature`);
    }
  });

  test("does not misfire on ordinary English inside synthesized field ids", () => {
    // The regression: a loose /sig/i substring match blanked the
    // designated-representative line on Forms 271, 272 and 371, and the
    // conveyance time on Form 244, because "deSIGnated"/"asSIGned" contain
    // "sig". Synthesized ids are matched on whole words instead.
    for (const id of [
      "p1_designated_representative_s",
      "p2_assigned_to",
      "p3_consigned_goods",
      // "SIGNED, SEALED AND DELIVERED ... on the ___ day of ___" is a date
      // blank sitting under a signature caption, not a signature itself.
      "p1_signed_and_delivered_on",
    ]) {
      assert.equal(isSignatureField(id), false, `${id} is not a signature field`);
    }
  });

  test("still blocks genuine signature blanks on synthesized templates", () => {
    for (const id of ["p1_signature", "p2_sig", "p4_signature_of_buyer", "p1_signed_by"]) {
      assert.equal(isSignatureField(id), true, `${id} should be treated as a signature field`);
    }
  });
});

describe("withComputedValues", () => {
  test("builds a one-line address the way a listing writes it", () => {
    const out = withComputedValues({
      property_street_number: "203",
      property_street_name: "College St",
      property_unit_number: "1706",
      property_city: "Toronto C01",
      property_province: "ON",
      property_postal_code: "M5T 1P9",
    });
    // Not "1706 203 College St", which is what a naive join produces.
    assert.equal(out.property_address_oneline, "203 College St #1706, Toronto C01 ON M5T 1P9");
  });

  test("does not double the # a user already typed", () => {
    const out = withComputedValues({
      property_street_number: "203",
      property_street_name: "College St",
      property_unit_number: "#1706",
      property_city: "Toronto",
    });
    assert.ok(out.property_address_oneline.startsWith("203 College St #1706,"));
    assert.ok(!out.property_address_oneline.includes("##"));
  });

  test("splits ISO dates into the day/month/year blanks these forms print", () => {
    const out = withComputedValues({ agreement_date: "2026-09-15" });
    assert.equal(out.agreement_date_day, "15");
    assert.equal(out.agreement_date_month, "September");
    assert.equal(out.agreement_date_year, "26");
  });

  test("leaves non-ISO values alone rather than guessing", () => {
    const out = withComputedValues({ some_note: "15/09/2026" });
    assert.equal(out.some_note_day, undefined);
    assert.equal(out.some_note_month, undefined);
  });

  test("never overwrites a value the caller already supplied", () => {
    const out = withComputedValues({
      agreement_date: "2026-09-15",
      agreement_date_month: "Sept",
      property_address_oneline: "hand-written address",
      property_street_number: "203",
      property_street_name: "College St",
    });
    assert.equal(out.agreement_date_month, "Sept");
    assert.equal(out.property_address_oneline, "hand-written address");
  });
});

describe("mapIntakeToFormFields", () => {
  const schema = getIntakeFormSchema();

  test("never writes into a signature field, on any form", () => {
    // Fill every key the schema knows about, so this exercises the widest
    // possible set of targets rather than a hand-picked few.
    const everything: Record<string, string> = {};
    for (const group of schema.groups) {
      for (const field of group.fields) everything[field.key] = "X";
    }

    for (const formId of ["2229e", "form_400", "form_410", "form_324", "form_372",
                          "form_101", "form_303", "form_320", "form_371", "form_801",
                          "form_203", "form_244", "form_271", "form_272", "form_401"] as const) {
      const filled = mapIntakeToFormFields(everything, formId, schema);
      const signatures = filled.filter((f) => isSignatureField(f.field_id));
      assert.deepEqual(signatures, [], `${formId} would write into signature fields`);
    }
  });

  test("skips empty answers instead of writing blanks over the template", () => {
    const filled = mapIntakeToFormFields({ property_city: "" }, "form_303", schema);
    assert.equal(filled.length, 0);
  });

  test("resolves each target to the page the field actually lives on", () => {
    const everything: Record<string, string> = {};
    for (const group of schema.groups) {
      for (const field of group.fields) everything[field.key] = "X";
    }
    const filled = mapIntakeToFormFields(everything, "form_101", schema);
    assert.ok(filled.length > 0, "form_101 should map at least one field");
    for (const f of filled) {
      assert.ok(Number.isInteger(f.page) && f.page >= 1, `bad page ${f.page} for ${f.field_id}`);
    }
  });
});

// PropTx's board data forms print dates as MM / DD / YYYY in three captioned
// boxes. The OREA trio can't fill those: _month is a word because OREA writes
// dates out, and _year is two digits because OREA pre-prints the "20".
describe("numeric date parts for the MLS data forms", () => {
  const out = withComputedValues({ listing_start_date: "2026-09-05" });

  test("month is a zero-padded number, not a word", () => {
    assert.equal(out.listing_start_date_month_num, "09");
    assert.equal(out.listing_start_date_month, "September"); // unchanged for OREA
  });

  test("year is four digits, not two", () => {
    assert.equal(out.listing_start_date_year_full, "2026");
    assert.equal(out.listing_start_date_year, "26"); // unchanged for OREA
  });

  test("day is zero-padded", () => {
    assert.equal(out.listing_start_date_day_num, "05");
    assert.equal(out.listing_start_date_day, "5"); // unchanged for OREA
  });
});

// 291/292 print AREA, MUNICIPALITY and COMMUNITY as three separate columns,
// so the TRREB district code that property_city deliberately carries for
// OREA's single address line does not belong in the municipality box.
describe("municipality without the district code", () => {
  test("strips a trailing TRREB code", () => {
    assert.equal(
      withComputedValues({ property_city: "Toronto C01" }).property_municipality_only,
      "Toronto"
    );
  });

  test("leaves a plain city alone", () => {
    assert.equal(
      withComputedValues({ property_city: "Mississauga" }).property_municipality_only,
      "Mississauga"
    );
  });

  test("does not eat a real part of a place name", () => {
    assert.equal(
      withComputedValues({ property_city: "Stoney Creek" }).property_municipality_only,
      "Stoney Creek"
    );
  });
});
