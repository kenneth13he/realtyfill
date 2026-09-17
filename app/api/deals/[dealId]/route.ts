// app/api/deals/[dealId]/route.ts
// Update or delete a single deal (Step 6 dashboard: rename it from its
// default "Untitled deal", close or reopen it, or remove it outright).
//
// DELETE exists because closing isn't erasing. A deal holds a real tenant's
// name, income, employer and rental history, and until this route existed the
// only way to remove any of it was to delete the whole account — so a realtor
// who typed a client's details into the wrong deal had no way to take them
// back out.

import { NextResponse } from "next/server";
import { isSameOrigin, crossOriginRefusal } from "@/lib/sameOrigin";
import { createClient } from "@/lib/supabase/server";
import { getOwnedDeal } from "@/lib/supabase/getOwnedDeal";
import { logError, userFacingError } from "@/lib/logger";

// "archived" was merged into "closed" (0005_merge_archived_into_closed.sql).
// The database constraint refuses it too; this answers with a 400 that names
// the valid values instead of surfacing a raw constraint violation as a 500.
const VALID_STATUSES = ["active", "closed"];

export async function PATCH(request: Request, { params }: { params: Promise<{ dealId: string }> }) {
  // Defence in depth behind the SameSite=Lax session cookie — see
  // lib/sameOrigin.ts for why a missing Origin is refused too.
  if (!isSameOrigin(request)) return crossOriginRefusal();
  const { dealId } = await params;
  const body = await request.json().catch(() => ({}));

  const update: Record<string, string> = {};
  if (typeof body?.label === "string" && body.label.trim()) update.label = body.label.trim();
  if (typeof body?.status === "string") {
    if (!VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` }, { status: 400 });
    }
    update.status = body.status;
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update — pass label and/or status" }, { status: 400 });
  }
  update.updated_at = new Date().toISOString();

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

  const { data: deal, error } = await supabase.from("deals").update(update).eq("id", dealId).select().single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ deal });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ dealId: string }> }) {
  // Defence in depth behind the SameSite=Lax session cookie — see
  // lib/sameOrigin.ts for why a missing Origin is refused too.
  if (!isSameOrigin(request)) return crossOriginRefusal();
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

  // Storage first, and only then the row. Deleting the row first would cascade
  // generated_forms away and take the storage_path values with it, stranding
  // the PDFs in the bucket with nothing left pointing at them — the row is the
  // only record of where they live.
  //
  // Objects are keyed {user_id}/{deal_id}/{form_id}.pdf, and the bucket's RLS
  // policy scopes this client to the caller's own prefix (0001_init.sql), so a
  // path built from another user's id would simply match nothing.
  const prefix = `${user.id}/${dealId}`;
  const { data: objects, error: listErr } = await supabase.storage.from("generated-forms").list(prefix);
  if (listErr) {
    const ref = logError({ route: "deal-delete", userId: user.id, dealId }, listErr);
    return NextResponse.json({ error: userFacingError(ref, "Couldn't delete this deal."), ref }, { status: 500 });
  }
  if (objects && objects.length > 0) {
    const { error: removeErr } = await supabase.storage
      .from("generated-forms")
      .remove(objects.map((object) => `${prefix}/${object.name}`));
    if (removeErr) {
      // Stop here rather than deleting the row anyway: leaving the deal intact
      // means the user can retry, where a half-done delete would leave PDFs
      // behind that nothing in the app can ever reach again.
      const ref = logError({ route: "deal-delete", userId: user.id, dealId }, removeErr);
      return NextResponse.json({ error: userFacingError(ref, "Couldn't delete this deal's files."), ref }, { status: 500 });
    }
  }

  // deal_intake and generated_forms are ON DELETE CASCADE (0001_init.sql), so
  // this one statement removes the answers and the generation records with it.
  const { error: deleteErr } = await supabase.from("deals").delete().eq("id", dealId);
  if (deleteErr) {
    const ref = logError({ route: "deal-delete", userId: user.id, dealId }, deleteErr);
    return NextResponse.json({ error: userFacingError(ref, "Couldn't delete this deal."), ref }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
