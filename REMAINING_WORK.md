# Remaining Work

Single source of truth for what's left. It replaced `TESTING_READINESS.md`,
which predated the Vercel deployment and has now been deleted — every item
in it was either done (deploy, legal pages, forgot-password, account
deletion, feedback channel) or restated below.

Status markers: ✅ done and verified · ⚠️ done but unverified · ❌ not started

---

## Where things actually stand

**Live at:** https://realtyfill.vercel.app — public, verified serving the app
to a cookie-less request (see Blocker 1)

**All four form sets now generate.** Lease–tenant (5 forms), lease–landlord
(2), sale–buyer (5), sale–seller (3). "Coming soon" is gone. The blank
templates for the three new sets arrived as flat PDFs with zero AcroForm
fields, so `scripts/add_form_fields.py` synthesizes fields over the dot-leader
blanks — 395 across 10 forms. **Those field positions are inferred, not
authoritative**; each template folder's README says what to redo if a real
WEBForms export ever arrives. PropTx 291/292 remain deliberately out of scope.

**Verified working in production** (tested end-to-end via real HTTP requests
against the deployed site, with `pypdf` inspection of the output PDF — not
just "the request returned 200"):

- ✅ Email/password sign-up + sign-in, session handling, sign-out
- ✅ Multi-deal dashboard, create/close/archive deals
- ✅ Settings (profile + brokerage defaults seeded onto new deals)
- ✅ Intake save/load, inline editing with autosave
- ✅ PDF generation → Supabase Storage → signed-URL download, **with correct
  field values** (2229E verified on production specifically)
- ✅ The `pdf-service` Vercel Service + `PDF_SERVICE_URL` binding (this was
  the big architectural unknown — it works)
- ✅ Cross-user data isolation, re-verified against the production database:
  a second account could not read, download, or overwrite the first
  account's deal, and the first account's data was confirmed untouched
  afterward
- ✅ Rate limiting on `/login` and `/api/extract-listing` — **rewritten**:
  the counters used to be a per-process in-memory Map, which on Vercel's
  serverless runtime meant every limit was silently multiplied by the number
  of warm instances. Now a single atomic SQL statement
  (`check_rate_limit()`, migration 0003). Verified: 10 simultaneous calls
  against a limit of 5 let exactly 5 through.
- ✅ Cross-user isolation re-verified after adding `support_requests`:
  with two real user ids, neither could read the other's deals, intake
  answers, generated forms or support requests, and writes across the
  boundary were refused by Postgres (`42501`), not just hidden.
- ✅ HTTPS (automatic on Vercel)

---

## Blockers — no realtor can test until these are done

### 1. ✅ Decide how testers reach the site — resolved for production
`https://realtyfill.vercel.app` is publicly reachable: a cookie-less request
returns 200 and the real landing page, not an SSO gate. Anyone can visit it.

Caveat worth knowing: the project still reports
`ssoProtection: all_except_custom_domains` via the API, yet the production
alias serves publicly — so the setting and the observed behaviour disagree.
Preview deployments do still appear to be gated. If you need previews open
too, check Settings → Deployment Protection directly rather than trusting
either signal.

Still do: rotate the bypass secret if you haven't (one was pasted into a chat
log).

<details><summary>Original options, kept for reference</summary>

- **Turn protection off** (Settings → Deployment Protection → Vercel
  Authentication → Disabled). Simplest; site becomes public.
- **Keep it private, hand testers a bypass link** — works, but means giving
  each tester a URL containing a secret token. Fine for Kenneth, wrong for
  external realtors.
- **Vercel Pro team** — real member accounts / password protection. Costs money.
</details>

### 2. ❌ Email delivery (SMTP) — still the real blocker
Confirmed via the management API: `smtp_host` is null, so the project is on
Supabase's built-in mailer — **2 emails/hour, project-wide, and only
deliverable to your own team members.**

The stopgap has been applied: `mailer_autoconfirm` is now `true`, so signup
no longer sends an email and works instantly. That's why signups succeed.

What's still broken is **forgot-password**, which sends a real email no
matter what that setting says. For any realtor who isn't on your Supabase
team, that email never arrives — silently.

Fix: Resend or Postmark, then Supabase → Project Settings → Authentication →
SMTP Settings. ~20 minutes, and it's the last thing between you and handing
this to a tester.

