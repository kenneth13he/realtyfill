import { loadEnvLocal } from "./loadEnv"; loadEnvLocal();
import { chromium } from "playwright";

const BASE = process.argv.includes("--local") ? "http://localhost:3000" : "https://realtyfill.vercel.app";

async function main() {
  const b = await chromium.launch();
  const p = await b.newPage();
  const errors: string[] = [];
  p.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });

  await p.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await p.fill("#email", process.env.E2E_EMAIL!);
  await p.fill("#password", process.env.E2E_PASSWORD!);
  await p.getByRole("button", { name: /^sign in$/i }).click();
  await p.waitForURL(u => !u.pathname.startsWith("/login"), { timeout: 45000 }).catch(() => {});

  await p.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1500);

  // The exact set from the screenshot.
  const radio = p.locator(`input[name="formSet"][value="${process.env.SET ?? "lease_landlord"}"]`);
  await radio.check({ force: true });
  await p.locator("button", { hasText: /create deal/i }).first().click();
  await p.waitForURL(/\/intake/, { timeout: 45000 }).catch(() => {});
  await p.waitForTimeout(1500);

  const inputs = p.locator('main input[type="text"], main input:not([type])');
  for (let i = 0; i < Math.min(await inputs.count(), 3); i++) await inputs.nth(i).fill("Test " + i).catch(() => {});
  await p.locator("button", { hasText: /continue|review|save/i }).first().click();
  await p.waitForURL(/\/review/, { timeout: 45000 }).catch(() => {});
  await p.waitForTimeout(1500);

  const boxes = p.locator('main input[type="checkbox"]');
  const n = await boxes.count();
  for (let i = 0; i < n; i++) await boxes.nth(i).check().catch(() => {});
  console.log(`set=${process.env.SET ?? "lease_landlord"} selected ${n} forms`);

  await p.locator("button", { hasText: /generate/i }).first().click();
  const ok = await p.locator("text=/generated pdfs/i").first().waitFor({ timeout: 180000 }).then(() => true).catch(() => false);
  const err = await p.locator('[role="alert"]').first().textContent().catch(() => null);

  console.log(ok ? "RESULT: generated successfully" : "RESULT: FAILED");
  if (err) console.log("alert:", err.trim().slice(0, 200));
  if (errors.length) console.log("console errors:", errors.slice(0, 3));

  // Clean up the deal this created.
  await p.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1200);
  const del = p.locator("button", { hasText: /^delete$/i }).first();
  if (await del.count()) {
    await del.click(); await p.waitForTimeout(400);
    await p.locator("button", { hasText: /delete forever/i }).first().click().catch(() => {});
    await p.waitForTimeout(2500);
  }
  await b.close();
}
void main();
