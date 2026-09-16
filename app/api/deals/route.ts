// app/api/deals/route.ts
// List/create deals for the signed-in user (Step 6's dashboard). Creating a
// deal seeds an empty deal_intake row so downstream reads (GET on
// /api/deals/[dealId]/intake) can always assume the row exists rather than
// branching on "not created yet" everywhere.

import { NextResponse } from "next/server";
import { isSameOrigin, crossOriginRefusal } from "@/lib/sameOrigin";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_FORM_SET, FORM_SETS, isFormSetId } from "@/lib/formTypes";
import { LIMITS } from "@/lib/inputLimits";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase.from("deals").select("*").order("updated_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ deals: data });
}

export async function POST(request: Request) {
  // Defence in depth behind the SameSite=Lax session cookie — see
  // lib/sameOrigin.ts for why a missing Origin is refused too.
  if (!isSameOrigin(request)) return crossOriginRefusal();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  // Capped: this is a property address, and an unbounded string here goes
  // straight into the database and onto every dashboard row.
  const rawLabel = typeof body?.label === "string" ? body.label.trim() : "";
  const label = rawLabel ? rawLabel.slice(0, LIMITS.labelChars) : "Untitled deal";

  // Which bundle of forms this deal is for. Rejected rather than defaulted
  // when unrecognised: silently filing a deal under the wrong transaction
  // type would hand the realtor the wrong legal forms later.
  const formSet = body?.formSet === undefined ? DEFAULT_FORM_SET : body.formSet;
  if (!isFormSetId(formSet)) {
    return NextResponse.json({ error: `Unknown form set: ${String(formSet)}` }, { status: 400 });
  }
  if (!FORM_SETS[formSet].ready) {
    return NextResponse.json(
      { error: `"${FORM_SETS[formSet].label}" isn't available yet — its forms aren't ready to fill.` },
      { status: 400 }
    );
  }

  const { data: deal, error } = await supabase
    .from("deals")
    .insert({ user_id: user.id, label, form_set: formSet })
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Seed brokerage defaults from the user's profile (Settings, Step 7) so a
  // new deal doesn't start from a completely blank slate every time.
  const { data: profile } = await supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle();
  const seedAnswers: Record<string, string> = {};
  if (profile?.brokerage_name) seedAnswers.listing_brokerage_name = profile.brokerage_name;
  if (profile?.full_name) seedAnswers.listing_brokerage_agent_name = profile.full_name;
  if (profile?.phone) seedAnswers.listing_brokerage_phone = profile.phone;
  // The RECO acknowledgement names YOU and YOUR brokerage on every set, whichever
  // side of the deal you are on, so these two seed unconditionally.
  if (profile?.brokerage_name) seedAnswers.reco_brokerage_name = profile.brokerage_name;
  if (profile?.full_name) seedAnswers.reco_agent_name = profile.full_name;

  const { error: intakeErr } = await supabase.from("deal_intake").insert({ deal_id: deal.id, answers: seedAnswers });
  if (intakeErr) {
    return NextResponse.json({ error: intakeErr.message }, { status: 500 });
  }

  return NextResponse.json({ deal });
}
