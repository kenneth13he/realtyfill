// scripts/e2e_fill_check.ts
// Types random data into every question on the real intake page, in a real
// browser, for every form set — then generates, downloads each produced PDF
// and checks that what came out matches what was typed in.
//
//   npx tsx scripts/e2e_fill_check.ts                    # all four sets
//   npx tsx scripts/e2e_fill_check.ts --set sale_buyer
//   npx tsx scripts/e2e_fill_check.ts --seed 7 --headed
//   npx tsx scripts/e2e_fill_check.ts --url https://realtyfill.ca
//
// scripts/fill_audit.ts already proves the mapping layer in isolation. This
// proves the parts that one cannot reach: the intake UI's own controls, the
// save round-trip through Postgres, the generate route, the PDF service, and
// Storage. A value has to survive all six to be judged correct here.
//
// It costs nothing to run — the listing extractor is never called, so no
// model tokens are spent. It does create real deals under the E2E account
// and deletes each one when it is done, including after a failure.
//
// Requires E2E_EMAIL / E2E_PASSWORD in .env.local (a dedicated account).

import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

import { FORM_SETS, FORM_SET_IDS, filterSchemaForSet, type FormId, type FormSetId } from "../lib/formTypes";
import { mapIntakeToFormFields } from "../lib/profileMapper";
import { getIntakeFormSchema, getRawFormSchema } from "../lib/schemas";
import { loadEnvLocal } from "./loadEnv";

loadEnvLocal();

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const flag = (n: string) => process.argv.includes(`--${n}`);

const BASE = (arg("url") ?? "http://localhost:3000").replace(/\/+$/, "");
const SEED = Number(arg("seed") ?? 1);
const ONLY = arg("set") as FormSetId | undefined;
const OUT = arg("out") ?? path.join(process.cwd(), ".fill-audit", "e2e");

interface Problem { where: string; detail: string }
const problems: Problem[] = [];
const say = (where: string, detail: string) => problems.push({ where, detail });

// ------------------------------------------------------------------ random

/** Deterministic per seed, so a failure can be reproduced exactly. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}
const rand = rng(SEED);
const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

// Deliberately awkward but legitimate: apostrophes, accents and hyphens are
// ordinary in Ontario names and are exactly what breaks a naive pipeline.
const FIRST = ["Siobhán", "O'Brien", "Jean-Luc", "María", "Kwame", "Anaïs", "Dmitri", "Leilani", "Søren", "Nguyễn"];
const LAST = ["Côté", "O'Sullivan", "Fitzgerald-Ng", "Müller", "Okonkwo", "D'Angelo", "Björnsson", "Rajagopalan"];
const STREET = ["College St", "Bathurst Street", "Rue Saint-Denis", "O'Connor Drive", "Queen's Park Cres W"];
const CITY = ["Toronto C01", "Mississauga", "Stoney Creek", "St. Catharines", "Niagara-on-the-Lake"];
const WORDS = ["parking", "locker", "balcony", "storage", "concierge", "utilities", "appliances"];

const name = () => `${pick(FIRST)} ${pick(LAST)}`;
const sentence = (n = 8) => Array.from({ length: n }, () => pick(WORDS)).join(" ");

function valueFor(field: { key: string; type: string; options?: { value: string }[] }): string {
  switch (field.type) {
    case "radio":
      return pick(field.options ?? [{ value: "/1" }]).value;
    case "checkbox":
      // Always ticked. An unticked box that started unticked fires no change
      // event, so nothing is stored — correct behaviour (the mapper skips it
      // and the PDF box stays off), but it exercises none of the path.
      return "/1";
    case "date":
      return `${int(2026, 2028)}-${String(int(1, 12)).padStart(2, "0")}-${String(int(1, 28)).padStart(2, "0")}`;
    case "currency":
      return String(int(1, 4000) * 1000 + int(0, 99) / 100).slice(0, 12);
    case "number":
      return String(int(1, 180));
    case "long_text":
      return sentence(14);
    default:
      if (/full_name|_name$|representative|agent/.test(field.key)) return name();
      if (/street_name/.test(field.key)) return pick(STREET);
      if (/street_number/.test(field.key)) return String(int(1, 9999));
      if (/city|municipal/.test(field.key)) return pick(CITY);
      if (/postal/.test(field.key)) return `M${int(1, 9)}${pick(["T", "V", "X"])} ${int(1, 9)}${pick(["P", "Z"])}${int(1, 9)}`;
      if (/province/.test(field.key)) return "Ontario";
      if (/phone/.test(field.key)) return `416-${int(200, 999)}-${int(1000, 9999)}`;
      if (/email/.test(field.key)) return `test${int(1, 999)}@example.com`;
      if (/time/.test(field.key)) return `${int(1, 12)}:${pick(["00", "30"])}`;
      if (/year/.test(field.key)) return String(int(2020, 2028));
      return sentence(int(2, 5));
  }
}

// ------------------------------------------------------------------- helpers

async function readPdfValues(file: string): Promise<Record<string, string>> {
  const { execFileSync } = await import("node:child_process");
  const out = execFileSync("python", ["scripts/read_pdf_values.py", file], { encoding: "utf-8" });
  return JSON.parse(out);
}

/** pypdf writes AcroForm text as-is; normalise only what a PDF viewer would. */
const norm = (s: string) => s.replace(/\r\n?/g, "\n").trim();

