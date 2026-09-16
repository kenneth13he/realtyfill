// app/api/deals/[dealId]/download-all/route.ts
// Every generated PDF for one deal, as a single .zip.
//
// The per-form route next door (download/[form]) redirects to a short-lived
// signed URL and lets Storage serve the bytes, which is the right shape for
// one file. It doesn't generalise to a set: the browser can't be handed five
// redirects at once, and clicking five links in a row is blocked as a popup
// in Safari and prompts "download multiple files?" in Chrome. So this route
// does fetch the bytes through the server — the one place that costs us
// anything, and the reason it reads at most a handful of PDFs rather than
// streaming an unbounded set.
//
// Archive is stored, not deflated: PDFs are already compressed. See lib/zip.ts.

import { NextResponse } from "next/server";
import { FORM_LABELS, FormId } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";
import { getOwnedDeal } from "@/lib/supabase/getOwnedDeal";
import { logError, userFacingError } from "@/lib/logger";
import { createZip, safeFileName, type ZipEntry } from "@/lib/zip";

// Five Storage reads plus the zip. Well under this in practice; the default
// 10s on a Vercel Hobby function is not.
export const maxDuration = 60;

export async function GET(_request: Request, { params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await getOwnedDeal(supabase, dealId))) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  const [{ data: deal }, { data: rows, error }] = await Promise.all([
    supabase.from("deals").select("label").eq("id", dealId).maybeSingle(),
    supabase.from("generated_forms").select("form_id, storage_path").eq("deal_id", dealId),
  ]);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: "Nothing generated yet — run Generate first" }, { status: 404 });
  }

  const entries: ZipEntry[] = [];
  for (const row of rows as { form_id: FormId; storage_path: string }[]) {
    const { data: blob, error: downloadError } = await supabase.storage
      .from("generated-forms")
      .download(row.storage_path);
    if (downloadError || !blob) {
      // Deliberately not a partial archive. A zip missing one of the five
      // forms, downloaded and filed away, is worse than an error: the gap
      // wouldn't be noticed until someone needed the form.
      const ref = logError(
        { route: "download-all", userId: user.id, dealId, form: row.form_id },
        downloadError ?? new Error("Storage download returned no data")
      );
      return NextResponse.json(
        { error: userFacingError(ref, "Couldn't read one of the generated forms."), ref },
        { status: 500 }
      );
    }
    entries.push({
      // Same naming as the single-form download, so a file pulled out of the
      // zip is indistinguishable from one downloaded on its own.
      name: `${FORM_LABELS[row.form_id].split(" — ")[0]}.pdf`,
      data: new Uint8Array(await blob.arrayBuffer()),
    });
  }

  const zip = createZip(entries);
  const filename = `${safeFileName(deal?.label ?? "", "RealtyFill forms")}.zip`;

  return new NextResponse(zip as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(zip.length),
      // The quoted form covers the common case; filename* carries the label
      // verbatim for anything non-ASCII, which a street name can easily be.
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      // Signed-in, per-user content that changes whenever forms are
      // regenerated. Nothing in between should hold on to it.
      "Cache-Control": "private, no-store",
    },
  });
}
