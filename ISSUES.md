# Issues — what stands between here and a production launch

A prioritized, actionable list of what is **still open**. Deliberately short:
this is the "what do I do next" doc, not the "what is the state of
everything" doc — that's `REMAINING_WORK.md`, which is exhaustive and stays
the source of truth for status. Where an item has a fuller write-up there,
it's cross-referenced; don't duplicate detail between the two files, link
instead.

Solved items are removed from this file rather than struck through, so its
length is a real measure of what's left. `REMAINING_WORK.md` and the git log
are where the history lives.

Owners follow the standing split: **Kenneth** frontend (`components/`, `app/`
pages), **Chris** infra and backend (`app/api/`, `lib/`, `supabase/`, config,
deploy).

Last reviewed: September 15, 2026.

Legend: **P0** blocks launch · **P1** before real client data · **P2** before
it costs money or embarrasses us · **P3** polish

---

## P0 — blocks any external tester

### 1. Email delivery (SMTP) — Chris
Supabase's built-in SMTP only delivers to members of the Supabase org. For
anyone else, sign-up confirmation never arrives and forgot-password silently
does nothing — the flow reports success either way, by design, so it fails
invisibly.

This is the single item standing between us and one realtor trying the
product. Everything else on this list can be shipped around.

**Fix:** a real transactional provider (Resend, Postmark, SES) wired into
Supabase Auth > SMTP settings, then confirm end to end with a non-org address.

See `REMAINING_WORK.md` item 2.

### 2. No database backups — Chris
Confirmed via the management API: PITR is off and the project has **zero
backups**. A bad migration or a mistaken delete is permanent and total.

We store tenants' names, income, employers and rental history. There is no
version of "production" that includes having no recovery path for that.

**Fix:** Supabase Pro (daily backups + PITR), or a scheduled `pg_dump` to
object storage if we're not ready to pay yet. Either beats nothing.

See `REMAINING_WORK.md` item 17.

### 3. Legal pages have unfilled placeholders — Kenneth (text) / needs a lawyer
`components/LegalPage.tsx:13-14` still reads, literally:

```
export const LEGAL_CONTACT_EMAIL = "[YOUR CONTACT EMAIL]";
export const LEGAL_ENTITY_NAME = "[YOUR LEGAL NAME OR COMPANY]";
```

Both strings render on the live Terms and Privacy pages. Separately: the
pages are written but nobody qualified has read them, and handling this
category of personal information makes us a data controller under PIPEDA.

**Fix:** fill both constants; get both pages reviewed before any real client
data goes in.

See `REMAINING_WORK.md` item 5.

---

## P1 — before real client data

### 4. Supabase password policy is weaker than the app's — Chris
The app enforces a 10-character minimum (`lib/passwordPolicy.ts`), but the
Supabase project minimum is still 6. The anon key is public by design, so a
caller can invoke Supabase Auth directly and get an account with a
six-character password regardless of what our forms say. The app-side check
is the convenience half; the dashboard setting is the control.

**Fix:** Authentication > Policies > Password — set the minimum to 10, enable
leaked-password protection, and enable MFA.

See `REMAINING_WORK.md` item 17b.

### 5. `PDF_SERVICE_SECRET` not set on both Vercel services — Chris
The Next app and `pdf-service/` each need it. Without it on both, the fill
endpoint is either unauthenticated or broken — worth confirming in the
dashboard rather than assuming, since nothing in the repo can check it.

### 6. Nobody has opened the app on a real iPhone — Kenneth
`scripts/browser_check.ts` covers Chromium desktop and a 375px mobile
viewport, clean on localhost and production. It cannot cover the one thing
that actually worries us: iOS Safari refuses to render PDFs in an iframe in
ways no emulator reproduces, and the PDF preview is exactly where that bites.
The `hidden sm:block` fallback is asserted to be the visible one at 375px —
asserted in Chromium, which is not the browser with the problem.

**Fix:** open it on a physical iPhone, walk the whole flow, check the preview
step specifically.

See `REMAINING_WORK.md` items 11 and 25.

