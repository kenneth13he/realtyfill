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

Last reviewed: September 16, 2026 (Supabase Pro: backups verified, leaked-password
protection enabled and tested).

**Closed on September 16:** database backups (the standing P0 — daily backups
confirmed running via the management API, four of them, most recent that
morning) and leaked-password protection (enabled, then verified by attempting
to set "Password123!" on a real account and getting back
`422 weak_password, reasons: ["pwned"]`).

Legend: **P0** blocks launch · **P1** before real client data · **P2** before
it costs money or embarrasses us · **P3** polish

---

## P0 — blocks any external tester

### 1. Legal pages have unfilled placeholders — Kenneth (text) / needs a lawyer
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

### 2. ~~PDF_SERVICE_SECRET~~ — not a real gap, verified
`PDF_SERVICE_SECRET` appears nowhere: not in the code, not in Vercel. That's
fine rather than missing. `/fill`, `/health` and `/pdf-service/fill` all 404
through the public domain, which is exactly what `vercel.json`'s rewrites are
meant to guarantee — only the `frontend` service is exposed, and the Next app
reaches the other one over the internal `PDF_SERVICE_URL` binding. There is no
public surface for a secret to protect.

### 3. MFA is on in Supabase and has no UI — decide
`mfa_totp_enroll_enabled` and `mfa_totp_verify_enabled` are both **true** on
the project, but the app has no enrol or challenge screen, so nothing can use
it. Harmless — it is capability, not enforcement — but it means "we have MFA"
is not true today.

**Decide:** build the enrol/challenge flow, or turn the flags off so the
project's configuration matches what the product actually does.

### 4. GitHub hygiene — Chris
- Secret-scanning push protection: enable.
- Confirm the repo is Private.
- The Anthropic API key was exposed in a session transcript and needs
  rotating if that hasn't happened yet.

---

## P2 — before it costs money

### 5. No spend cap on the Anthropic account — Chris
Listing extraction runs on `claude-sonnet-5` with prefix caching and per-call
cost logging, so the per-call cost is known and low. What's missing is the
ceiling: the per-user cap is 60 extractions/hour, so twenty active realtors
have a theoretical ceiling of 1,200 calls an hour against one key, and
nothing anywhere stops it.

**Fix:** a spend alert (and ideally a hard cap) on the Anthropic account.

### 6. No retention policy for generated PDFs — Chris
Generated forms accumulate in Storage forever. Deal deletion and account
deletion both clean up properly, so this is only about PDFs nobody deletes —
which is most of them. Invisible at a handful of testers; it's the first
surprising bill at fifty realtors.

**Fix:** decide a retention window and a scheduled cleanup, or accept the
cost explicitly.

See `REMAINING_WORK.md` item 17.

### 7. Logging exists, alerting doesn't — Chris
Errors are logged. Nothing tells us when they happen. The first we'd hear of
a broken generate pipeline is a user saying so.

See `REMAINING_WORK.md` item 16.

### 8. Two stale Dependabot PRs still open — Kenneth or Chris
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

### 9. Two deployment paths, one in use — Chris
Vercel is live. The Render/Docker path still exists, and its `node:24-slim`
image has never been build-tested. Either it's a real fallback and gets
tested, or it's dead weight and gets deleted. Right now it's neither.

See `REMAINING_WORK.md` item 13.

---

## P3 — product decisions and polish

### 10. Form 400 utility checkboxes — blocked on a real form
The `/1` suffix semantics on the utility checkboxes can't be confirmed from
the blank PDF alone. **This must not be guessed** — wrong checkbox semantics
on an Agreement to Lease is a wrong legal document, not a cosmetic bug.

**Unblocks when:** we get a real completed Form 400 to compare against.

See `REMAINING_WORK.md` item 9.

### 11. Form 410 is 11/121 fields — product decision
It needs a tenant-facing flow to be worth anything; a realtor can't supply
most of those fields. Either build that flow or drop the form from the set.

### 12. Collapsible intake sections — Kenneth
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

### 13. PropTx 291/292 are mapped on page 1 only — product decision
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

### 14. Second landlord / seller name — nowhere to put it
292 prints two LANDLORD NAME boxes (`txtseller1`, `txtseller2`) and the
intake has only `landlord_full_name`. A co-owned unit fills one and leaves
the other blank. Same shape on 291, 203, 271, 272 and 401 for a second
seller, and on 303/320/371 (`txtbuyer2`) for a second buyer.

### 15. Form 101's acknowledgement block is half-addressed — Chris
Page 5 prints an Address for Service and a Tel. No. for each side, plus name,
address, email, phone and fax for each side's lawyer. Only the seller's phone
has an intake answer (`seller_contact`). Eleven lawyer boxes and three
address boxes have no question behind them.

Lawyer details are known at the agreement stage and a realtor would expect
them filled. **Decide:** add a lawyers section to the intake, or accept that
the block is completed by hand.

