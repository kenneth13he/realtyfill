// app/deals/[dealId]/intake/page.tsx
// The Deal Intake Form for one deal. Phase 2 replacement for app/intake/page.tsx:
// reads deal_intake.answers from Postgres (RLS-scoped to the signed-in user)
// instead of the old single data/deal.json. proxy.ts already blocks a
// logged-out visitor from reaching this route at all; notFound() here
// additionally covers a logged-in user hitting a dealId that isn't theirs
// (RLS makes the row simply not appear, same as truly not existing) or that
// truly doesn't exist.

import { notFound } from "next/navigation";
import { getIntakeFormSchema } from "@/lib/schemas";
import { FORM_SETS, filterSchemaForSet, toFormSetId, withSchemaDefaults } from "@/lib/formTypes";
import { createClient } from "@/lib/supabase/server";
import Header from "@/components/Header";
import IntakeForm from "./IntakeForm";

export default async function IntakePage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const supabase = await createClient();

  const [{ data: deal }, { data: intakeRow }, fullSchema] = await Promise.all([
    supabase.from("deals").select("id, label, form_set").eq("id", dealId).maybeSingle(),
    supabase.from("deal_intake").select("answers").eq("deal_id", dealId).maybeSingle(),
    getIntakeFormSchema(),
  ]);

  if (!deal) {
    notFound();
  }

  // Only ask what this deal's forms actually use — a purchase deal has no
  // rent, utilities or tenant-insurance questions.
  const formSet = FORM_SETS[toFormSetId(deal.form_set)];
  const schema = filterSchemaForSet(fullSchema, formSet.id);
  const savedAnswers = (intakeRow?.answers as Record<string, string>) ?? {};
  // Before the defaults go in, or a brand-new deal would look like an edit.
  const isEditing = Object.keys(savedAnswers).length > 0;
  const initialAnswers = withSchemaDefaults(schema, savedAnswers);

  return (
    <>
      <Header active="intake" dealId={dealId} />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--color-text)]">{deal.label}</h1>
        <p className="mt-1 text-sm font-medium text-[var(--color-accent)]">{formSet.label}</p>
        <p className="mt-1 text-[var(--color-text-muted)]">
          {isEditing
            ? "Editing this deal's saved answers — changes here won't take effect until you continue to review."
            : "Fill this out once — it flows into every form you generate for this deal."}
        </p>
        <div className="mt-8">
          <IntakeForm dealId={dealId} schema={schema} initialAnswers={initialAnswers} />
        </div>
      </main>
    </>
  );
}
