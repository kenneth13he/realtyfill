// lib/pdfFill.ts
// Fills one blank PDF template with a field-value list and writes the output
// PDF. This is the "hard part" already proven to work for the 2229E (see
// project-context.md section 5) — reverse-engineered radio-group value
// semantics, verified visually across every page.
//
// Two deployment modes, same underlying Python/pypdf fill logic:
//   - Local dev / Render+Docker (Dockerfile puts Node and Python in the same
//     container): shells out to scripts/fill_fillable_fields.py directly —
//     the original approach, unchanged.
//   - Vercel (its Node functions have no Python at runtime at all — porting
//     to a JS PDF library was ruled out for the same reason as always: that
//     Python script is already proven correct against real forms, and
//     porting risks re-introducing bugs like the multi-page field-clearing
//     bug caught while building forms/blank_templates/*_blank.pdf): calls
//     pdf-service/, a separate Vercel Service running the same fill logic
//     over HTTP via the PDF_SERVICE_URL binding declared in vercel.json.
//
// Both modes run one shared implementation: pdf-service/fill_fillable_fields.py
// holds the only copy, and scripts/fill_fillable_fields.py is a thin CLI
// wrapper importing it (the dependency points that way because pdf-service/
// deploys as its own Vercel root and can't import from outside itself).
// There is nothing left to "keep in sync". Mode is selected by
//     whether PDF_SERVICE_URL is set, so this file's exported signature
//     doesn't change and neither does its one caller
//     (app/api/deals/[dealId]/generate/route.ts).

import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { FillableField } from "./profileMapper";

const execFileAsync = promisify(execFile);

const SCRIPT_PATH = path.join(process.cwd(), "scripts", "fill_fillable_fields.py");

// On Windows, "python"/"python3" can resolve to the Microsoft Store's app
// execution alias stub instead of a real interpreter, depending on PATH
// order in whatever shell launched `next dev` — so probe candidates instead
// of assuming one name works.
const PYTHON_CANDIDATES = process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];
let resolvedPythonBin: string | null = null;

async function resolvePythonBin(): Promise<string> {
  if (resolvedPythonBin) return resolvedPythonBin;
  for (const candidate of PYTHON_CANDIDATES) {
    try {
      const { stdout } = await execFileAsync(candidate, ["--version"]);
      if (/^Python \d/.test(stdout.trim())) {
        resolvedPythonBin = candidate;
        return candidate;
      }
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    `No working Python interpreter found on PATH (tried: ${PYTHON_CANDIDATES.join(", ")}). Install Python 3 and ensure it's on PATH.`
  );
}

export async function fillPdf(
  blankTemplatePath: string,
  fields: FillableField[],
  outputPath: string
): Promise<void> {
  if (process.env.PDF_SERVICE_URL) {
    return fillPdfViaService(blankTemplatePath, fields, outputPath);
  }
  return fillPdfViaSubprocess(blankTemplatePath, fields, outputPath);
}

async function fillPdfViaSubprocess(blankTemplatePath: string, fields: FillableField[], outputPath: string): Promise<void> {
  const tmpJsonPath = path.join(os.tmpdir(), `field_values_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
  await fs.writeFile(tmpJsonPath, JSON.stringify(fields, null, 2));

  try {
    const pythonBin = await resolvePythonBin();
    await execFileAsync(pythonBin, [SCRIPT_PATH, blankTemplatePath, tmpJsonPath, outputPath]);
  } catch (err) {
    const stderr = (err as { stderr?: string })?.stderr;
    throw new Error(stderr ? `fill_fillable_fields.py failed: ${stderr}` : String(err));
  } finally {
    await fs.unlink(tmpJsonPath).catch(() => {});
  }
}

async function fillPdfViaService(blankTemplatePath: string, fields: FillableField[], outputPath: string): Promise<void> {
  const blankBytes = await fs.readFile(blankTemplatePath);

  // Multipart with the PDF as raw bytes, not base64 inside JSON. Base64 adds
  // 33%, and Vercel caps a function's request AND response bodies at 4.5 MB:
  // the 3.43 MB RECO guide encoded to 4.57 MB and broke generation for every
  // form set in production with a 500. Only in production — the local dev
  // path shells out to Python and never makes this request.
  const form = new FormData();
  form.append("fields", JSON.stringify(fields));
  form.append("pdf", new Blob([new Uint8Array(blankBytes)], { type: "application/pdf" }), "blank.pdf");

  const res = await fetch(new URL("/fill", process.env.PDF_SERVICE_URL), { method: "POST", body: form });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail;
    const message = Array.isArray(detail) ? detail.join("; ") : (detail ?? (await res.text().catch(() => res.statusText)));
    throw new Error(`pdf-service /fill failed (${res.status}): ${message}`);
  }

  // Comes back as application/pdf, for the same size reason.
  await fs.writeFile(outputPath, Buffer.from(await res.arrayBuffer()));
}
