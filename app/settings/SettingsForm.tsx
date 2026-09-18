// app/settings/SettingsForm.tsx
// Profile + brokerage defaults. Saved values are seeded onto a new deal's
// intake answers when it's created (app/api/deals/route.ts's POST handler)
// so a realtor doesn't retype their own brokerage info on every new deal.

"use client";

import { useState } from "react";
import { useToast } from "@/components/Toaster";

export interface Profile {
  full_name: string;
  phone: string;
  agent_email: string;
  brokerage_name: string;
  /** Kept in the type so a value saved before 0006 can seed brokerage_street. */
  brokerage_address?: string;
  brokerage_street: string;
  brokerage_city: string;
  brokerage_province: string;
  brokerage_postal_code: string;
  brokerage_phone: string;
  brokerage_fax: string;
}

/** One labelled text input. There are now twelve of them; this is the shape. */
function Field({
  id, label, value, onChange, hint, placeholder, maxLength, type = "text",
}: {
  id: keyof Profile; label: string; value: string; onChange: (v: string) => void;
  hint?: string; placeholder?: string; maxLength?: number; type?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-[var(--color-text)]">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        className="rf-field"
      />
      {hint && <p className="mt-1 text-xs text-[var(--color-text-muted)]">{hint}</p>}
    </div>
  );
}


export default function SettingsForm({ initialProfile }: { initialProfile: Profile }) {
  const [profile, setProfile] = useState<Profile>(initialProfile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  function setField(key: keyof Profile, value: string) {
    setProfile((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      if (!res.ok) throw new Error("Failed to save");
      // Previously a grey "Saved." beside the button — at the bottom of a
      // page you've just scrolled down, which is the one place the eye isn't.
      toast.success("Settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="rf-panel p-5">
        <h2 className="text-base font-semibold text-[var(--color-text)]">You</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Your name goes on the RECO acknowledgement and the brokerage lines of every form.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="full_name" label="Full name" value={profile.full_name} onChange={(v) => setField("full_name", v)} />
          <Field id="phone" label="Phone" value={profile.phone} onChange={(v) => setField("phone", v)} placeholder="416-555-0199" />
          <Field
            id="agent_email"
            label="Email for forms"
            type="email"
            value={profile.agent_email}
            onChange={(v) => setField("agent_email", v)}
            hint="Printed on Forms 101 and 400. Defaults to your sign-in address; change it if clients should use your brokerage one."
          />
        </div>
      </div>

      <div className="rf-panel p-5">
        <h2 className="text-base font-semibold text-[var(--color-text)]">Your brokerage</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Pre-fills your side of every new deal — the listing side when you represent the seller or landlord, the
          co-operating side when you represent the buyer or tenant. Still editable per deal.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="brokerage_name" label="Brokerage name" value={profile.brokerage_name} onChange={(v) => setField("brokerage_name", v)} placeholder="Royal LePage Signature Realty, Brokerage" />
          <Field id="brokerage_street" label="Street address" value={profile.brokerage_street} onChange={(v) => setField("brokerage_street", v)} placeholder="8 Sampson Mews, Suite 201" />
          <Field id="brokerage_city" label="City / town" value={profile.brokerage_city} onChange={(v) => setField("brokerage_city", v)} placeholder="Toronto" />
          {/* Two characters, because the box on the form holds two. */}
          <Field id="brokerage_province" label="Province" value={profile.brokerage_province} onChange={(v) => setField("brokerage_province", v.toUpperCase())} maxLength={2} placeholder="ON" hint="Two-letter abbreviation — it prints into a two-character box." />
          <Field id="brokerage_postal_code" label="Postal code" value={profile.brokerage_postal_code} onChange={(v) => setField("brokerage_postal_code", v.toUpperCase())} placeholder="M3C 0H5" />
          <Field id="brokerage_phone" label="Brokerage phone" value={profile.brokerage_phone} onChange={(v) => setField("brokerage_phone", v)} placeholder="416-443-0300" />
          <Field id="brokerage_fax" label="Brokerage fax" value={profile.brokerage_fax} onChange={(v) => setField("brokerage_fax", v)} hint="Forms 320, 324, 291 and 292 print a fax box. Leave blank if you don't have one." />
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-[var(--color-error-border)] bg-[var(--color-error-bg)] px-3 py-2 text-sm text-[var(--color-error-text)]">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rf-btn px-4 py-2.5"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
