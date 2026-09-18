// app/api/profile/route.ts
// Profile + brokerage defaults (Step 7 Settings page). Same shape/pattern as
// app/api/deals/[dealId]/intake/route.ts — one row per user instead of per
// deal, RLS-scoped via the profiles_owner policy (supabase/migrations/0001_init.sql).
// Read by app/api/deals/route.ts when creating a new deal, to seed its
// brokerage fields.

import { NextResponse } from "next/server";
import { isSameOrigin, crossOriginRefusal } from "@/lib/sameOrigin";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    profile: data ?? { full_name: "", phone: "", brokerage_name: "", brokerage_address: "" },
  });
}

export async function POST(request: Request) {
  // Defence in depth behind the SameSite=Lax session cookie — see
  // lib/sameOrigin.ts for why a missing Origin is refused too.
  if (!isSameOrigin(request)) return crossOriginRefusal();
  const body = await request.json().catch(() => ({}));
  // brokerage_address is still accepted, and no longer written by the form.
  // It held the whole address on one line; the forms print street, city,
  // province and postal code as four separate boxes, so it has been split.
  // Kept here so a save from a browser tab left open on the previous deploy
  // doesn't fail (0006_profile_brokerage_details.sql).
  const fields = [
    "full_name", "phone", "agent_email",
    "brokerage_name", "brokerage_address",
    "brokerage_street", "brokerage_city", "brokerage_province", "brokerage_postal_code",
    "brokerage_phone", "brokerage_fax",
  ] as const;
  const update: Record<string, string> = {};
  for (const field of fields) {
    if (typeof body?.[field] === "string") update[field] = body[field];
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase
    .from("profiles")
    .upsert({ user_id: user.id, ...update, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
