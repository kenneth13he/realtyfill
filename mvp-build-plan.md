# RealtyFill — MVP Build Plan (Step by Step)

This breaks Phase 1 (Demo) and Phase 2 (MVP) into concrete, ordered build steps. Each step lists the goal, what to actually do, and the "done" condition.

**Read this as the original plan plus how each step actually turned out** — it is kept for the reasoning behind the design decisions, not as a live task list. For what's outstanding today, see `REMAINING_WORK.md`. (An earlier `project-context.md` is referenced in a few places below; it is no longer in the repo.)

---

## Phase 1 — Demo (prove the concept, no real users yet)

Goal: show the parents a real structured-intake → filled-PDF result — across a **realtor-selectable set of forms**, not just the lease — and get an honest reaction.

**Design decision (supersedes the original "LLM extracts everything from messy text" approach):** the deal-specific fields a listing can never supply (tenant names, dates, deposits, smoking rules, insurance, utility split, etc.) will be captured via a **simple structured intake form**, filled in once by the realtor, rather than parsed by an LLM from free-form notes. Reasoning: these fields don't exist anywhere until the deal is negotiated, so there's no messy source document to extract them from anyway — the realtor is always the source. A one-time structured form removes hallucination risk entirely for this data and still delivers the core time-saving pitch ("enter it once, it flows into all five forms instead of retyping the same thing five times"). LLM extraction remains useful only for the property-side data that *does* come from an existing messy/variable-format document (e.g. a REALM listing export) — see Step 4.

### Target form set for the demo
Based on the real 203 College St #1706 deal documents on hand, the demo should support selecting and filling any/all of:
- **2229E** — Residential Tenancy Agreement (Standard Form of Lease) — 93 fields, already schema'd.
- **Form 400** — Agreement to Lease (Residential), incl. Schedule A additional terms.
- **Form 410** — Rental Application (Residential).
- **Form 324** — Confirmation of Co-operation and Representation (Tenant/Landlord).
- **Form 372** — Tenant Designated Representation Agreement (Authority for Lease), incl. Schedule A.

These five share a large amount of overlapping data (tenant/landlord names, property address, rent, term, brokerage info), which is exactly the "Property Profile" reuse case from section 6 of the context doc — worth building for the demo now rather than retrofitting later.

### Step 1 — Lock each form's field schema
- Already have: 93 fillable fields on the 2229E (types: text, radio_group), reverse-engineered radio-group semantics (e.g. `chkOpt_Condo`: `/1`=Yes, `/2`=No).
- Do: for each of Forms 400, 410, 324, 372, run the same field-discovery process (`check_fillable_fields.py` / `extract_form_field_info.py`) to confirm whether each is a real fillable AcroForm (like 2229E) or a flat/scanned layout requiring coordinate-based overlay instead — check this before assuming a uniform pipeline.
- Do: write out each form's full field list as a JSON schema (field_id → type → allowed values), one file per form.
- Done when: five schema files exist (`lease_2229e_schema.json`, `form_400_schema.json`, `form_410_schema.json`, `form_324_schema.json`, `form_372_schema.json`), each covering 100% of that form's fields.

### Step 2 — Define the shared "Property Profile" schema
- Do: identify the fields that repeat across two or more of the five forms (tenant name(s), landlord name, property address/unit, rent amount, lease term/dates, brokerage names, agent names) and define them once as a `deal_profile_schema.json`, with each per-form schema referencing which of its fields map to a profile field vs. which are form-specific.
- Done when: every profile field's mapping into each of the five form schemas is documented (a simple lookup table is enough — profile field → target field_id per form).