### 16. Listing/co-op brokerage street address — partly unmapped
`coop_brokerage_address` now reaches 320 and 371 as well as 324/372. There is
no equivalent question for the *listing* brokerage, so `txtl_brkaddr` on 271,
272 and 320 stays blank — even though Settings already stores a
`brokerage_address` per user. Both forms also print city / province / postal
as separate boxes and the intake holds the address as one line.

### 17. Three boxes cannot hold a realistic Ontario value — form limits
Not our bugs; the forms are simply this narrow, and Chrome truncates silently
rather than warning. Worth knowing before a realtor reports it:

| Question | Form | Box | Holds |
|---|---|---|---|
| `condo_property_name` | 101 | `hidlockers_1` | 15 — "The Rosedale" fits, "Pinnacle on Adelaide" does not |
| `property_street_name` | 291 | `txtp_street` | 25 — "Queen's Park Crescent West" is 26 |
| `property_street_name` | 292 | `txtp_street` | 20 |
| `condo_corporation_name` | 101 | `txtlegalNameCondo` | 50 — "York Region Standard Condominium Corporation No. 1024" is 53 |

`npm run audit:fill` reports any value that exceeds a box's `/MaxLen`, and
`scripts/overflow_check.py` reports text wider than its box even when it fits
the character limit. Both are worth a look after any mapping change.

### 18. Unmapped "or ..." alternatives beside the commission percentages
Forms 271, 272 and 371 each print "a commission of ____% of the sale price of
the Property **or** ____". We fill the percentage; the alternative box
(`txtcommis_writ` and `txtSPComm` on 271, `txtMoreComm` and `txtPurchase` on
272) has no question. A brokerage charging a flat fee has nowhere to say so.

**Decide:** add a second commission question, or accept that flat-fee
arrangements are written in by hand.

### 19. Form 244's a.m./p.m. control — deliberately unmapped
`chkOpt_SofferTime` sits beside the "no conveyance of offers prior to ____"
time box, and its two options draw no visible glyph on the blank form, so
which is a.m. and which is p.m. could not be confirmed. Same rule as Form
400's utility checkboxes (issue 10): not guessed. The time box itself holds
only 5 characters, so the question now asks for "7:00" rather than "7:00 p.m."

**Unblocks when:** we see a real completed Form 244.

### 20. Second salesperson, fax and open-house fields — no questions
291/292 page 10 prints salespersons 2–4 with their own brokerage and phone,
a brokerage fax, open-house date/time, and showing instructions. Form 101
prints a fax for each side. None of these have intake questions. They are
genuinely optional; listing them so it is a decision rather than an oversight.

### 21. Google's sign-in screen says "supabase.co", not RealtyFill — Chris
The account chooser reads **"to continue to wxtyyakxasxsftjneqgl.supabase.co"**.
Sign-in works; this is trust, and it is the wrong kind of wrong for a product
holding client financial data — a random 20-character hostname on a login
screen reads exactly like phishing.

Google names the owner of the OAuth client, and our redirect is
`https://wxtyyakxasxsftjneqgl.supabase.co/auth/v1/callback`. Setting an App
name on the consent screen was tried on September 16 and the screen still
showed the host an hour later, checked by loading Google's actual page rather
than our own parameters.

Three possible causes, in the order worth checking:

1. **Propagation.** Google caches the consent screen for up to a day.
2. **Wrong Google Cloud project.** Supabase uses client
   `496367422992-cfe9nuk0...apps.googleusercontent.com`, so the consent screen
   that matters belongs to project **496367422992**. Editing another project's
   changes nothing and warns about nothing.
3. **`supabase.co` cannot be an Authorized domain.** Google only shows an App
   name for a redirect domain you have verified ownership of, and nobody can
   verify `supabase.co`. If this is the cause, no consent-screen edit fixes
   it — only a Supabase **custom auth domain** (`auth.realtyfill.ca`) will,
   which needs Pro, and then the Google redirect URI has to be repointed.

Re-check with the loop in this file's git history: drive /login in a real
Chrome, click through, and read the "to continue to" line off Google's page.

**Blocked on a purchase, not on Pro.** Supabase Custom Domains is a separate
add-on on top of Pro (~$10/month) — the management API refuses with
`entitlement_required / custom_domain` until it is bought, at
`supabase.com/dashboard/org/hteqwpbzcfpmfrjcuudm/billing`. A vanity subdomain
is free but still lands on `*.supabase.co`, so it fixes nothing here.

**Related, already done:** `prompt=select_account` is now sent, so Google
always shows the chooser instead of silently reusing the one signed-in
session; and the header now shows which account you are in, so landing in the
wrong one is visible rather than looking like lost data.

---

## Not verified from here

The deployment-side items above — SMTP, backups, `PDF_SERVICE_SECRET`,
password policy, repo visibility — are read from `REMAINING_WORK.md` and from
the code. Nothing in this repo can confirm the state of the Vercel or
Supabase dashboards. Check both consoles before trusting this list.
