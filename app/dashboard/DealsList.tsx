// app/dashboard/DealsList.tsx
// Client-side deal list: create a new deal, filter by status, and
// close/reopen/archive one. Status filtering here IS "history" per the
// scope agreed for this plan — a full field-level audit log is explicitly
// out of scope for now.
//
// The form-set picker hides the native radio and paints the tile instead.
// Three reasons it's worth the extra markup: the whole tile becomes the hit
// target, the selected state can be a real border+ring rather than a 13px
// dot, and the "coming soon" sets can be visibly inert without the greyed-out
// native control doing the explaining. The input is still a real focusable
// radio (sr-only, not display:none), so keyboard and screen-reader behaviour
// is unchanged — `has-[:focus-visible]` puts the focus ring on the tile when
// the hidden input inside it takes focus.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toaster";
import { DEFAULT_FORM_SET, FORM_SETS, FORM_SET_IDS, FormSetId, toFormSetId } from "@/lib/formTypes";

export interface Deal {
  id: string;
  label: string;
  status: "active" | "closed" | "archived";
  form_set: string;
  created_at: string;
  updated_at: string;
}

const STATUS_FILTERS = ["active", "closed", "archived"] as const;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function DealsList({ initialDeals, loadError }: { initialDeals: Deal[]; loadError: string | null }) {
  const router = useRouter();
  const [deals, setDeals] = useState<Deal[]>(initialDeals);
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]>("active");
  const [newLabel, setNewLabel] = useState("");
  const [newFormSet, setNewFormSet] = useState<FormSetId>(DEFAULT_FORM_SET);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(loadError);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  // Which deal is showing its "are you sure" row, and which is mid-delete.
  // Separate from `updatingId` so a delete in flight can't be confused with a
  // status change in flight — they disable different things.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Status changes and deletions both mutate the list without moving focus.
  // This used to be an sr-only aria-live paragraph, on the reasoning that the
  // change was "already obvious on screen" for everyone else. It isn't:
  // archiving a deal while the Active filter is on makes the row vanish with
  // no explanation at all. Toasts carry role="status", so they announce the
  // same thing to a screen reader AND say it visibly — one mechanism instead
  // of two, and sighted users stop being the ones left guessing.
  const toast = useToast();

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newLabel.trim() || undefined, formSet: newFormSet }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to create deal");
      router.push(`/deals/${body.deal.id}/intake`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setCreating(false);
    }
  }

  async function handleStatusChange(dealId: string, status: Deal["status"]) {
    setUpdatingId(dealId);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to update deal");
      setDeals((prev) => prev.map((d) => (d.id === dealId ? body.deal : d)));
      // Named after the button that was pressed, not the status field it
      // writes: "Deal moved to active" is what the database did; "reopened"
      // is what the user did.
      const label = deals.find((d) => d.id === dealId)?.label ?? "Deal";
      const verb = status === "active" ? "reopened" : status === "closed" ? "closed" : "archived";
      toast.success(`${label} ${verb}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setUpdatingId(null);
    }
  }

  // Permanent, unlike Archive. The route deletes the deal's stored PDFs before
  // the row, so nothing is left orphaned in Storage — see
  // app/api/deals/[dealId]/route.ts for why that order matters.
  async function handleDelete(dealId: string) {
    const label = deals.find((d) => d.id === dealId)?.label ?? "Deal";
    setDeletingId(dealId);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to delete deal");
      }
      setDeals((prev) => prev.filter((d) => d.id !== dealId));
      setConfirmingDeleteId(null);
      toast.success(`${label} deleted.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setDeletingId(null);
    }
  }

  const visibleDeals = deals.filter((d) => d.status === filter);

  return (
    <div className="flex flex-col gap-10">
      {/* ---------------- CREATE ---------------- */}
      <form onSubmit={handleCreate} className="rf-panel overflow-hidden">
        <div className="rf-panel-head px-6 py-4">
          {/* The eyebrow is set in the data face and tinted with the signal
              colour — on this ink header that's lime, which is the brand's
              own and reads as a label on an instrument rather than a
              subheading on a web page. */}
          <p className="rf-meta text-[var(--color-signal)]">New deal</p>
          <h2 className="mt-1 text-base font-semibold text-white">Pick the forms you need</h2>
          <p className="mt-0.5 text-sm text-white/55">This can&apos;t be changed later.</p>
        </div>

        <div className="p-6">
          <fieldset>
            <legend className="sr-only">Which forms do you need?</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {FORM_SET_IDS.map((setId) => {
                const set = FORM_SETS[setId];
                const isSelected = newFormSet === setId;
                return (
                  <label
                    key={setId}
                    className={
                      "rf-tile " +
                      (!set.ready ? "rf-tile-disabled" : isSelected ? "rf-tile-selected" : "")
                    }
                  >
                    <input
                      type="radio"
                      name="formSet"
                      value={setId}
                      checked={isSelected}
                      disabled={!set.ready}
                      onChange={() => setNewFormSet(setId)}
                      className="sr-only"
                    />

                    {/* Selection mark, pinned top-right so it never sits in
                        the middle of a two-line title. A square bracket-style
                        mark rather than a radio dot: the tile is already
                        doing the job of a control, and a crosshair reads as
                        "this one is armed" where a dot reads as a form. */}
                    <span
                      aria-hidden
                      className={
                        "absolute right-3.5 top-3.5 flex h-4 w-4 items-center justify-center border transition-colors " +
                        (isSelected
                          ? "border-[var(--color-accent)] bg-[var(--color-accent)]"
                          : "border-[var(--color-border-strong)] bg-transparent")
                      }
                    >
                      {isSelected && <span className="h-1.5 w-1.5 bg-[var(--color-on-accent)]" />}
                    </span>

                    <div className={"pr-8 " + (set.ready ? "" : "opacity-55")}>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm font-semibold text-[var(--color-text)]">{set.label}</span>
                        {!set.ready && <span className="rf-meta whitespace-nowrap">Soon</span>}
                      </div>
                      <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-text-muted)]">
                        {set.description}
                      </p>
                      <p className="rf-meta mt-3 text-[var(--color-accent)]">{set.formIds.length} forms</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="mt-5 flex flex-col gap-3 border-t border-[var(--color-border)] pt-5 sm:flex-row">
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              aria-label="Deal name"
              placeholder="e.g. 203 College St #1706 (optional — you can rename later)"
              className="rf-field flex-1"
            />
            <button type="submit" disabled={creating} className="rf-btn shrink-0 px-6">
              {creating && <Spinner />}
              {creating ? "Creating…" : "Create deal"}
            </button>
          </div>
        </div>
      </form>

      {error && (
        <p
          role="alert"
          className="rounded-[var(--r-control)] border border-[var(--color-error-border)] bg-[var(--color-error-bg)] px-3.5 py-2.5 text-sm text-[var(--color-error-text)]"
        >
          {error}
        </p>
      )}

      {/* ---------------- LIST ---------------- */}
      <div>
        {/* A real tablist. These were styled as tabs but announced as three
            unrelated buttons; `role="tab"` + aria-selected is what makes a
            screen reader say "Active, tab 1 of 3, selected", and it's also
            what drives the .rf-chip selected styling — one source of truth
            for "which one is live" instead of a parallel className branch. */}
        <div role="tablist" aria-label="Filter deals by status" className="flex gap-1">
          {STATUS_FILTERS.map((status) => {
            const count = deals.filter((d) => d.status === status).length;
            return (
              <button
                key={status}
                type="button"
                role="tab"
                aria-selected={filter === status}
                onClick={() => setFilter(status)}
                className="rf-chip capitalize"
              >
                {status}
                <span className="rf-meta text-[inherit] opacity-70">{count}</span>
              </button>
            );
          })}
        </div>

        {visibleDeals.length === 0 ? (
          <div className="mt-6 flex flex-col items-center px-6 py-14 text-center">
            <EmptyDocuments />
            <p className="rf-meta mt-6">No {filter} deals</p>
            <p className="mx-auto mt-2 max-w-xs text-sm text-[var(--color-text-muted)]">
              {filter === "active"
                ? "Pick a form set above and create your first deal."
                : `Deals you mark as ${filter} will show up here.`}
            </p>
          </div>
        ) : (
          <ul className="mt-6 flex flex-col gap-2.5">
            {visibleDeals.map((deal) => (
              <li
                key={deal.id}
                className="rf-row group flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <Link
                  href={`/deals/${deal.id}/review`}
                  className="flex min-w-0 flex-1 items-center gap-4 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2"
                >
                  {/* Document glyph — gives each row an anchor so a list of
                      similar addresses doesn't read as undifferentiated text. */}
                  <span
                    aria-hidden
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--r-control)] border border-[var(--color-border)] bg-[var(--color-surface-sunken)] text-[var(--color-accent)] transition-colors group-hover:border-[var(--color-accent)] group-hover:bg-[var(--color-accent)] group-hover:text-[var(--color-on-accent)]"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                      <path d="M14 3v5h5" />
                    </svg>
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-[var(--color-text)]">{deal.label}</span>
                    {/* Set name and date are readings, so they're set in the
                        data face — which also means the dates line up
                        column-wise down a list of deals. */}
                    <span className="rf-meta mt-1 block truncate">
                      {FORM_SETS[toFormSetId(deal.form_set)].label} · Upd {formatDate(deal.updated_at)}
                    </span>
                  </span>
                </Link>

                {confirmingDeleteId === deal.id ? (
                  /* Replaces the action buttons rather than sitting beside
                     them, so the only things clickable while confirming are
                     "Delete forever" and "Cancel". */
                  <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
                    <span className="rf-meta text-[var(--color-error-text)]">Delete permanently?</span>
                    <button
                      type="button"
                      disabled={deletingId === deal.id}
                      onClick={() => handleDelete(deal.id)}
                      className="rf-btn px-3 py-1.5 text-xs"
                      style={{ background: "var(--color-error-text)", color: "#fff" }}
                    >
                      {deletingId === deal.id && <Spinner className="h-3.5 w-3.5" />}
                      {deletingId === deal.id ? "Deleting…" : "Delete forever"}
                    </button>
                    <button
                      type="button"
                      disabled={deletingId === deal.id}
                      onClick={() => setConfirmingDeleteId(null)}
                      className="rf-chip"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
                    {deal.status === "active" && (
                      <StatusButton
                        busy={updatingId === deal.id}
                        onClick={() => handleStatusChange(deal.id, "closed")}
                      >
                        Close
                      </StatusButton>
                    )}
                    {deal.status === "closed" && (
                      <>
                        <StatusButton
                          busy={updatingId === deal.id}
                          onClick={() => handleStatusChange(deal.id, "active")}
                        >
                          Reopen
                        </StatusButton>
                        <StatusButton
                          busy={updatingId === deal.id}
                          onClick={() => handleStatusChange(deal.id, "archived")}
                        >
                          Archive
                        </StatusButton>
                      </>
                    )}
                    {deal.status === "archived" && (
                      <StatusButton
                        busy={updatingId === deal.id}
                        onClick={() => handleStatusChange(deal.id, "active")}
                      >
                        Reactivate
                      </StatusButton>
                    )}
                    {/* Archive hides a deal; this erases it, along with every
                        PDF generated from it. A realtor needs the second one to
                        be able to remove a client's information on request. */}
                    <button
                      type="button"
                      disabled={updatingId === deal.id}
                      onClick={() => setConfirmingDeleteId(deal.id)}
                      aria-label={`Delete ${deal.label}`}
                      className="rf-btn rf-btn-danger px-3 py-1.5 text-xs"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Empty-state illustration: three form sheets fanned out, the front one
 * ruled with the field lines the app fills in.
 *
 * Drawn rather than shipped as an asset — it's a dozen rects, it inherits the
 * theme through currentColor and the accent token instead of needing a second
 * file for dark mode, and it can't 404. The fan is deliberately the product's
 * own subject (a set of forms, not an empty box or a magnifying glass), which
 * is the difference between an illustration and clip art.
 */
function EmptyDocuments() {
  return (
    <svg
      width="132"
      height="96"
      viewBox="0 0 132 96"
      fill="none"
      aria-hidden
      className="text-[var(--color-border-strong)]"
    >
      {/* Back two sheets, rotated out of the stack. */}
      <g stroke="currentColor" strokeWidth="1.5" opacity="0.5">
        <rect x="26" y="14" width="52" height="68" rx="3" transform="rotate(-9 26 14)" />
        <rect x="52" y="12" width="52" height="68" rx="3" transform="rotate(7 52 12)" />
      </g>
      {/* Front sheet, upright and ruled. */}
      <rect
        x="40"
        y="16"
        width="54"
        height="70"
        rx="3"
        fill="var(--color-surface)"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.65">
        <path d="M50 32h34" />
        <path d="M50 42h34" />
        <path d="M50 52h22" />
      </g>
      {/* The filled field — the one line the product is actually about, in
          the accent so the eye lands on it last and understands the point. */}
      <path d="M50 62h28" stroke="var(--color-accent)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function StatusButton({
  busy,
  onClick,
  children,
}: {
  busy: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="rf-btn rf-btn-ghost px-3 py-1.5 text-xs"
    >
      {children}
    </button>
  );
}
