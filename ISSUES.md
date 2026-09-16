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

Last reviewed: September 16, 2026 (real fillable templates for all ten forms + RECO; PropTx 291/292 page 1 mapped).

Legend: **P0** blocks launch · **P1** before real client data · **P2** before
it costs money or embarrasses us · **P3** polish

---

## P0 — blocks any external tester

### 1. No database backups — Chris
Confirmed via the management API: PITR is off and the project has **zero
backups**. A bad migration or a mistaken delete is permanent and total.

We store tenants' names, income, employers and rental history. There is no
version of "production" that includes having no recovery path for that.

**Fix:** Supabase Pro (daily backups + PITR), or a scheduled `pg_dump` to
object storage if we're not ready to pay yet. Either beats nothing.

See `REMAINING_WORK.md` item 17.

### 2. Legal pages have unfilled placeholders — Kenneth (text) / needs a lawyer
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

### 3. Leaked-password protection needs Supabase Pro — Chris
The length minimum is fixed: the Supabase project now requires 10 characters,
matching `lib/passwordPolicy.ts`. That was the part that mattered — the anon
key is public, so a caller can invoke Supabase Auth directly and the dashboard
setting is the real control.

What's left needs Pro: enabling HaveIBeenPwned leaked-password checking
returns `402 — available on Pro Plans and up`. MFA is also still off.

### 4. ~~PDF_SERVICE_SECRET~~ — not a real gap, verified
`PDF_SERVICE_SECRET` appears nowhere: not in the code, not in Vercel. That's
fine rather than missing. `/fill`, `/health` and `/pdf-service/fill` all 404
through the public domain, which is exactly what `vercel.json`'s rewrites are
meant to guarantee — only the `frontend` service is exposed, and the Next app
reaches the other one over the internal `PDF_SERVICE_URL` binding. There is no
public surface for a secret to protect.

### 5. GitHub hygiene — Chris
- Secret-scanning push protection: enable.
- Confirm the repo is Private.
- The Anthropic API key was exposed in a session transcript and needs
  rotating if that hasn't happened yet.

---

## P2 — before it costs money

### 6. No spend cap on the Anthropic account — Chris
Listing extraction runs on `claude-sonnet-5` with prefix caching and per-call
cost logging, so the per-call cost is known and low. What's missing is the
ceiling: the per-user cap is 60 extractions/hour, so twenty active realtors
have a theoretical ceiling of 1,200 calls an hour against one key, and
nothing anywhere stops it.

**Fix:** a spend alert (and ideally a hard cap) on the Anthropic account.

### 7. No retention policy for generated PDFs — Chris
Generated forms accumulate in Storage forever. Deal deletion and account
deletion both clean up properly, so this is only about PDFs nobody deletes —
which is most of them. Invisible at a handful of testers; it's the first
surprising bill at fifty realtors.

**Fix:** decide a retention window and a scheduled cleanup, or accept the
cost explicitly.

See `REMAINING_WORK.md` item 17.

### 8. Logging exists, alerting doesn't — Chris
Errors are logged. Nothing tells us when they happen. The first we'd hear of
a broken generate pipeline is a user saying so.

See `REMAINING_WORK.md` item 16.

### 9. Two stale Dependabot PRs still open — Kenneth or Chris
PRs #8 and #9 both bump `fastapi` only. The advisories that were making CI
red were against `python-multipart`, now pinned at `0.0.32`, so both PRs are
superseded and neither would have fixed anything on its own.

The duplicate `/pdf-service` pip entry that produced the pair is already gone
from `dependabot.yml` — for pip, the `/` scan walks down and finds both
requirements files, which is why each entry opened its own PR against the
same file.

**Fix:** close #8 and #9 on GitHub. Needs someone with repo write access to
click it; it can't be done from here.

See `REMAINING_WORK.md` item 15g.

### 10. Two deployment paths, one in use — Chris
Vercel is live. The Render/Docker path still exists, and its `node:24-slim`
image has never been build-tested. Either it's a real fallback and gets
tested, or it's dead weight and gets deleted. Right now it's neither.

See `REMAINING_WORK.md` item 13.

---

## P3 — product decisions and polish

### 11. Form 400 utility checkboxes — blocked on a real form
The `/1` suffix semantics on the utility checkboxes can't be confirmed from
the blank PDF alone. **This must not be guessed** — wrong checkbox semantics
on an Agreement to Lease is a wrong legal document, not a cosmetic bug.

**Unblocks when:** we get a real completed Form 400 to compare against.

See `REMAINING_WORK.md` item 9.

### 12. Form 410 is 11/121 fields — product decision
It needs a tenant-facing flow to be worth anything; a realtor can't supply
most of those fields. Either build that flow or drop the form from the set.

### 13. Collapsible intake sections — Kenneth
The last item left from the frontend polish list. Toasts, the illustrated
empty state, the keyboard pass, the contrast audit and dark mode are all
done; the app was also re-themed onto a token + primitive layer in
`app/globals.css`, so it can be retuned from one file.

Intake is a long single scroll, and the schema already groups its fields —
those groups should collapse, and ideally auto-collapse once complete.

**Why it wasn't done with the rest:** it isn't only styling.
`ReviewForm.revealField()` focuses a field by id and scrolls it into view;
if that field's group is collapsed, the lookup finds nothing and the "jump
to the field the AI flagged" flow silently does nothing. Collapsing has to
expand the containing group first. Worth doing properly rather than bolting
a `<details>` around each group.

See `REMAINING_WORK.md` items 22, 21, 23, 26, 27.

### 14. PropTx 291/292 are mapped on page 1 only — product decision
Page 1 (LOCATION + AMOUNTS/DATES, the identifying block) is now 34/54 and
35/52. Everything still blank there is a checkbox whose meaning isn't on a
listing — lot shape, lot size code, winterized, waterfront, and on 292 the
four screening Yes/Nos (rental application, deposit, credit check, employment
letter), plus lease term / payment frequency / payment method, which are
landlord preferences rather than listing facts.

Pages 2–7 are several hundred property-characteristic checkboxes (exterior,
parking, amenities, waterfront/rural, interior, rooms, locker). Pages 8–9 are
free-text remarks and inclusions/exclusions. Page 10's brokerage block is
already filled; the rest of it is salespersons 2–4, open-house scheduling and
showing instructions. Page 11 is URLs and occupancy.

So the honest number is: **page 1 is done, the other ten pages are a
data-entry surface we have not decided to own.** Whole-form coverage reads 4%
because the denominator is ~900 fields.

**Decide:** extract pages 2–7 from the listing too (the extractor already
reads it and these are genuinely in a REALM printout), or accept that the
realtor finishes those pages in WEBForms.

### 15. Second landlord / seller name — nowhere to put it
292 prints two LANDLORD NAME boxes (`txtseller1`, `txtseller2`) and the
intake has only `landlord_full_name`. A co-owned unit fills one and leaves
the other blank. Same shape on 291 for a second seller.

---

## Not verified from here

The deployment-side items above — SMTP, backups, `PDF_SERVICE_SECRET`,
password policy, repo visibility — are read from `REMAINING_WORK.md` and from
the code. Nothing in this repo can confirm the state of the Vercel or
Supabase dashboards. Check both consoles before trusting this list.
