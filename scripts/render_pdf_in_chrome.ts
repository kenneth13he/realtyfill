// scripts/render_pdf_in_chrome.ts
// Screenshots a generated PDF as Chrome's own PDF viewer draws it.
//
//   npx tsx scripts/render_pdf_in_chrome.ts out.pdf shot.png [pageNumber]
//
// PyMuPDF is what every other check in this repo renders with, and it is not
// what a realtor uses. The two disagree in ways that matter: PyMuPDF happily
// draws a value past its field's /MaxLen, and it generates its own appearance
// for a field that has none. Chrome — which is what a realtor sees, both in
// the review page's preview iframe and when they open the download — makes
// its own decisions about both. When a question is "what will they actually
// see", this is the only honest way to answer it.

import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

async function main() {
  const [file, out, pageArg] = process.argv.slice(2);
  if (!file || !out) {
    console.error("usage: npx tsx scripts/render_pdf_in_chrome.ts <pdf> <png> [page]");
    process.exitCode = 1;
    return;
  }
  const page = Number(pageArg ?? 1);

  // channel "chrome" is the real installed browser. Playwright's bundled
  // Chromium ships without the PDF viewer plugin and simply downloads the
  // file instead of drawing it, which answers nothing.
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const tab = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
  // #page= is Chrome's own PDF-viewer fragment; pathToFileURL keeps Windows
  // backslashes out of the URL entirely.
  await tab.goto(`${pathToFileURL(path.resolve(file)).href}#page=${page}&zoom=125`, {
    waitUntil: "commit",
  });
  // The viewer is a plugin: there is no DOM event that means "the page is
  // painted", so this waits rather than polls for something that never fires.
  await tab.waitForTimeout(5000);
  await tab.screenshot({ path: out });
  await browser.close();
  console.log(`wrote ${out} (page ${page})`);
}

main();
