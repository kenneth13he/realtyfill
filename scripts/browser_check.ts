// scripts/browser_check.ts
// Drives the real app in a real browser and reports what a human doing the
// same run-through would have to watch for by eye.
//
//   npx tsx scripts/browser_check.ts                 # desktop, headless
//   npx tsx scripts/browser_check.ts --mobile        # 375px iPhone SE viewport
//   npx tsx scripts/browser_check.ts --headed --slow # watch it happen
//   npx tsx scripts/browser_check.ts --url https://realtyfill.ca
//
// What it checks that a person can't reliably catch:
//
//   - CSP violations. These only appear in the devtools console, they're
//     easy to scroll past, and they gate flipping next.config.ts's
//     CSP_HEADER from Report-Only to enforcing. Every one is captured here
//     with the directive that fired.
//   - Any console error or failed request, on every page visited.
//   - Horizontal overflow, measured as scrollWidth > clientWidth rather than
//     judged by looking for a scrollbar.
//   - Focus rings: tabs through the page and reports any focusable element
//     that renders no visible outline, box-shadow or ring.
//
// What it deliberately does NOT replace: a real iPhone. iOS Safari refuses to
// render PDFs in an iframe in ways no emulator reproduces, and that is
// exactly where the preview step is most likely to misbehave.
//
// Requires E2E_EMAIL / E2E_PASSWORD in .env.local (a dedicated account, not
// yours). It cleans up the deals it creates.

import { chromium, type Browser, type ConsoleMessage, type Page, type Request } from "playwright";
import fs from "fs";
import path from "path";
import { loadEnvLocal } from "./loadEnv";

// ---------------------------------------------------------------- env + args

loadEnvLocal();

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const flag = (name: string) => process.argv.includes(`--${name}`);

const BASE = (arg("url") ?? "http://localhost:3000").replace(/\/+$/, "");
const MOBILE = flag("mobile");
const HEADED = flag("headed");
const SLOW = flag("slow") ? 400 : 0;

// ------------------------------------------------------------------ findings

type Severity = "csp" | "error" | "layout" | "a11y" | "flow";
interface Finding {
  severity: Severity;
  where: string;
  detail: string;
}
const findings: Finding[] = [];
const record = (severity: Severity, where: string, detail: string) =>
  findings.push({ severity, where, detail });

let currentPageName = "startup";

/** Console noise that isn't ours and would drown the real signal. */
const IGNORABLE = [
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /React DevTools/i,
  // Not a violation: Chromium noting that this directive is inert while the
  // policy is Report-Only. It says nothing about whether the page complies,
  // and counting it as a violation would block the very flip that resolves it.
  /'upgrade-insecure-requests' is ignored when delivered in a report-only policy/i,
];

function watch(page: Page) {
  page.on("console", (msg: ConsoleMessage) => {
    const text = msg.text();
    if (IGNORABLE.some((re) => re.test(text))) return;

    // Chromium words CSP violations as "Refused to ..." — the phrase is the
    // reliable marker, since the console type is just "error".
    if (/Content Security Policy|Refused to (load|execute|apply|connect|frame)/i.test(text)) {
      record("csp", currentPageName, text.replace(/\s+/g, " ").slice(0, 400));
      return;
    }
    if (msg.type() === "error") {
      // The admin probe is *supposed* to 404 for a non-admin account; the
      // browser logs that as a failed resource load either way.
      if (currentPageName.startsWith("admin") && /404/.test(text)) return;
      record("error", currentPageName, text.replace(/\s+/g, " ").slice(0, 400));
    }
  });

  page.on("pageerror", (err) => record("error", currentPageName, `uncaught: ${err.message}`));

  page.on("requestfailed", (req: Request) => {
    // net::ERR_ABORTED is what a cancelled navigation or prefetch looks like;
    // it isn't a failure worth reporting.
    const failure = req.failure()?.errorText ?? "";
    if (/ERR_ABORTED/.test(failure)) return;
    if (currentPageName.startsWith("admin")) return; // expected 404, see above
    record("error", currentPageName, `request failed ${req.method()} ${req.url().slice(0, 120)} — ${failure}`);
  });
}