### 3. ✅ Supabase URL configuration — verified correct
Confirmed via the management API:
- `site_url`: `https://realtyfill.vercel.app`
- `uri_allow_list`: `https://realtyfill.vercel.app/**`

One gap: `http://localhost:3000/**` is **not** in the allow list, so password
reset and OAuth redirects will bounce to production when testing locally.
Add it if you work on auth flows in dev.

### 4. ✅ Google sign-in — enabled
Supabase now reports `external_google_enabled: true`. The button should work.
Not clicked through in a browser yet (see item 11).

---

## Should be done before real client data goes in

### 5. 🟡 Terms of Service + Privacy Policy — written, placeholders unfilled
`/terms` and `/privacy` exist (`components/LegalPage.tsx` holds the shared
shell). They cover the clauses that matter for this product: not legal
advice, the realtor is responsible for reviewing generated forms, signature
fields are never auto-filled.

**Two things still block relying on them.** `LEGAL_CONTACT_EMAIL` and
`LEGAL_ENTITY_NAME` in `components/LegalPage.tsx` are still literal
`[YOUR CONTACT EMAIL]` / `[YOUR LEGAL NAME OR COMPANY]` placeholders, and
neither page has been read by anyone qualified. The app stores real
tenant/landlord names, phones and addresses; one Schedule document we tested
even involves a tenant's SIN.

### 6. ✅ Forgot-password flow
Built. `/login?mode=reset` requests a link, `/auth/callback` exchanges the
recovery code, `/reset-password` sets the new password. Rate-limited, and
deliberately reports the same message for unknown addresses so it can't be
used to discover who has an account. Verified the request path end to end.

**Still depends on Blocker 2** — it sends mail through Supabase's
rate-limited default mailer, so it will be unreliable until SMTP is sorted.

### 7. ✅ Account / data deletion
Built. Settings → "Delete account", gated behind typing DELETE. Removes
Storage objects first, then deletes the auth user, which cascades
deals → deal_intake/generated_forms and profiles.

Verified against a real account with 1 deal and 5 generated PDFs: after
deletion, zero orphaned rows in all four tables **and** zero orphaned
storage objects. (Order matters here — deleting the user first would have
orphaned the PDFs in the bucket with no session left to clean them up.)

---

## Correctness gaps

### 8. ✅ All five forms generate and fill correctly
Generated all five for one deal with comprehensive data and inspected every
filled value with `pypdf`. All five produce valid PDFs with correct values.

Fill coverage, which is what led to the rewrite of item 9 below:

| Form | Fields filled / total |
|---|---|
| 2229E | 42 / 93 |
| Form 400 | 29 / 108 |
| Form 324 | 22 / 48 |
| Form 372 | 10 / 48 |
| Form 410 | **11 / 121** |

(Done locally. Production uses the same mapping logic through `pdf-service`,
already verified byte-equivalent, so re-running on production is a nice-to-
have rather than a correctness gap.)

### 9. 🟡 Form-field coverage — partly done, rest needs decisions
A full audit found **262 unmapped fields** across the five forms. They fall
into three very different buckets:

**Done ✅ — landlord's address for notices.** 2229E s.3 and Form 400's
"Address of Landlord" were both entirely blank, despite being the legally
required address for serving notices. Now mapped as seven separate intake
fields (unit / street number / street name / PO box / city / province /
postal code) — deliberately separate rather than one blob, because both
forms lay them out as distinct boxes, and mapping one value into several
boxes is exactly the bug we already hit with the co-op brokerage address.
Verified filling correctly on both forms.

**Blocked ⚠️ — Form 400's utility checkboxes. Do not guess at these.**
Form 400 has its own included-in-rent checkboxes (cable, gas, condo fee,
oil, hot water, other×3) that nothing currently maps to. The obstacle isn't
effort, it's that the intake schema uses two *different* meanings for the
same `/1`/`/2` codes: `gas_included` means `/1` = Yes-included, while
`electricity_responsibility` means `/1` = Landlord. Whether Form 400's
`chkOpt_gas_l` follows one convention or the other cannot be determined
from the field data alone. **Guessing wrong silently ticks the wrong box on
a legal document** — the worst failure mode this app has. Resolve by
checking a real completed Form 400 (the realtors you're testing with will
have one) and confirming which box `/1` corresponds to, then map them.

