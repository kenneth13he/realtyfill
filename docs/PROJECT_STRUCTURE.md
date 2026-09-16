# Project Structure — task & checklist per file

Every file below has a matching header comment in the file itself. This doc is the one-page index — use it to see the whole app's shape and what's left, without opening every file. Update both (the file's header comment and this doc) together when a file's job changes.

> **⚠️ This index is behind the code (last full pass: the five-lease-form Phase 2 build).** The per-file entries below are still accurate for the files they name, but whole areas are missing and a few statements are now wrong. It predates: the Vercel deployment and the `pdf-service/` Service (PDF filling is an HTTP call now, not a local `child_process` shell-out); the other three form sets (lease–landlord, sale–buyer, sale–seller — ~10 more forms, `scripts/add_form_fields.py`); the `tests/` suite (91 `node:test` cases — anywhere below that says "no automated tests", there are); `app/terms`, `app/privacy`, `app/reset-password`, `app/support`, `app/admin`; and everything in `components/` (`Header`, `Wordmark`, `Spinner`, `LegalPage`, `landing/`). **`REMAINING_WORK.md` is the current source of truth for status**; treat this file as a map of `lib/`, `scripts/` and `forms/`, not as a checklist.

Status legend: 🔲 not started · 🟡 stubbed (header comment + TODOs, no logic) · ✅ implemented

---

## `app/` — frontend (Next.js App Router)

### `app/layout.tsx` ✅
Root layout wrapping every page. No CSS/theming yet.

### `app/page.tsx` ✅ (Phase 2)
Logged-out landing page. A signed-in visit redirects straight to `/dashboard`; signed-out sees the pitch + Sign in/Sign up links. Auth check via `lib/supabase/server.ts`.

### `proxy.ts` ✅ (Phase 2)
Next 16 renamed `middleware.ts` → `proxy.ts` (same mechanism). Refreshes the Supabase session cookie on every request and redirects an unauthenticated visitor away from `/deals/*`, `/dashboard`, `/settings` to `/login`. API routes are excluded from its matcher and check auth themselves (per Next's own guidance not to rely on proxy alone for that).

### `app/login/page.tsx` ✅ + `app/login/actions.ts` ✅ (Phase 2)
Combined sign-in/sign-up form. Server Actions handle `signIn`/`signUp`/`signOut` against Supabase Auth, rate-limited per-IP (`lib/rateLimit.ts`). `signUp` correctly detects when email confirmation is required (`data.session` is null) and shows a "check your email" message instead of redirecting into a session that doesn't exist yet — found by testing, not designed in from the start.

### `app/auth/callback/route.ts` ✅ (Phase 2)
Where Supabase's email-confirmation link points; exchanges the one-time code for a real session.

### `app/dashboard/page.tsx` ✅ + `app/dashboard/DealsList.tsx` ✅ (Phase 2)
The multi-deal dashboard — create a deal, filter by status (Active/Closed/Archived — this is "history" for now, not a field-level audit log), Close/Reopen/Archive actions.

### `app/settings/page.tsx` ✅ + `app/settings/SettingsForm.tsx` ✅ (Phase 2)
Profile + brokerage defaults (`profiles` table), seeded onto every new deal's intake answers on creation.

### `app/deals/[dealId]/intake/page.tsx` ✅ + `IntakeForm.tsx` ✅ (Phase 2 — was `app/intake/`)
The Deal Intake Form for one deal, scoped by `dealId` in the URL. Server component (`page.tsx`) reads `deal_intake.answers` from Postgres (RLS-scoped) instead of the old `data/deal.json`; client component (`IntakeForm.tsx`) is otherwise unchanged from Phase 1.
- [x] Render each group from the schema
- [x] Field-level input types (`text`, `currency`, `date`, `radio` → `<select>`, `checkbox`, `long_text`)
- [x] Conditional fields (e.g. deposit amount only shown if `rent_deposit_required == '/2'`)
- [x] Submit handler → `POST /api/intake`
- [x] Listing pre-fill flow across most of the intake form (not just Property — also deposits, insurance, commission, holdover, brokerage info), via `/api/extract-listing` (Claude) — supports both pasting text and uploading a listing PDF directly; pre-filled values stay fully editable
- [x] Fields the model wasn't confident enough to fill show an italic "Not filled from listing — `<reason>`" hint instead of a guessed value; editing the field by hand clears the hint. (The "ASSUMED — VERIFY" badge for confidently-guessed utility fields was removed per user request — those fields now render the same as any other pre-filled field, no special marker.)
- [x] `monthly_rent_words` auto-derives from `monthly_rent_amount` (`lib/numberToWords.ts`) instead of being typed — renders read-only, visually distinct (muted background/text) so it's clear it's computed, not editable. Verified against the real ground-truth values from the filled Form 400 ("$3,900.00" → "Three Thousand Nine Hundred", "$7,800.00" → "Seven Thousand Eight Hundred").
- [ ] Client-side validation (currently relies on native HTML input types only — an empty required field can be submitted)
- [ ] Human-readable per-field labels are used, but there's no "required" visual indicator yet

### `app/deals/[dealId]/review/page.tsx` ✅ + `ReviewForm.tsx` ✅ (Phase 2 — was `app/review/`)
Review + form-selection screen for one deal. Server component reads `deal_intake.answers` and `generated_forms` from Postgres instead of `data/deal.json` — also means revisiting a deal now shows its previously-generated PDFs instead of looking freshly empty, since output actually persists in Storage now (Phase 1 output was ephemeral local files scoped to one demo deal, so this case couldn't previously arise).
- [x] Summary of intake answers grouped and labeled via the schema (not raw keys)
- [x] Checkboxes for the five target forms
- [x] Submit handler → `POST /api/deals/[dealId]/generate`
- [x] Generated forms are clickable rows, not plain download links — clicking one expands an inline `<iframe>` preview (`?inline=1` on the download route, now redirecting to a signed Storage URL) using the browser's own native PDF viewer.
- [x] Inline "Edit answers" toggle on the review page itself (`components/IntakeFieldsEditor.tsx`, shared with the intake page) — edits autosave and, if forms were already generated, silently regenerate them
- [x] "Update with more info" — paste free text (an email, a correction, a Schedule PDF) and matching fields update via `/api/extract-listing`, regenerating affected forms automatically
- [ ] Only show/require fields relevant to the *currently checked* forms

---

## `app/api/` — backend (Next.js Route Handlers)

### `app/api/deals/route.ts` ✅ (Phase 2) + `app/api/deals/[dealId]/route.ts` ✅
List/create deals (`GET`/`POST /api/deals`); update label/status (`PATCH /api/deals/[dealId]`). Creating a deal seeds its intake answers from the user's `profiles` row (brokerage defaults) and inserts an empty `deal_intake` row.

### `app/api/deals/[dealId]/intake/route.ts` ✅ (Phase 2 — was `app/api/intake/`)
Persists one deal's intake answers to the `deal_intake` table (Postgres, RLS-scoped to the signed-in user) instead of `data/deal.json`.
- [x] `POST` upserts the full answer map; `GET` returns it
- [x] Every route under `app/api/deals/[dealId]/*` checks ownership explicitly via `lib/supabase/getOwnedDeal.ts` before touching anything, on top of RLS enforcing it at the DB level regardless — verified with two real accounts (one attempting to overwrite the other's data gets a clean 404, not a raw Postgres RLS error, and the victim's data is confirmed untouched afterward)
- [ ] Validate body against `intake_form_schema.json` / reject unknown keys (currently accepts anything)

### `app/api/deals/[dealId]/generate/route.ts` ✅ (Phase 2 — was `app/api/generate/`)
Fill pipeline endpoint — turns one deal's reviewed intake answers into filled PDFs. The fill pipeline itself (`lib/profileMapper.ts`, `lib/pdfFill.ts`) is untouched; only where the input comes from and the output goes changed.
- [x] Loads `deal_intake.answers`, maps each selected form via `lib/profileMapper.ts`, fills via `lib/pdfFill.ts` to a temp file, uploads the bytes to Supabase Storage (`generated-forms` bucket, path `{user_id}/{dealId}/{form}.pdf`), records the result in `generated_forms`
- [x] Returns `{ form, downloadUrl }[]`
- [x] **Hard rule enforced**: `lib/profileMapper.ts` strips any field_id matching a signature-field naming pattern before it ever reaches the fill step
- [x] Verified end-to-end including the actual filled values (`pypdf` inspection of a real downloaded PDF, not just "the request succeeded")

### `app/api/deals/[dealId]/download/[form]/route.ts` ✅ (Phase 2 — was `app/api/download/[form]/`)
Looks up the deal's `generated_forms` row and redirects to a short-lived Supabase Storage signed URL, instead of reading local `data/output/`.
- [x] `?inline=1` omits the signed URL's `download` option so the PDF renders inline in the browser's native viewer; without it, `download` is set to the form's real filename, forcing a save-as.

### `app/api/extract-listing/route.ts` ✅
The one AI-assisted endpoint in the app. Accepts either pasted listing text (JSON `{text}`) or an uploaded listing PDF (`multipart/form-data`). A PDF is sent to Claude **natively as a `document` content block** (base64) — not pre-flattened to text — so the model reads the real page layout (e.g. REALM's two-column property-info table) instead of a linearized wall of text. Both input paths converge on the same Claude call (`lib/claude.ts`, forced tool use).

**Design**: rather than a fixed rule ("utility fields always guess 'not included' when the listing is silent"), the model itself decides per field whether it's confident enough to fill it. Every field lands in one of two output channels:
- **`fields`** — the model is confident (directly stated, or a safe real-estate convention applies). Mapped into `answers` and pre-fills the form like any other field.
- **`flagged`** — the model isn't confident, with a short reason. Left blank in the form with an inline "Not filled from listing — `<reason>`" hint instead of a guessed value.

(An earlier version also returned `inferredKeys` for the six utility fields specifically, driving an "ASSUMED — VERIFY" badge on confidently-guessed utility fields. Removed per user request — those fields no longer render any different from other pre-filled fields. The `flagged`/blank-with-reason path is unaffected and remains the real safety mechanism.)

This replaced an earlier version that force-guessed the six utility fields with a blanket "silence = not included" rule — found wrong in real testing (the real signed lease for 203 College St had A/C included despite the listing never saying so, while gas — also unstated — really was excluded). The user found a Python prototype using this fields/flagged tool-use pattern and asked to port the approach in.

- [x] Verified against the real 203 College St listing PDF across 6+ separate real API calls (not a single lucky run): all 22 directly-stated fields (address, landlord, deposits, insurance, commission, holdover, both brokerage sides correctly disambiguated) came back correct every time.
- [x] **Honest finding, not glossed over**: whether `ac_included` specifically gets flagged vs. confidently guessed is genuinely non-deterministic — across 6 real calls with the same input it split roughly evenly, even after tightening the prompt's self-check instruction (see below). This is inherent model stochasticity on a genuine judgment call, not something a prompt tweak fully eliminates. Worth knowing if this field's behavior looks inconsistent between demo runs — since the "ASSUMED — VERIFY" badge was removed, a confidently-guessed `ac_included` now looks the same as any other pre-filled field, so the `flagged` path (blank + reason) is the only remaining visible signal that something was uncertain.
- [x] Bumped `max_tokens` 4096 → 8192 and clarified the self-check instruction after finding it was itself introducing a regression: an early version of the "re-scan before finalizing" instruction pushed the model to convert legitimately-flagged fields into guesses (verified: 3/3 native-PDF runs guessed `ac_included` instead of flagging it, where the pre-self-check version had flagged it correctly). Reworded to explicitly say the re-scan is for catching *reading* errors, not for lowering the confidence bar on fields already correctly flagged as ambiguous — this measurably helped (1/3 flagged correctly afterward, up from 0/3) but per the finding above, didn't eliminate the non-determinism.
- [x] Explicit brokerage disambiguation instruction in the prompt — an earlier version swapped listing vs. co-op brokerage because it read the "Prepared By" header (whoever printed the report) as signal for which side is which; found by checking output against a real filled Form 400, fixed by telling the model to key off the "LISTING CONTRACTED WITH" / "CO-OP" headings instead and ignore "Prepared By" entirely
- [ ] No retry/fallback on API errors — currently just surfaces the error to the UI
- [ ] No file-size limit on the upload yet
- [x] Phase 2: requires auth (401 if not signed in) and is rate-limited per-user (60/hour, `lib/rateLimit.ts`) — the one endpoint in the app that costs real money per call
- [x] Accepts multiple linked files at once (main listing sheet + Schedule/Addendum attachments), sent to Claude together as separate document blocks in one message, since a fact (e.g. rent payment method) is often only stated on a Schedule
- [x] Receives the deal's already-saved answers as context so it can resolve references (a name/brokerage matching one on file) instead of flagging them as ambiguous, and treats phrasing like "change X's last name to Y" as a direct instruction to execute rather than a fact to second-guess
- [x] Response is validated as a real object before use, with one automatic retry — the model's forced tool-use response was observed to occasionally (rare, non-deterministic) return malformed data, which would otherwise silently corrupt `deal_intake` via the autosave path

---

## `lib/` — shared logic (used by both frontend and backend)

### `lib/formTypes.ts` ✅
Client-safe types and constants (`FormId`, `IntakeFormSchema`, `FORM_LABELS`, `ALL_FORM_IDS`) — no `fs` import, so client components can import it without Turbopack pulling Node built-ins into the browser bundle (this split exists because the first version didn't have it and broke the build — see fix history below).

### `lib/schemas.ts` ✅
Server-only: reads/parses `forms/schemas/*.json`, re-exports everything from `formTypes.ts` for convenience.
- [x] `getIntakeFormSchema()`, `getRawFormSchema(formId)`
- [ ] `getDealProfileSchema()` was speced but hasn't been needed yet — `deal_profile_schema.json` was superseded in practice by `intake_form_schema.json`'s own per-field `targets`, which already encodes the same reuse mapping directly. Consider whether `deal_profile_schema.json` is still worth keeping as a separate file or should be treated as historical/reference-only.

### `lib/profileMapper.ts` ✅
Maps intake answers → one form's `[{field_id, page, value}]` list (the exact shape `scripts/fill_fillable_fields.py` expects).
- [x] Walks `intake_form_schema.json`'s fields, resolves each target's page via the raw schema
- [x] Skips any field_id matching `/sig|Signature/i` — the hard "never touch a signature field" rule
- [x] Verified against real filled PDFs (inspected actual output `/V` values post-generation, not just "no errors thrown")
- [x] Covered by `tests/profileMapper.test.ts` and `tests/schemaIntegrity.test.ts` — including the check that every intake `targets` entry names a field id that really exists on that form, which is the failure mode that fails silently (blank box on a valid PDF)

### `lib/pdfFill.ts` ✅
Fills one blank template, writes the output PDF.
- [x] **Decision made**: keep the proven Python fill logic rather than port it to a JS lib.
- [x] **Superseded**: Python *was* the deployment constraint it warns about below. It no longer shells out via `child_process.execFile` — it `POST`s to the `pdf-service/` Vercel Service (`PDF_SERVICE_URL`), which runs the same `fill_fillable_fields.py`. `scripts/fill_fillable_fields.py` is now a thin CLI wrapper importing that same module.

### `lib/claude.ts` ✅ (current)
Wrapper around the Anthropic API for the listing-extraction feature. Model `claude-opus-5` at `effort: "medium"` (bumped up from an earlier `"low"` once extraction started requiring real judgment — deciding fields vs. flagged, not just reading values off a page — rather than the speed/cost trade of a purely mechanical task). Reads `ANTHROPIC_API_KEY` from `.env.local` (gitignored; `.env.example` documents the variable).
- [x] Replaced `lib/ollama.ts` as the active path after real-PDF testing: `gpt-oss:20b` (local, 20B reasoning model) took ~60-90s and non-deterministically mis-applied the "feature ≠ included service" instruction across runs; `llama3.2:3b` (local, fast) was ~10x faster but reliably misparsed the address format ("203 College St 1706" → street number 1706, unit null) on repeated tries. Claude: ~6s total, every field correct, on the real listing PDF.
- [x] Uses forced tool use (`tool_choice: {type: "tool", ...}`) with a JSON Schema `input_schema` instead of asking for JSON in prose and regex-extracting it — Anthropic validates the shape server-side, so there's no more markdown-fence-stripping/parse-failure surface. `claudeExtractWithTool<T>()` is generic so any future tool-based extraction call can reuse it.

### `lib/ollama.ts` 🟡 (kept for reference / offline use)
The original local-model path. No longer called by `app/api/extract-listing/route.ts`, but left in place — useful if the app ever needs to run fully offline/free, at the cost of the speed/accuracy tradeoffs documented in `lib/claude.ts`'s header.

### `lib/supabase/{server,client,admin}.ts` ✅ (Phase 2)
Supabase clients: `server.ts` for Server Components/Route Handlers/Server Actions (session via cookies, `@supabase/ssr`), `client.ts` for the few places that need the browser client directly, `admin.ts` for the service-role key (bypasses RLS — server-only, used sparingly and never as a substitute for an ownership check).

### `lib/supabase/getOwnedDeal.ts` ✅ (Phase 2)
Explicit "does this deal belong to the signed-in user" check, used at the top of every `/api/deals/[dealId]/*` route before anything else. RLS already blocks a non-owner's write regardless (verified directly), but checking first avoids leaking a raw Postgres RLS error message and gives every route the same clean 404 either way (doesn't exist vs. not yours look identical to the caller).

### `lib/rateLimit.ts` ✅ (Phase 2)
Minimal in-memory sliding-window limiter — deliberately not Redis-backed, since Step 9 already commits to a single persistent Node host rather than serverless/multi-instance. Used by `app/login/actions.ts` (per-IP) and `app/api/extract-listing/route.ts` (per-user).

### `lib/splitFullName.ts` ✅ + `lib/useDerivedIntakeAnswers.ts` ✅
Splits "First Last" for fields that need separate first/last name boxes (2229E), and the shared hook that keeps `monthly_rent_words`/tenant first-last-name fields in sync with their source field — used by both the intake and review pages so they can't drift apart.

### `lib/numberToWords.ts` ✅
Converts a numeric string to Title Case words for the `monthly_rent_words` field on Form 400 (`txtp_rentwords`), which expects the rent written out (e.g. "Three Thousand Nine Hundred"), not digits. Used by `app/intake/IntakeForm.tsx` to auto-derive that field from `monthly_rent_amount` instead of asking the realtor to type it twice.
- [x] Verified against the real ground-truth values from the filled Form 400 you shared: "3900.00" → "Three Thousand Nine Hundred", "7800.00" → "Seven Thousand Eight Hundred" (exact match), plus edge cases (cents, six-figure amounts, zero, empty string).

---

## `scripts/` — Python PDF helpers (prototype, proven working)

### `scripts/check_fillable_fields.py` ✅
Confirms whether a given PDF has real AcroForm fields or is flat/scanned. Used in Step 1 to confirm all five forms are genuinely fillable.

### `scripts/extract_form_field_info.py` ✅ (bug fixed)
Dumps a PDF's full field list (id, type, page, position, radio/checkbox value codes) to JSON. **Had a real bug**: silently dropped any text field appearing as multiple widgets across pages (its multi-widget handling only covered checkbox/radio fields) — this caused Form 400 to be missing 20 fields (`txtbuyer1`, `txtseller1`, the whole address) and Form 372 to be missing 6, discovered by inspecting actual generated PDF output and finding blank tenant/landlord/address fields. Fixed; all five raw schemas regenerated and re-verified PII-clean.

### `scripts/fill_fillable_fields.py` ✅
Takes a blank template + a `field_values.json` and writes a filled output PDF. Proven end-to-end across all five forms. **No longer called by `lib/pdfFill.ts`** — the logic moved to `pdf-service/fill_fillable_fields.py` (which the deployed Service imports) and this is now a thin CLI wrapper over it, so there is one copy rather than two. Validation errors print to stderr, not stdout.

### `scripts/blank_fillable_fields.py` ✅
Clears every field's value from a filled PDF to produce a true blank template, scanning every page's own annotations. Used to produce `forms/blank_templates/*_blank.pdf`.

**Removed**: `scripts/extract_pdf_text.py` and `lib/pdfText.ts` (pypdf-based text extraction for uploaded listing PDFs) — superseded once `/api/extract-listing` started sending PDFs to Claude natively as a `document` content block instead of pre-flattening them to text. Deleted rather than left as unused dead code, per this project's own convention.

---

## `forms/` — data (see `forms/schemas/README.md` for its own detailed status table)

- `forms/schemas/*_raw.json` ✅ — raw field structure per form (2229E: 93, Form 400: 108, Form 410: 121, Form 324: 48, Form 372: 48 — 418 fields total)
- `forms/schemas/deal_profile_schema.json` 🟡 — built early, largely superseded by `intake_form_schema.json`'s own `targets` mapping (see `lib/schemas.ts` note above)
- `forms/schemas/intake_form_schema.json` ✅ — live, driving the actual `/intake` UI. Known gaps unchanged from before: Form 410's full field set isn't fully itemized (only the fields with no other source are listed), Form 400's non-gas/electricity/sewage/condo-fee utility checkboxes aren't individually exposed, Form 324's alternate representation scenarios aren't covered.
- `forms/blank_templates/*_blank.pdf` ✅ — true blank templates, verified PII-clean, used live by the fill pipeline

---

## MVP status: Phase 2 (accounts + multi-deal) working end-to-end

Verified flow: sign up (email confirmation handled correctly) → `/dashboard` → create a deal → `/deals/[dealId]/intake` (optionally pre-filled from a pasted listing or uploaded PDF(s)) → `POST /api/deals/[dealId]/intake` → `/deals/[dealId]/review` → select forms → `POST /api/deals/[dealId]/generate` → real filled PDFs via a signed Storage URL. Tested with real accounts created through the Supabase admin API (no browser available in that session) — actual output field values inspected with `pypdf` after generation, not just "the request succeeded," and cross-user isolation confirmed directly (a second account cannot read or overwrite the first account's deal; RLS + an explicit ownership check both verified independently).

Quick start: `npm install && npm run dev`, visit `http://localhost:3000`, sign up, create a deal. Requires a Supabase project (`.env.local` — see `.env.example`) with `supabase/migrations/0001_init.sql` run against it, and `ANTHROPIC_API_KEY` for the listing-extraction feature.

### Known gaps (not blocking)
- No client-side validation — an empty required field can be submitted (though the review page now visually flags missing non-optional fields with a `*`).
- ~~No automated tests~~ — out of date: `tests/` now holds 91 `node:test` cases (`npm test`) plus a Python suite (`npm run test:py`). See `REMAINING_WORK.md` item 15 for what they do and don't cover.
- `deal_profile_schema.json`'s relationship to `intake_form_schema.json` still needs a decision (keep as reference doc, or retire it).
- `lib/pdfFill.ts` still shells out to a local Python script — fine on a persistent Node host (the plan's Step 9 choice), a real blocker on typical serverless hosts (Vercel's default functions don't have Python at runtime). Deliberately not ported to a JS PDF library; see that file's header for the reasoning.

## Not yet started

- ~~Step 9: choosing/deploying to a real host~~ — done: Vercel, live at https://realtyfill.ca, HTTPS automatic. The Render/Docker config is still in the repo unused (`REMAINING_WORK.md` item 13).
- Billing (Stripe) — explicitly deferred out of this pass by design.
- Any LLM use beyond the one scoped listing-extraction endpoint — deal-specific fields remain direct realtor entry by design (see `mvp-build-plan.md`'s Phase 1 "Design decision" note).
