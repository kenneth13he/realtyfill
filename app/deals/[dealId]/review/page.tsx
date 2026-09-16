// app/deals/[dealId]/review/page.tsx
// Review + form-selection screen for one deal. Phase 2 replacement for
// app/review/page.tsx: reads deal_intake.answers and generated_forms from
// Postgres (RLS-scoped) instead of data/deal.json — and, since generated
// PDFs now actually persist in Storage instead of being ephemeral local
// files, also passes along which forms were already generated so revisiting
// this page doesn't look freshly empty.

import { notFound } from "next/navigation";
import Header from "@/components/Header";
import { getIntakeFormSchema } from "@/lib/schemas";
import { FORM_SETS, filterSchemaForSet, toFormSetId, withSchemaDefaults, type FormId } from "@/lib/formTypes";
import { createClient } from "@/lib/supabase/server";
import ReviewForm from "./ReviewForm";

export default async function ReviewPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const supabase = await createClient();

  const [{ data: deal }, { data: intakeRow }, { data: generatedRows }, fullSchema] = await Promise.all([
    supabase.from("deals").select("id, label, form_set").eq("id", dealId).maybeSingle(),
    supabase.from("deal_intake").select("answers").eq("deal_id", dealId).maybeSingle(),
    supabase.from("generated_forms").select("form_id").eq("deal_id", dealId),
    getIntakeFormSchema(),
  ]);

  if (!deal) {
    notFound();
  }

  const formSet = FORM_SETS[toFormSetId(deal.form_set)];
  const schema = filterSchemaForSet(fullSchema, formSet.id);
  // Same defaults the intake page seeds, so the review list and its
  // missing-field markers show what the generated PDF will actually say.
  const answers = withSchemaDefaults(schema, (intakeRow?.answers as Record<string, string>) ?? {});
  const initialResults = (generatedRows ?? []).map((row) => ({
    form: row.form_id as FormId,
    downloadUrl: `/api/deals/${dealId}/download/${row.form_id}`,
  }));

  return (
    <>
      <Header active="review" dealId={dealId} />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--color-text)]">{deal.label}</h1>
        <p className="mt-1 text-sm font-medium text-[var(--color-accent)]">{formSet.label}</p>
        <p className="mt-1 text-[var(--color-text-muted)]">
          Double-check what you entered, pick which forms to generate, then download the filled PDFs.
        </p>
        <div className="mt-8">
          <ReviewForm
            dealId={dealId}
            answers={answers}
            schema={schema}
            initialResults={initialResults}
            formIds={formSet.formIds}
          />
        </div>
      </main>
    </>
  );
}