// --------------------------------------------------------------------- run

async function runSet(page: Page, setId: FormSetId) {
  const where = setId;
  const schema = filterSchemaForSet(getIntakeFormSchema(), setId);

  // 1. Create a deal for this specific set.
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  const radio = page.locator(`input[name="formSet"][value="${setId}"]`);
  if ((await radio.count()) === 0) { say(where, "no form-set radio on the dashboard"); return; }
  await radio.check({ force: true });
  await page.fill('input[placeholder*="203 College"]', `E2E ${setId} seed${SEED} ${Date.now()}`).catch(() => {});
  await Promise.all([
    page.waitForURL(/\/intake/, { timeout: 60_000 }).catch(() => {}),
    page.locator("button", { hasText: /create|new deal|start/i }).first().click(),
  ]);
  if (!page.url().includes("/intake")) { say(where, `create did not reach intake (${page.url()})`); return; }
  const dealId = new URL(page.url()).pathname.split("/")[2];

  try {
    // 2. Type into every question the set actually shows.
    //
    // Two passes, because some questions only appear once another answer
    // reveals them ("Key deposit amount" needs "Key deposit required" set
    // first). Pass one answers the controllers with exactly the value their
    // dependants are waiting for, so pass two sees every conditional field
    // rather than whichever ones a random draw happened to reveal.
    const reveal: Record<string, string> = {};
    for (const group of schema.groups) {
      for (const field of group.fields) {
        const m = field.condition?.match(/^(\w+)\s*==\s*'([^']*)'$/);
        if (m) reveal[m[1]] = m[2];
      }
    }

    const typed: Record<string, string> = {};
    const skipped: string[] = [];
    const ordered = schema.groups.flatMap((g) => g.fields.map((f) => ({ group: g, field: f })));
    for (const pass of [0, 1]) {
      for (const { field } of ordered) {
        if ((pass === 0) === Boolean(field.condition)) continue;
        // Attribute selector, not `#id`: CSS.escape does not exist in Node, and an
        // id selector would need escaping anyway.
        const el = page.locator(`[id="${field.key}"]`);
        if ((await el.count()) === 0) {
          if (!field.hidden) skipped.push(`${field.key} (no control rendered)`);
          continue;
        }
        const value = reveal[field.key] ?? valueFor(field);
        const tag = await el.evaluate((n) => n.tagName.toLowerCase());
        const readOnly = await el.evaluate((n) => (n as HTMLInputElement).readOnly === true);
        if (readOnly) { skipped.push(`${field.key} (read-only, derived)`); continue; }
        if (tag === "select") await el.selectOption(value);
        else if (await el.evaluate((n) => (n as HTMLInputElement).type === "checkbox"))
          await el.setChecked(value === "/1");
        else await el.fill(value);
        typed[field.key] = value;
      }
    }
    if (skipped.length) say(where, `${skipped.length} question(s) had no writable control: ${skipped.slice(0, 8).join(", ")}${skipped.length > 8 ? " …" : ""}`);

    // 3. Save and move on. The page autosaves; the button is the real path.
    await page.locator("button", { hasText: /continue|review|save/i }).first().click();
    await page.waitForURL(/\/review/, { timeout: 60_000 }).catch(() => {});
    if (!page.url().includes("/review")) { say(where, "continue did not reach review"); return; }

    // 4. What came back out of Postgres, before any PDF is involved.
    // GET returns the answers object itself, not { answers: ... }.
    const storedAnswers: Record<string, string> =
      (await (await page.request.get(`${BASE}/api/deals/${dealId}/intake`)).json()) ?? {};
    for (const [k, v] of Object.entries(typed)) {
      if (norm(storedAnswers[k] ?? "") !== norm(v)) {
        say(where, `round-trip: ${k} typed ${JSON.stringify(v)}, stored ${JSON.stringify(storedAnswers[k] ?? null)}`);
      }
    }

    // 5. Select every form and generate.
    const boxes = page.locator('input[type="checkbox"]');
    for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check({ force: true }).catch(() => {});
    const gen = page.locator("button", { hasText: /^generate/i }).first();
    if ((await gen.count()) === 0) { say(where, "no generate button"); return; }
    await gen.click();
    await page.locator("text=/generated pdfs/i").first().waitFor({ timeout: 120_000 }).catch(() => {});

    // 6. Download each PDF and compare it against what the mapper says the
    //    answers stored in step 4 should have produced.
    fs.mkdirSync(OUT, { recursive: true });
    for (const formId of FORM_SETS[setId].formIds as FormId[]) {
      const res = await page.request.get(`${BASE}/api/deals/${dealId}/download/${formId}?inline=1`);
      if (!res.ok()) { say(where, `${formId}: download returned ${res.status()}`); continue; }
      const file = path.join(OUT, `${setId}__${formId}.pdf`);
      fs.writeFileSync(file, await res.body());

      const expected = mapIntakeToFormFields(storedAnswers, formId, schema, getRawFormSchema(formId));
      const actual = await readPdfValues(file);
      for (const t of expected) {
        const got = actual[t.field_id];
        if (got === undefined || norm(got) === "") {
          say(where, `${formId}: ${t.field_id} should hold ${JSON.stringify(t.value)} but the downloaded PDF has it empty`);
        } else if (norm(got) !== norm(t.value)) {
          say(where, `${formId}: ${t.field_id} expected ${JSON.stringify(t.value)}, PDF has ${JSON.stringify(got)}`);
        }
      }
      console.log(`  ${setId}/${formId}: ${expected.length} boxes checked`);
    }
  } finally {
    // Always clean up, including after a thrown error — a failed run must not
    // leave deals behind in the account.
    await page.request.delete(`${BASE}/api/deals/${dealId}`).catch(() => {});
  }
}

async function main() {
  const email = process.env.E2E_EMAIL, password = process.env.E2E_PASSWORD;
  if (!email || !password) throw new Error("E2E_EMAIL and E2E_PASSWORD must be set in .env.local");

  const browser: Browser = await chromium.launch({ headless: !flag("headed") });
  const page = await browser.newPage();
  try {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.fill("#email", email);
    await page.fill("#password", password);
    await Promise.all([
      page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 }).catch(() => {}),
      page.getByRole("button", { name: /^sign in$/i }).click(),
    ]);
    if (page.url().includes("/login")) throw new Error("sign-in failed — check E2E_EMAIL / E2E_PASSWORD");

    for (const setId of FORM_SET_IDS) {
      if (ONLY && setId !== ONLY) continue;
      console.log(`\n${setId} (${FORM_SETS[setId].label})`);
      await runSet(page, setId);
    }
  } finally {
    await browser.close();
  }

  console.log();
  if (!problems.length) {
    console.log(`No problems. Every typed answer survived the intake UI, Postgres, generate and Storage into the right box. (seed ${SEED})`);
    return;
  }
  console.log(`${problems.length} problem(s) at seed ${SEED}:\n`);
  for (const p of problems) console.log(`  [${p.where}] ${p.detail}`);
  process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
