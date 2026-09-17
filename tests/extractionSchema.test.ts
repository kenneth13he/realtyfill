// tests/extractionSchema.test.ts
// Guards the bug where "Bob is Buyer" on a purchase deal came back flagged as
// ambiguous against `tenant1_full_name`.
//
// The cause wasn't the model's judgment — it was that the extraction tool
// schema was a hardcoded list of 34 lease fields, so on a sale deal there was
// no buyer field for the answer to land in and the closest match really was
// the tenant. These assert that each set is offered its own vocabulary and
// nobody else's.

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import { buildFieldSchema, buildSystemPrompt } from "../app/api/extract-listing/route";
import { FORM_SET_IDS, filterSchemaForSet } from "../lib/formTypes";
import { getIntakeFormSchema } from "../lib/schemas";

const LEASE_WORDS = /tenant|landlord|rent(?!al_application)/;
// "irrevocable" is deliberately absent. It reads like sale vocabulary and is
// not: Form 400, the Agreement to Lease, carries the same IRREVOCABILITY
// block as Form 101, printing "(Landlord/Tenant)" where 101 prints
// "(Seller/Buyer)". This list is a guard against a set being offered the
// other transaction's questions, and a word that genuinely belongs to both
// cannot do that job.
const SALE_WORDS = /buyer|seller|purchase|completion/;

describe("buildFieldSchema", () => {
  test("a purchase deal is never offered a tenant, landlord or rent field", () => {
    for (const setId of ["sale_buyer", "sale_seller"] as const) {
      const leaked = Object.keys(buildFieldSchema(setId)).filter((k) => LEASE_WORDS.test(k));
      assert.deepEqual(leaked, [], `${setId} was offered lease fields: ${leaked.join(", ")}`);
    }
  });

  test("a lease deal is never offered a buyer, seller or purchase field", () => {
    for (const setId of ["lease_tenant", "lease_landlord"] as const) {
      const leaked = Object.keys(buildFieldSchema(setId)).filter((k) => SALE_WORDS.test(k));
      assert.deepEqual(leaked, [], `${setId} was offered sale fields: ${leaked.join(", ")}`);
    }
  });

  test("the buyer-side set actually has somewhere to put a buyer's name", () => {
    // The literal reported case.
    assert.ok(buildFieldSchema("sale_buyer").buyer_full_name, "no buyer_full_name on sale_buyer");
    assert.ok(buildFieldSchema("sale_seller").seller_full_name, "no seller_full_name on sale_seller");
    assert.ok(buildFieldSchema("lease_tenant").tenant1_full_name, "no tenant1_full_name on lease_tenant");
  });

  test("every set gets a non-trivial field list", () => {
    for (const setId of FORM_SET_IDS) {
      assert.ok(Object.keys(buildFieldSchema(setId)).length > 20, `${setId} has too few fields`);
    }
  });

  test("hidden computed fields are never offered", () => {
    // Split names, date parts and amounts-in-words are derived by
    // profileMapper; letting the model set them directly would fight it.
    for (const setId of FORM_SET_IDS) {
      const offered = new Set(Object.keys(buildFieldSchema(setId)));
      for (const group of filterSchemaForSet(getIntakeFormSchema(), setId).groups) {
        for (const field of group.fields) {
          if (field.hidden) assert.ok(!offered.has(field.key), `${setId} offers hidden field ${field.key}`);
        }
      }
    }
  });

  test("every offered field declares a JSON type", () => {
    for (const setId of FORM_SET_IDS) {
      for (const [key, spec] of Object.entries(buildFieldSchema(setId))) {
        assert.ok(spec.type, `${setId}.${key} has no type`);
      }
    }
  });
});

describe("buildSystemPrompt", () => {
  test("names the right parties for each set", () => {
    assert.match(buildSystemPrompt("sale_buyer"), /PURCHASE/);
    assert.match(buildSystemPrompt("sale_buyer"), /no tenant, no landlord and no rent/);
    assert.match(buildSystemPrompt("sale_seller"), /SALE/);
    assert.match(buildSystemPrompt("lease_tenant"), /LEASE/);
    assert.match(buildSystemPrompt("lease_landlord"), /LANDLORD/);
  });

  test("never tells a purchase deal it is a rental", () => {
    for (const setId of ["sale_buyer", "sale_seller"] as const) {
      assert.ok(!/rental deal/i.test(buildSystemPrompt(setId)), `${setId} prompt still says "rental deal"`);
    }
  });
});