### Step 3 — Design the Deal Intake Form schema
- Do: define every deal-specific field a realtor needs to enter once — tenant name(s), landlord name (if not already in the Property Profile), lease start/end dates, rent due-day, deposit amounts, key deposit + count, smoking rules, insurance requirement, utility responsibility split, additional terms, and the per-form-only fields (e.g. Form 410's applicant employment/reference/vehicle sections) — grouped by which of the five forms each field feeds, using `deal_profile_schema.json` (already built) as the backbone for anything shared.
- Done when: an `intake_form_schema.json` exists listing every field the realtor will be asked to fill in, each tagged with which target form(s)/field_id(s) it maps to (reusing the Step 1 raw schemas' field IDs).

### Step 4 — Build the Deal Intake Form (structured UI, not free-text extraction)
- Do: build a simple one-screen (or short multi-step) form — CLI or single HTML page is fine for the demo, no auth/DB needed — that walks the realtor through `intake_form_schema.json` once per deal. Group fields logically (Parties → Property → Rent & Deposits → Terms & Conditions → Brokerage Info) rather than dumping 90+ fields in one flat list.
- Do: separately, still support pulling property-side fields (address, condo status, rent, term) from a pasted REALM listing export to pre-fill the Property Profile portion of the form — this is a simpler structured parse (the listing is already labeled tabular data), not LLM free-text extraction, so it can be a straightforward field-by-field mapping rather than a prompt. Pre-filled property fields should still be editable, since the known traps (heating source ≠ gas-included, A/C-as-feature ≠ A/C-as-service, laundry-as-fixture ≠ on-site-laundry-as-service) mean a naive 1:1 field copy can be wrong.
- Done when: a realtor can fill out one form once for a deal (optionally starting from a pasted listing export) and get back a single `field_values.json` covering every field needed across all five forms — no retyping the same tenant name or address five times.

### Step 5 — Build the form-selection + fill pipeline
- Already have: a fill script that takes a `field_values.json` and produces a filled PDF from a blank AcroForm template (proven on 2229E).
- Do: extend it to (a) accept a list of selected forms, (b) for each selected form, map the intake form's `field_values.json` into that form's own field IDs (per the schemas from Steps 1–3), and (c) output one filled PDF per selected form.
- Done when: running one command with a chosen subset of the five forms (e.g. just 2229E + Form 400, or all five) produces correctly filled PDFs for exactly those forms, straight from the one `field_values.json` — no manual per-form JSON editing.

### Step 6 — Wire the intake form directly to form selection + generation
- Even for a demo, the "human always reviews before anything is generated" principle should be visible, not just claimed.
- Do: after the realtor submits the Step 4 intake form, show a summary/review screen of everything entered, let them check which of the five forms to generate, and let them correct any field before generating.
- Done when: a non-technical person could fill out the intake form, review the summary, select any subset of the five forms, and generate exactly those filled PDFs — start to finish, no manual JSON or CLI steps.

### Step 7 — Package the before/after demo
- Do: put together a short walkthrough — blank intake form → realtor fills it in once (optionally starting from a pasted listing export) → review screen → form selection → five filled PDFs — for showing the parents.
- Done when: you can run the full demo live in under 5 minutes and answer "would you pay for this?" afterward — the honest pitch being "fill this out once instead of five times," not "AI reads your mind from a messy email."

**Phase 1 exit criteria:** parents have seen the real demo — filling out one structured intake form and generating multiple forms from it — and given a genuine reaction (positive or not) on time-saved and willingness to pay.

---

## Phase 2 — Full App / MVP (usable by one real realtor on a real deal)

Goal: a small web app, not a script — someone other than you can run it unassisted.

### Step 8 — Choose and scaffold the stack
- Next.js (React) + Tailwind, Next.js API routes for backend logic to start.
- Do: `create-next-app`, set up Tailwind, basic folder structure (`/app`, `/lib`, `/api`).
- Done when: a blank Next.js app runs locally.

### Step 9 — Auth ✅ Done
- Do: integrate a managed auth provider (Supabase Auth, Clerk, or Auth.js). Email+password to start, magic-link if time allows.
- Done when: a user can sign up, log in, log out, and a logged-out user is redirected away from protected pages.
- **Built with Supabase Auth** (`app/login/`, `proxy.ts`, `lib/supabase/`). Verified directly: signup correctly handles email confirmation being required (doesn't redirect into a session that doesn't exist yet — a real bug caught by testing, not designed in from the start); sign-in establishes a real session; an unauthenticated request to a protected page redirects to `/login`; sign-out actually invalidates the session (confirmed the same cookie is rejected afterward, not just that a redirect happened). Magic-link not done — email+password only, per the "to start" scope here.

### Step 10 — Database + row-level security ✅ Done
- Do: set up Postgres (Supabase or Neon). Core tables: `users` (handled by auth), `deals` (one per property/client relationship, holding the shared Property Profile fields from Phase 1 Step 2), `deal_intake` (the structured intake form's saved answers per deal, from Phase 1 Step 3/4), `form_fills` (generated filled forms + their field values, one row per form per deal).
- Do: enable row-level security so a realtor can only query their own `deals`/`deal_intake`/`form_fills`.
- Done when: querying as user A never returns user B's rows, enforced at the DB level (test this directly, not just through the UI).
- **Built** (`supabase/migrations/0001_init.sql`): `deals`, `deal_intake` (JSONB `answers` blob — same shape the app already used, not normalized into per-field columns, so this was a storage-location swap rather than a data-model rewrite), `generated_forms` (the `form_fills` from this plan, renamed), `profiles` (Step 15's Property Profile persistence — see below). RLS on all four. **Tested directly at the DB level as instructed here**, not just through the UI: created two real accounts, had one try to read and then overwrite the other's `deal_intake` row — the read came back empty, the write was rejected, and the victim's data was confirmed unchanged afterward.

### Step 11 — File storage ✅ Done
- Do: set up private object storage (Supabase Storage or S3), no public bucket access, short-lived signed URLs for the owning user only.
- Done when: uploading a document (e.g. a pasted listing export saved as a PDF) stores it privately and a signed download link works only for its owner.
- **Built** with Supabase Storage: private `generated-forms` bucket, objects at `{user_id}/{dealId}/{form}.pdf`, RLS policies scoped to the same prefix. A generated PDF was downloaded through a real signed URL and its field values inspected with `pypdf` to confirm they were actually correct, not just that a file came back.

### Step 12 — Deal Intake Form UI ✅ Done
- Do: build the page version of the Phase 1 structured intake form (Step 4) — the same field groups (Parties → Property → Rent & Deposits → Terms & Conditions → Brokerage Info), now saving to the `deal_intake` table instead of a local JSON file. Keep the optional "pre-fill property fields from a pasted listing export" path from Phase 1.
- Done when: a realtor can create a `deal` and fill out its intake form through the UI, with answers persisted and re-editable.
- **Built** at `/deals/[dealId]/intake` — the Phase 1 form UI itself (`IntakeForm.tsx`) barely changed; it now takes a `dealId` and calls the Step 10 table instead of a local file. The listing-extraction pre-fill path now also accepts multiple linked files (main sheet + Schedules) read together in one pass.

### Step 13 — Form-selection + review UI ✅ Done
- Do: build the UI (from Phase 1's minimal version, now wired to real data) that lets the realtor pick which of the five supported forms to generate for this `deal`, shows a summary of the intake form's saved answers, and lets the realtor correct any field before generating.
- Done when: edits persist and only the *reviewed* `deal_intake` data is used to generate PDFs.
- **Built** at `/deals/[dealId]/review`, plus more than this step originally scoped: inline field editing directly on the review page (autosaves and silently regenerates already-generated forms), and a free-text "Update with more info" box that extracts and applies corrections via the same Claude pipeline as the listing importer.

### Step 14 — Generate + download filled PDFs ✅ Done
- Do: wire the reviewed intake data into the fill pipeline (already form-selection-aware from Phase 1 Step 5), expose a "Generate" action, store each result in private storage, offer signed download links.
- Done when: a realtor can go from intake form → select forms → review → download correctly filled PDFs for exactly the forms they chose, entirely through the UI.
- **Built**: the fill pipeline itself (`lib/profileMapper.ts`, `lib/pdfFill.ts`) is completely unchanged from Phase 1 — only the input source and output destination moved. Verified the full chain for real: create deal → save intake → generate → download via signed URL → inspect actual field values with `pypdf`.

### Step 15 — Property Profile persistence across sessions ✅ Done (as brokerage defaults; full scope partial)
- Do: persist the `deal`-level Property Profile (already defined as a schema in Phase 1 Step 2) so that returning to the same `deal` later, or generating an additional form for it, reuses the profile without re-entering it.
- Done when: generating a new form for an existing `deal` pre-fills all shared profile fields automatically from the saved intake data, with only that form's own unique fields needing to be filled in.
- **Built, scoped down**: a `profiles` table (Settings page, `/settings`) holds the realtor's own name/phone/brokerage name+address, seeded onto every *new* deal's intake answers at creation — verified end-to-end (saved a profile, created a deal, confirmed its intake answers were pre-filled from the profile). What's still open: this plan's original framing was more about a single deal's *existing* answers being reused across its own multiple forms, which Phase 1's intake→review flow already did implicitly (one shared answer set feeds all five forms via `targets`) — that part needed no new work. A cross-deal "reuse the tenant/landlord from a similar past deal" feature was not built and wasn't asked for.

### Step 16 — Add forms beyond the initial five (as they come up)
- Do: repeat Phase 1 Step 1's per-form work (field-type discovery, schema, radio-group semantics) for the next form the parents actually need beyond 2229E/400/410/324/372 — e.g. Agreement of Purchase and Sale for sales-side deals — and extend the intake form schema to cover its unique fields.
- Done when: the same intake → select → review → generate flow works for the new form, reusing the Property Profile where fields overlap.

### Step 17 — Security pass before any real client data 🟡 Partial
- Do: confirm HTTPS everywhere, secrets in env vars/secrets manager, rate limiting on login/intake endpoints, audit logging (who touched what deal, when), retention/deletion policy defined.
- Done when: each item above is explicitly checked off, not assumed.
- **Done**: rate limiting on `/login` (per-IP) and `/api/extract-listing` (per-user — the one endpoint that costs real money per call) via `lib/rateLimit.ts`, verified by actually triggering it. Every deal-scoped route checks ownership explicitly (`lib/supabase/getOwnedDeal.ts`) in addition to RLS. **Not done**: HTTPS confirmation (no deployment yet — Step 8 above), audit logging, retention/deletion policy.

### Step 18 — Pricing + first real user
- Do: wire up billing (flat $20–30/month) via Stripe or similar once the parents (first real user) are ready to use it on an actual deal.
- Done when: one realtor is using the app on a real client deal, paying or on a trial, with all reviews happening through the UI (no manual script runs).

**Phase 2 exit criteria:** one real realtor completes a real deal's paperwork through the app end-to-end, and you have their direct feedback on time saved vs. their old process.

---

## Explicit non-goals for MVP (from context doc — do not build yet)
- No auto-fill or auto-generation of signatures, ever.
- No MLS/REALM scraping or automated login — input stays "user uploads/pastes/shares one link at a time."
- No usage-based billing — flat monthly only.
- No e-signature integration, team/brokerage tier, or additional provinces — Phase 3, only after real paying users exist.