**Product decision needed ❓ — Form 410.** It sits at 11/121 filled because
it's a *rental application*: employment history (current and prior, ×2
applicants), banking details, credit references, personal references,
vehicles, prior addresses, occupants, pets. That's roughly 80 new intake
fields, and more importantly it's data the **tenant** supplies, not the
listing agent. Asking a realtor to type a tenant's employment history into
RealtyFill is a different product than "enter the deal once." Decide whether
Form 410 needs a separate tenant-facing flow, is left partially filled
deliberately, or is dropped from the supported set — before anyone builds
80 fields.

### 10. 🟡 Validation — per-field only; the summary warning was removed
The editor marks each empty non-optional field with a red `*` at the point
of entry, which stands.

A summary warning on the review page ("N fields still empty on the forms
you've selected") was built and then removed: `"(optional)"` in a label is
too crude a proxy for "required", so it counted ~37 fields on a realistic
deal — mostly things a realtor legitimately wouldn't have. It read as noise
rather than a signal.

Doing this properly needs a real notion of which fields are genuinely
required *per form*, which doesn't exist in `intake_form_schema.json` today
and overlaps with the item 9 audit. Worth revisiting together with that.

### 11. 🟡 Browser verification — automated, one gap left
`npx tsx scripts/browser_check.ts` drives Chromium through the real flow:
sign in → create deal → fill intake → generate all five forms → expand a
preview → delete the deal → settings → support → admin. Add `--mobile` for a
375px iPhone SE viewport, `--url https://realtyfill.vercel.app` for
production, `--headed --slow` to watch it.

It reports what a person has to catch by eye: CSP violations and console
errors per page, horizontal overflow (measured, not eyeballed), and focus
rings checked by tabbing and reading computed styles.

**Clean on all four combinations** — localhost and production, desktop and
mobile — with the CSP enforcing. Generation completing on production is the
notable one: that is the `pdf-service` sidecar confirmed working end to end
in a real browser, not just by HTTP.

**Still a real gap: nobody has opened it on an actual iPhone.** iOS Safari
refuses to render PDFs in an iframe in ways no emulator reproduces, and the
preview is exactly where that bites. The mobile fallback (`hidden sm:block`
plus an "Open in new tab" link) is asserted to be the visible one at 375px,
but asserted in Chromium, which is not the browser that has the problem.

---

## Technical debt introduced along the way

### 12. ✅ PDF fill logic exists in two copies — resolved
There is now one copy. `pdf-service/fill_fillable_fields.py` and
`pdf-service/extract_form_field_info.py` hold the logic;
`scripts/fill_fillable_fields.py` and `scripts/extract_form_field_info.py`
are thin CLI wrappers that import them. The dependency has to point that way
round: `pdf-service/` deploys with `root: pdf-service/` and can only import
files inside itself, while `scripts/` can reach down into it.

Both paths verified against the same template after the change — the CLI
(`python scripts/fill_fillable_fields.py …`) and the HTTP endpoint
(`POST /fill`) each wrote the value into the field and read it back
correctly, and each rejected an unknown field id.

One behaviour change while doing this: the CLI now prints validation errors
to **stderr** rather than stdout. `lib/pdfFill.ts` surfaces only stderr in the
error it throws, so a bad field id previously reached the API as a bare
"Command failed" with no indication of which field was wrong.

### 13. ❌ Two deployment paths, only one in use
The repo carries both Vercel config (`vercel.json`, `pdf-service/`) and
Render/Docker config (`Dockerfile`, `render.yaml`, root `requirements.txt`).
Only Vercel is live. The root `requirements.txt` is also what caused the
"Multiple frameworks detected" build failure. Decide whether Render is a real
fallback; if not, delete it and item 12 goes away too.

### 14. ✅ Two repos with unrelated git histories — resolved
`kenneth13he/realtyfill` is canonical and Vercel builds from it. It is the
only remote configured locally, so there is nothing left to replay by hand.
(The repo was also renamed to lowercase; the local remote URL was updated to
match, since GitHub was redirecting every push.)

Still worth doing: `new-main` and `phase-2-accounts` are fully merged into
`main` and can be deleted.

### 15. 🟡 Automated tests — a first suite exists, coverage is partial
`npm test` (24 tests, `node:test` via `tsx`, no new framework) and
`npm run test:py` (9 tests, plain `unittest`, no pytest dependency).

What they cover, chosen as the places bugs have actually happened:
- `isSignatureField` — including the substring bug that blanked the
  designated-representative line on Forms 271/272/371
- `withComputedValues` — one-line address, money-to-words, date splitting
- **every intake `targets` entry names a field id that really exists on that
  form** — this is the one that matters most. A target pointing at a
  non-existent field fails silently: the PDF generates fine and the blank
  just stays empty. It's what produced Form 244's shifted date parts.
- every set's templates exist on disk where the generate route looks
- checkbox targets use the `/1`/`/Off` pair `IntakeFieldsEditor` hardcodes
- the fill logic itself: values land, unknown ids and wrong page numbers are
  rejected, all errors reported not just the first, `/fill` returns 422 with
  the detail list `lib/pdfFill.ts` expects

Not covered: React components, the API routes, auth/RLS, and whether a filled
field is in the *right place on the page* (that still needs a human looking
at a rendered PDF — it's how the Form 101 purchase-price bug was caught).

---

## Operational

### 15b. ✅ Support channel — built
`/support` (linked from the header on every signed-in page). A realtor files
a report; it lands in `public.support_requests`, RLS-scoped so each user sees
only their own. Triage from the Supabase dashboard or with the service role —
there is deliberately no update policy, so a submitted report can't be edited
afterwards and `status` (open / in_progress / resolved) stays yours to set.

The piece that makes it useful is the **error reference**. `lib/logger.ts`
now stamps every logged error with a short id, returns it, and the API routes
send it to the browser; the support form has a field for it. "Generating
didn't work this morning" becomes one grep.

That change also closed a small leak: `/api/generate`, `/download`,
`/account` and `/extract-listing` were returning raw internal error messages
to the browser — strings that can name tables, storage paths and field ids.
They now return a generic sentence plus the reference.

Still manual: nothing emails you when a request arrives. Check the table, or
wire it to the SMTP provider once Blocker 2 is done.

### 15c. ✅ Security response headers — added, CSP is report-only
`next.config.ts` sets `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy`, `Permissions-Policy` and `Strict-Transport-Security` on
every route, all enforced.

The Content Security Policy ships as **`Content-Security-Policy-Report-Only`**
on purpose. A slightly-wrong CSP doesn't degrade, it blanks the page, and
nobody has clicked through this app in a browser yet (item 11). Report-only
logs violations to the console and blocks nothing.

**Done.** `CSP_HEADER` is now `"Content-Security-Policy"` — enforcing, in
production. Confirmed by running the browser pass again with it on rather
than by reasoning about it: the PDF preview iframe still loads (frame-src
covers the Supabase signed URL) and nothing else is blocked.

One change while verifying: `upgrade-insecure-requests` is production-only
now. It does nothing in a Report-Only policy — Chromium logs a notice saying
so on every page load, which was the only "violation" the first run found —
and it has no place in a local http dev server once enforcing.

---

### 15d. ✅ Request input limits — added
Every write endpoint took its input on trust. `/api/deals/[dealId]/intake`
stored the raw request body verbatim as the answers blob — any size, any
shape; `label` had no length cap; `/api/extract-listing` base64'd every
uploaded file into memory with no limit on size or count.

Rate limiting doesn't cover this: it caps how *often* someone calls, not how
much they send, so sixty permitted extractions an hour could still be sixty
100 MB uploads — billed by the token against `ANTHROPIC_API_KEY`.

`lib/inputLimits.ts` now caps upload size/count, pasted text length, the
answers blob (keys, key length, value length, total bytes) and the deal
label. All ceilings are far above real use and there's a test asserting that:
the whole real intake schema, every field filled, still validates.

`validateAnswers` also enforces the `Record<string, string>` shape the rest
of the app assumes. A nested object stored there wouldn't have errored — it
would have surfaced later as a mangled value in a real legal document.

### 15e. ✅ Health check — `/api/health`
Point an uptime monitor (UptimeRobot, Better Stack) at it. Deliberately not
`return "ok"`: it makes one trivial round-trip to Postgres and returns 503 if
that fails, because the app will happily serve pages while the database is
unreachable — which is the outage that matters. Public, uncached, returns
nothing identifying.

### 15f. ✅ Missing env vars now fail loudly
Every Supabase client read its config with a `!` non-null assertion, which
silences TypeScript and does nothing at runtime. A missing anon key produced
a client pointed at `undefined` and surfaced later as a confusing auth error
— which is exactly what happened once during deployment. `lib/env.ts`'s
`requireEnv` throws a named, actionable error instead.

---

### 15g. ❌ CI's dependency audit is red on `main`
The `Dependency audit` job fails every run. It is a real finding, not a
flaky check: `pdf-service/requirements.txt` pins `fastapi==0.117.1`, which
resolves `starlette 0.48.0`, and pip-audit reports 12 published advisories
against that version. The Node half (`npm audit`) passes.

Dependabot already opened the fix — PRs #8 and #9 both bump that one pin to
`fastapi==0.141.1`, and CI including the audit job is green on both.
Merging either one clears it; the other then has an empty diff and closes
itself. (They are duplicates because `.github/dependabot.yml` has a pip
entry for `/` as well as `/pdf-service`, and the root one reaches the same
file. Worth dropping the `/` pip entry — root `requirements.txt` only holds
`pypdf`, and it belongs to the unused Render path in item 13.)

### 16. ⚠️ Logging exists, alerting doesn't
`lib/logger.ts` writes structured JSON errors visible in Vercel's Logs tab,
but nothing notifies you. If PDF generation starts failing for a realtor
mid-test, you'll find out when they tell you. Consider Sentry or a log drain.

### 17. ❌ No backup/retention policy
Checked via the management API: **PITR is off and the project has zero
backups.** Free tier, so there is currently no recovery path at all — if the
database is lost, every deal and every intake answer goes with it. That's
tolerable while the only data is yours and Kenneth's; it stops being
tolerable the moment a realtor enters a real client's details.

Options: Supabase Pro (daily backups + PITR), or a scheduled `pg_dump` to
somewhere off-platform. Also still undecided: how long real client data is
kept.

### 17b. ❌ Password policy is weak
`password_min_length` is 6 and no character classes are required. Raising it
(Supabase → Authentication → Policies) is a one-field change. Attempted here
and blocked by the permission classifier as a change to shared auth config —
it needs to be you, in the dashboard.

---

## Front-end / design

Current state: Tailwind v4, a real brand palette in `app/globals.css`
(`--brand-deep #14124a`, `--lime #c9f73d`, indigo `--brand #2d28d9`), Outfit
via `next/font`, a wordmark, a favicon and a generated OG image. The "unstyled
developer app" problem this section was written about is fixed.

### 18. ✅ Landing page (`app/page.tsx`)
Built: nav, hero, visual proof (`components/landing/VisualProof.tsx`), the
form-set grid, a trust row and a footer, with `Tower`/`Marquee`/`ScrollStage`
carrying the motion.

Fixed since: below `lg` the tower was passed a hardcoded `lit={FLOORS}`, so
narrowing the window left the page's one animated element frozen fully lit —
it read as broken rather than as a deliberately simpler layout. It now
lights from its own position in the viewport (`entryProgress` in
`ScrollStage.tsx`), keeping the page's native scroll with no pinning, which
is the part that genuinely doesn't belong on a phone. Verified by SSR output
and build; the scroll response itself is still browser-unverified (item 11).

### 19. ✅ Logo + brand identity
`components/Wordmark.tsx` is the single definition (four call sites used to
re-type it). `app/icon.svg` is the favicon and `app/opengraph-image.tsx`
generates the 1200×630 link-preview card via `next/og` — verified rendering
as a real PNG, not just building.

Known cosmetic limit on the OG image: satori falls back to its built-in font,
so word spacing is wider than the app's Outfit. `next/font` emits woff2,
which satori can't parse. See the note in that file.

### 20. ✅ Typography
Outfit via `next/font`, self-hosted at build time.

### 21. 🟡 Intake form navigation — nav + counts done, wizard not
`components/IntakeFieldsEditor.tsx` now has a sticky section nav with a
per-section empty-field count and a running total ("7 fields still empty"),
plus jump links with `scroll-mt` so headings clear the sticky bar. The
"missing" rule lives in one `isMissingValue` helper shared by the nav counts
and the per-field red asterisk, so they can't disagree.

Not done, and still open as product decisions: collapsible sections,
auto-collapsing completed ones, and the full multi-step wizard.

### 22. 🟡 Loading and feedback — spinners + live regions done, toasts not
`components/Spinner.tsx` is the one spinner (`motion-reduce` aware). It's on
create-deal, generate, update-and-regenerate, autosave and delete. Each page
with slow work has one `aria-live="polite"` region.

**Per-form progress is deliberately not built.** The generate route fills
every selected form in one server-side loop and responds once, so the browser
cannot know which form is in flight — a per-form bar would be animating
invented progress. What's shown instead is the true statement: how many forms
are running, which ones, and roughly how long that takes. Real per-form
progress needs the route to stream (backend change).

Toasts: still not built; errors remain inline text.

### 23. 🟡 Dashboard empty state
Exists and is filter-aware ("No active deals" → "Pick a form set above and
create your first deal"). The illustrated version this item asked for is not
built.

### 24. ✅ PDF preview UX
Every generated form now has an always-visible "Open in new tab" link. The
`80vh` iframe renders on `sm:` and up only; below that a line explains why and
points at the new tab. This removes the three-nested-scroll-contexts problem
(page → accordion → iframe) on phones.

### 25. 🟡 Mobile — layouts fixed, still unverified in a real browser
Fixed: dashboard rows stack (`flex-col sm:flex-row`) instead of squeezing
action buttons beside a truncating label, action clusters wrap, the PDF
iframe is desktop-only. Still **not opened on a real phone** — see item 11.

### 26. 🟡 Accessibility — focus + live regions done, contrast not audited
Done: `focus-visible` rings on the dashboard's links, filters, status and
delete buttons, the review page's controls and the intake jump links;
`aria-live` on dashboard mutations and review-page progress; `aria-expanded`
on the preview accordion; `aria-label` on the delete button so it reads as
"Delete 203 College St" rather than "Delete".

Not done: the `--color-text-muted` on `--color-bg` contrast check, and a
keyboard pass through every page.

### 27. ❌ Dark mode (optional)
Unchanged. Tokens are in place in `app/globals.css`; needs a
`prefers-color-scheme` block plus an audit of the hardcoded `bg-white` /
`text-green-900` classes on the review page.

### 28. ✅ Deal deletion has a UI
`DealsList` has a Delete action behind an inline confirm, calling the
`DELETE /api/deals/[dealId]` route (which clears Storage before the row).
Archive hides a deal; this erases it and its PDFs. A realtor needs the second
one to honour a client's deletion request.

---

## Suggested split (non-overlapping)

**Person A — infrastructure, backend, correctness:** items 1, 2, 3, 4, 8, 9,
10, 13, 14, 15, 16, 17

**Person B (Kenneth) — front-end and design:** items 18–28, plus 5 (Terms/
Privacy pages), 6 (forgot-password UI), 7 (delete-account UI), and 11
(browser/mobile testing — a natural fit while working on the UI anyway)

Of those, 5, 6, 7, 18, 19, 20, 24 and 28 are done. 21, 22, 23, 25 and 26 are
partly done — see each item for exactly which half. **11 is the one that
blocks others**: it gates enforcing the CSP (15c) and is the only way the
mobile fixes in 25 get confirmed.

These two tracks touch almost entirely separate files: Person A lives in
`app/api/`, `lib/`, `supabase/`, and config; Person B lives in `app/page.tsx`,
`app/globals.css`, `components/`, and the page-level `.tsx` files. The one
overlap to coordinate on is `app/login/page.tsx` (item 6's forgot-password
link sits next to Person A's Google button) — agree who owns that file first.

Item 12 belongs to whoever touches the PDF logic first — and is resolved for
free if Person A does item 13.

---

## Fastest path to a realtor actually testing

1. Item 2 (email — or disable confirmation as a stopgap)
2. Item 1 (decide access)
3. Item 11 (click through it yourself once)
4. Item 8 (generate all five forms, open them)
5. Item 5 (ToS/Privacy, if real client data is involved)

Everything else can follow.

**On the front-end work specifically:** none of items 18–27 block a *guided*
test where one of you walks a realtor through it. They start mattering the
moment a realtor lands on the site alone and has to decide whether this looks
like something they'd trust with client paperwork — so the landing page
(18), logo/favicon (19), and typography (20) are the highest-leverage ones,
and they're also the most self-contained work in this whole document. Good
first pieces for Kenneth to own end to end.