// ------------------------------------------------------------------- probes

async function checkOverflow(page: Page, where: string) {
  const overflow = await page.evaluate(() => {
    const el = document.documentElement;
    const widest = [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((n) => n.getBoundingClientRect().right > el.clientWidth + 1)
      .slice(0, 3)
      .map((n) => `${n.tagName.toLowerCase()}.${(n.className || "").toString().split(" ")[0]}`);
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, widest };
  });
  if (overflow.scrollWidth > overflow.clientWidth + 1) {
    record(
      "layout",
      where,
      `horizontal overflow: scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth}` +
        (overflow.widest.length ? ` — widest: ${overflow.widest.join(", ")}` : "")
    );
  }
}

/**
 * Tab through the page and flag any stop with no visible focus indicator.
 *
 * Checks computed styles rather than screenshots: a ring drawn with outline,
 * box-shadow or a ring-* utility all count, and `outline: none` with nothing
 * replacing it does not.
 */
async function checkFocusRings(page: Page, where: string, maxStops = 25) {
  const seen = new Set<string>();
  for (let i = 0; i < maxStops; i++) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      // next/dev's error overlay is a focusable custom element that isn't
      // part of the app and doesn't exist in production.
      if (el.tagName.toLowerCase() === "nextjs-portal") return { id: "nextjs-portal", visible: true };
      const s = getComputedStyle(el);
      const id =
        el.tagName.toLowerCase() +
        (el.id ? `#${el.id}` : "") +
        (el.textContent ? `:${el.textContent.trim().slice(0, 24)}` : "");
      const hasOutline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
      const hasShadow = s.boxShadow !== "none" && s.boxShadow.length > 0;
      return { id, visible: hasOutline || hasShadow };
    });
    if (!stop) break;
    if (seen.has(stop.id)) break; // wrapped around
    seen.add(stop.id);
    if (!stop.visible) record("a11y", where, `no visible focus ring on ${stop.id}`);
  }
}

