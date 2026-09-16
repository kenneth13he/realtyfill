// app/settings/page.tsx
// Settings: profile + brokerage defaults (Phase 2 Step 7).

import Header from "@/components/Header";
import { createClient } from "@/lib/supabase/server";
import SettingsForm, { type Profile } from "./SettingsForm";
import ChangePassword from "./ChangePassword";
import DeleteAccount from "./DeleteAccount";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = user
    ? await supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle()
    : { data: null };

  const initialProfile: Profile = {
    full_name: data?.full_name ?? "",
    phone: data?.phone ?? "",
    brokerage_name: data?.brokerage_name ?? "",
    brokerage_address: data?.brokerage_address ?? "",
  };

  // A Google-only account has no RealtyFill password to change. `identities`
  // is what distinguishes that from an email/password account that also
  // linked Google; if it's missing entirely, show the form and let the
  // action report the real problem rather than hiding a control that works.
  const identities = user?.identities;
  const hasPasswordLogin = identities === undefined || identities.some((i) => i.provider === "email");

  return (
    <>
      <Header />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--color-text)]">Settings</h1>
        <div className="mt-8">
          <SettingsForm initialProfile={initialProfile} />
        </div>
        <div className="mt-6">
          <ChangePassword hasPasswordLogin={hasPasswordLogin} />
        </div>
        <div className="mt-10">
          <DeleteAccount />
        </div>
      </main>
    </>
  );
}
