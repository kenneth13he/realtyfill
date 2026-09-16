// components/Header.tsx
// Shared top bar across every signed-in page — app name + a step indicator
// showing where the realtor is in the Intake → Review → Generate flow for one
// deal, plus Settings/Sign out. Phase 2: pages live under /deals/[dealId]/...,
// so the steps need that dealId to link anywhere — pass it whenever `active`
// is set. Async server component: checks auth itself rather than every page
// threading a `user` prop through just for this.
//
// Rendered in deep ink with the lime accent, matching the landing page's nav
// and footer. It stays ink in both light and dark themes — it's the one
// surface whose background is known, which is what makes lime usable here
// (see the --color-signal note in globals.css). The bar is what carries the
// brand into the app, so signing in doesn't feel like landing on a different
// product.

import Link from "next/link";
import Wordmark from "@/components/Wordmark";
import { createClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/admin";
import { signOut } from "@/app/login/actions";

function steps(dealId: string) {
  return [
    { key: "intake", label: "1. Intake", href: `/deals/${dealId}/intake` },
    { key: "review", label: "2. Review & Generate", href: `/deals/${dealId}/review` },
  ] as const;
}

export default async function Header({
  active,
  dealId,
}: {
  active?: "intake" | "review";
  dealId?: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    // The bar is deep ink in both themes, so lime is legible on it either
    // way — same reasoning as .rf-panel-head, and the same token re-scoping.
    // The hairline along the bottom is the accent rather than a border grey:
    // it reads as a lit edge, and it's what visually seats the ruled page
    // below the chrome instead of letting the two just abut.
    <header className="border-b border-[var(--lime)]/25 bg-[var(--brand-deep)] [--color-signal:var(--lime)]">
      {/* One width on every signed-in page. This used to match each page's own
          content column (max-w-3xl on the form pages, max-w-5xl on the
          dashboard) so the wordmark lined up with the page heading — but that
          made the bar itself move when navigating between them. Global chrome
          holding still beats per-page heading alignment. */}
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-y-3 px-6 py-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-xl">
            <Wordmark tone="dark" />
          </Link>
          {active && dealId && (
            <Link href="/dashboard" className="rf-meta text-white/55 transition-colors hover:text-white">
              ← Dashboard
            </Link>
          )}
        </div>
        <div className="flex items-center gap-4">
          {active && dealId && (
            <nav className="flex gap-1 text-sm">
              {steps(dealId).map((step) => (
                <Link
                  key={step.key}
                  href={step.href}
                  // Step numbers are a readout of where you are in the flow,
                  // so they're set in the data face like every other reading
                  // in the app. Tight corners rather than a pill: the pill is
                  // the generic shape this redesign is getting away from.
                  className={
                    "rf-meta rounded-[var(--r-control)] px-3 py-1.5 transition-colors " +
                    (step.key === active
                      ? "bg-[var(--lime)] text-[var(--brand-deep)]"
                      : "text-white/55 hover:bg-white/10 hover:text-white")
                  }
                >
                  {step.label}
                </Link>
              ))}
            </nav>
          )}
          {user && (
            <div className="flex items-center gap-3 text-sm">
              {/* Only rendered for an admin. The page and its API both check
                  again — this link is a convenience, not the gate. */}
              {isAdminUser(user) && (
                <Link href="/admin/support" className="rf-meta text-[var(--lime)] transition-opacity hover:opacity-80">
                  Admin
                </Link>
              )}
              <Link href="/support" className="rf-meta text-white/55 transition-colors hover:text-white">
                Support
              </Link>
              <Link href="/settings" className="rf-meta text-white/55 transition-colors hover:text-white">
                Settings
              </Link>
              <form action={signOut}>
                <button
                  type="submit"
                  className="rf-meta text-white/55 transition-colors hover:text-white"
                >
                  Sign out
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