async function goto(page: Page, pathname: string, name: string) {
  currentPageName = name;
  await page.goto(BASE + pathname, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
  await checkOverflow(page, name);
}

// --------------------------------------------------------------------- flow

async function run(browser: Browser) {
  const context = await browser.newContext(
    MOBILE
      ? { viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: 1280, height: 900 } }
  );
  const page = await context.newPage();
  watch(page);

  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) throw new Error("E2E_EMAIL and E2E_PASSWORD must be set in .env.local");

  // 1. Landing page
  await goto(page, "/", "landing");
  if (!MOBILE) await checkFocusRings(page, "landing");

  // 2. Sign in
  currentPageName = "login";
  await goto(page, "/login", "login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  // By name, not button[type="submit"] — "Continue with Google" is also a
  // submit button and comes first in the DOM, so the generic selector sent
  // the whole run to Google's consent screen and every later step failed
  // for the wrong reason.
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 }).catch(() => {}),
    page.getByRole("button", { name: /^sign in$/i }).click(),
  ]);
  await page.waitForTimeout(1200);
  if (page.url().includes("/login")) {
    const msg = await page.locator('[role="alert"]').first().textContent().catch(() => null);
    record("flow", "login", `still on /login after submit${msg ? ` — ${msg.trim()}` : ""}`);
    return; // everything after this needs a session
  }

  // 3. Dashboard + create a deal
  await goto(page, "/dashboard", "dashboard");
  if (!MOBILE) await checkFocusRings(page, "dashboard");

  const createButton = page
    .locator("button", { hasText: /create|new deal|start/i })
    .first();
  if ((await createButton.count()) === 0) {
    record("flow", "dashboard", "found no create-deal button");
  } else {
    await createButton.click();
    // Wait for the navigation, not a guessed duration: production is slower
    // than localhost, and a fixed timeout silently skipped the whole
    // review/generate half of this run on the deployed site.
    await page.waitForURL(/\/intake/, { timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(1200);
    currentPageName = "intake";
    await checkOverflow(page, "intake");
    if (!page.url().includes("/intake")) {
      record("flow", "dashboard", `create-deal did not reach intake — landed on ${new URL(page.url()).pathname}`);
    }
  }

  // 4. Intake — type into the first few text inputs
  if (page.url().includes("/intake")) {
    const inputs = page.locator('main input[type="text"], main input:not([type])');
    const n = Math.min(await inputs.count(), 4);
    for (let i = 0; i < n; i++) {
      await inputs.nth(i).fill("Test value " + i).catch(() => {});
    }
    await page.waitForTimeout(800);
    await checkOverflow(page, "intake (filled)");

    const cont = page.locator("button", { hasText: /continue|review|save/i }).first();
    if ((await cont.count()) === 0) {
      record("flow", "intake", "no continue/review button found");
    } else {
      await cont.click();
      await page.waitForURL(/\/review/, { timeout: 45_000 }).catch(() => {});
      await page.waitForTimeout(1200);
    }
  } else {
    record("flow", "intake", `skipped — not on an intake page (${new URL(page.url()).pathname})`);
  }

  // 5. Review + generate
  if (!page.url().includes("/review")) {
    record("flow", "review", `skipped — never reached review (on ${new URL(page.url()).pathname})`);
  }
  if (page.url().includes("/review")) {
    currentPageName = "review";
    await checkOverflow(page, "review");

    // Generate stays disabled until at least one form is ticked, so the
    // earlier version of this script sat waiting 30s on a button that was
    // never going to enable.
    const boxes = page.locator('main input[type="checkbox"]');
    const boxCount = await boxes.count();
    for (let i = 0; i < boxCount; i++) await boxes.nth(i).check().catch(() => {});
    record("flow", "review", `selected ${boxCount} form(s) to generate`);
    await page.waitForTimeout(500);

    const generate = page.locator("button", { hasText: /generate/i }).first();
    if ((await generate.count()) > 0 && (await generate.isEnabled())) {
      await generate.click();
      // Generation does real work per form (fill + upload), so wait for the
      // results panel rather than guessing at a duration.
      await page
        .locator("text=/generated pdfs/i")
        .first()
        .waitFor({ timeout: 180_000 })
        .catch(() => record("flow", "review", "no 'Generated PDFs' panel appeared within 180s"));
      await page.waitForTimeout(1500);
      await checkOverflow(page, "review (generated)");

      // 6. Expand a preview — the iframe is the piece most likely to be
      // blocked by CSP frame-src, and to misbehave on mobile.
      const preview = page.locator("button", { hasText: /preview|▼|expand/i }).first();
      if ((await preview.count()) > 0) {
        await preview.click();
        await page.waitForTimeout(4000);
        // Counting DOM nodes was the wrong test: the iframe is always
        // rendered and hidden with `hidden sm:block`, so what matters is
        // which of the two is actually visible at this width.
        const frame = page.locator("iframe").first();
        const inDom = (await frame.count()) > 0;
        const frameVisible = inDom && (await frame.isVisible());
        const note = page.locator("text=/open in new tab|preview.*new tab|tap .*open/i").first();
        const noteVisible = (await note.count()) > 0 && (await note.isVisible());

        if (MOBILE && frameVisible) {
          record("layout", "review", "the PDF iframe is visible at 375px — it should be hidden, with the explanation instead");
        }
        if (!MOBILE && !frameVisible) {
          record("layout", "review", "the PDF iframe is not visible on desktop, where it should be");
        }
        record(
          "flow",
          "review",
          `preview expanded — iframe ${frameVisible ? "visible" : "hidden"}, escape-hatch link ${noteVisible ? "visible" : "absent"}`
        );
        await checkOverflow(page, "review (preview open)");
      }
    }
  }

  // 7. Delete the deal — both a checklist step and this script's cleanup.
  //    Without it every run leaves a deal and five PDFs behind in the real
  //    database; eight runs put 35 files in Storage before this was added.
  await goto(page, "/dashboard", "dashboard (delete)");
  const remove = page.locator("button", { hasText: /^delete$/i }).first();
  if ((await remove.count()) > 0) {
    await remove.click();
    await page.waitForTimeout(400);
    const confirm = page.locator("button", { hasText: /delete forever/i }).first();
    if ((await confirm.count()) > 0) {
      await confirm.click();
      await page.waitForTimeout(3000);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
      const stillThere = await page.locator("button", { hasText: /delete forever/i }).count();
      record("flow", "dashboard", stillThere > 0 ? "a deal survived delete + refresh" : "deal deleted and stayed deleted");
    } else {
      record("flow", "dashboard", "delete confirmation button not found");
    }
  } else {
    record("flow", "dashboard", "no Delete control found — test deals will accumulate");
  }

  // 8. Settings
  await goto(page, "/settings", "settings");
  const save = page.locator("button", { hasText: /save/i }).first();
  if ((await save.count()) > 0) {
    await save.click();
    await page.waitForTimeout(1500);
  }

  // 9. Support + admin (admin should 404 for this account — it isn't listed)
  await goto(page, "/support", "support");
  currentPageName = "admin (expected 404)";
  const res = await page.goto(BASE + "/admin/support", { waitUntil: "domcontentloaded" });
  if (res && res.status() === 200 && !page.url().includes("/login")) {
    record("flow", "admin", "SECURITY: a non-admin account reached /admin/support with 200");
  } else {
    record("flow", "admin", `admin page correctly refused a non-admin (HTTP ${res?.status()})`);
  }

  await context.close();
}

// ------------------------------------------------------------------- report

async function main() {
  const browser = await chromium.launch({ headless: !HEADED, slowMo: SLOW });
  const started = Date.now();
  try {
    await run(browser);
  } catch (err) {
    record("flow", currentPageName, `run aborted: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await browser.close();
  }

  const by = (s: Severity) => findings.filter((f) => f.severity === s);
  const label: Record<Severity, string> = {
    csp: "CSP VIOLATIONS (these gate flipping CSP_HEADER to enforcing)",
    error: "CONSOLE ERRORS / FAILED REQUESTS",
    layout: "HORIZONTAL OVERFLOW",
    a11y: "MISSING FOCUS RINGS",
    flow: "FLOW NOTES",
  };

  console.log(`\n${MOBILE ? "MOBILE 375px" : "DESKTOP 1280px"} · ${BASE} · ${((Date.now() - started) / 1000).toFixed(0)}s\n`);
  for (const sev of ["csp", "error", "layout", "a11y", "flow"] as Severity[]) {
    const list = by(sev);
    if (list.length === 0) continue;
    console.log(`${label[sev]} — ${list.length}`);
    for (const f of list) console.log(`  [${f.where}] ${f.detail}`);
    console.log();
  }

  const blocking = by("csp").length + by("error").length + by("layout").length;
  if (blocking === 0 && by("a11y").length === 0) {
    console.log("No CSP violations, console errors, overflow or missing focus rings.\n");
  }
  const enforcing = !/Report-Only/i.test(
    fs.readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8").match(/const CSP_HEADER = "(.+)"/)?.[1] ?? ""
  );
  console.log(
    by("csp").length === 0
      ? `CSP: clean on this run (policy is ${enforcing ? "ENFORCING" : "report-only — flip CSP_HEADER once mobile passes too"}).`
      : `CSP: ${by("csp").length} violation(s) — fix the page, don't widen the policy.`
  );
  process.exit(blocking > 0 ? 1 : 0);
}

void main();