### 7. GitHub hygiene — Chris
- Secret-scanning push protection: enable.
- Confirm the repo is Private.
- The `origin` remote still points at the old capitalized
  `github.com/kenneth13he/RealtyFill`; GitHub redirects, so it works, but it
  breaks the day someone claims the old name. One `git remote set-url`.
- The Anthropic API key was exposed in a session transcript and needs
  rotating if that hasn't happened yet.

---

## P2 — before it costs money

### 8. No spend cap on the Anthropic account — Chris
Listing extraction runs on `claude-sonnet-5` with prefix caching and per-call
cost logging, so the per-call cost is known and low. What's missing is the
ceiling: the per-user cap is 60 extractions/hour, so twenty active realtors
have a theoretical ceiling of 1,200 calls an hour against one key, and
nothing anywhere stops it.

**Fix:** a spend alert (and ideally a hard cap) on the Anthropic account.

### 9. No retention policy for generated PDFs — Chris
Generated forms accumulate in Storage forever. Deal deletion and account
deletion both clean up properly, so this is only about PDFs nobody deletes —
which is most of them. Invisible at a handful of testers; it's the first
surprising bill at fifty realtors.

**Fix:** decide a retention window and a scheduled cleanup, or accept the
cost explicitly.

See `REMAINING_WORK.md` item 17.

### 10. Logging exists, alerting doesn't — Chris
Errors are logged. Nothing tells us when they happen. The first we'd hear of
a broken generate pipeline is a user saying so.

See `REMAINING_WORK.md` item 16.

### 11. Two stale Dependabot PRs, and a config that produces duplicates — Chris
PRs #8 and #9 both bump `fastapi` only. The advisories that were making CI
red were against `python-multipart`, which is now pinned at `0.0.32` on
`main`, so both PRs are superseded and neither would fix anything.

The two are byte-identical because `dependabot.yml` has pip entries for both
`/` and `/pdf-service`, and the root scan reaches into the subdirectory.

**Fix:** close #8 and #9; drop the `/` pip entry (root `requirements.txt`
holds only `pypdf` and audits clean either way).

See `REMAINING_WORK.md` item 15g.

### 12. Two deployment paths, one in use — Chris
Vercel is live. The Render/Docker path still exists, and its `node:24-slim`
image has never been build-tested. Either it's a real fallback and gets
tested, or it's dead weight and gets deleted. Right now it's neither.

See `REMAINING_WORK.md` item 13.

---

## P3 — product decisions and polish

### 13. Form 400 utility checkboxes — blocked on a real form
The `/1` suffix semantics on the utility checkboxes can't be confirmed from
the blank PDF alone. **This must not be guessed** — wrong checkbox semantics
on an Agreement to Lease is a wrong legal document, not a cosmetic bug.

**Unblocks when:** we get a real completed Form 400 to compare against.

See `REMAINING_WORK.md` item 9.

### 14. Form 410 is 11/121 fields — product decision
It needs a tenant-facing flow to be worth anything; a realtor can't supply
most of those fields. Either build that flow or drop the form from the set.

### 15. Frontend polish — Kenneth
None of this stops a realtor from using the product. In rough order of how
much it's missed:

- Toasts — errors are currently inline text only
- Collapsible / auto-collapsing intake sections
- Illustrated dashboard empty state
- Keyboard-only pass
- Dark mode

See `REMAINING_WORK.md` items 22, 21, 23, 26, 27.

### 16. `docs/PROJECT_STRUCTURE.md` is stale — either
It carries a staleness banner and four corrections, but it predates the
Vercel deploy, `pdf-service/`, three of the four form sets, `tests/`, and
most of `app/`. It's the only per-file index we have, which is why it was
annotated rather than deleted.

**Fix:** a full rewrite, or delete it and accept that the code is the index.

---

## Not verified from here

The deployment-side items above — SMTP, backups, `PDF_SERVICE_SECRET`,
password policy, repo visibility — are read from `REMAINING_WORK.md` and from
the code. Nothing in this repo can confirm the state of the Vercel or
Supabase dashboards. Check both consoles before trusting this list.
