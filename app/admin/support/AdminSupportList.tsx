// app/admin/support/AdminSupportList.tsx
// The triage list: read a request, reply to it, set its status.
//
// Fetched client-side rather than server-rendered so replying updates the row
// in place instead of reloading the page and losing your scroll position
// halfway down a list.

"use client";

import { useCallback, useEffect, useState } from "react";

interface AdminRequest {
  id: string;
  email: string;
  subject: string;
  body: string;
  status: "open" | "in_progress" | "resolved";
  error_ref: string | null;
  page_url: string | null;
  user_agent: string | null;
  deal_label: string | null;
  admin_reply: string | null;
  replied_at: string | null;
  created_at: string;
}

const STATUSES = ["open", "in_progress", "resolved"] as const;
const STATUS_LABELS: Record<AdminRequest["status"], string> = {
  open: "Open",
  in_progress: "Being looked at",
  resolved: "Resolved",
};
const STATUS_CLASSES: Record<AdminRequest["status"], string> = {
  open: "bg-[var(--color-warn-border)] text-[var(--color-warn-text)]",
  in_progress: "bg-sky-100 text-sky-900",
  resolved: "bg-[var(--color-ok-bg)] text-[var(--color-ok-text)]",
};

const inputClasses =
  "rf-field";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Row({ req, onSaved }: { req: AdminRequest; onSaved: (r: AdminRequest) => void }) {
  const [reply, setReply] = useState(req.admin_reply ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: { reply?: string; status?: AdminRequest["status"] }) {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/admin/support", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: req.id, ...patch }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Couldn't save");
      onSaved({ ...req, ...data.request });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="rf-panel p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-[var(--color-text)]">{req.subject}</h3>
        <span className={"rounded-full px-2 py-0.5 text-xs font-medium " + STATUS_CLASSES[req.status]}>
          {STATUS_LABELS[req.status]}
        </span>
      </div>

      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
        {req.email} · {formatDate(req.created_at)}
        {req.deal_label && <> · deal: {req.deal_label}</>}
        {req.error_ref && (
          <>
            {" · ref "}
            <code className="rounded bg-[var(--color-border)]/40 px-1">{req.error_ref}</code>
          </>
        )}
      </p>

      <p className="mt-3 whitespace-pre-wrap rounded-md bg-[var(--color-border)]/20 p-3 text-sm text-[var(--color-text)]">
        {req.body}
      </p>

      {(req.page_url || req.user_agent) && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-[var(--color-text-muted)]">Browser details</summary>
          <p className="mt-1 break-all text-xs text-[var(--color-text-muted)]">
            {req.page_url && (
              <>
                From: {req.page_url}
                <br />
              </>
            )}
            {req.user_agent}
          </p>
        </details>
      )}

      <div className="mt-4">
        <label htmlFor={`reply-${req.id}`} className="mb-1 block text-sm font-medium text-[var(--color-text)]">
          Your reply
        </label>
        <textarea
          id={`reply-${req.id}`}
          value={reply}
          onChange={(e) => {
            setReply(e.target.value);
            setSaved(false);
          }}
          rows={3}
          maxLength={5000}
          placeholder="This shows up on their support page."
          className={inputClasses}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => save({ reply })}
          disabled={saving || reply === (req.admin_reply ?? "")}
          className="rf-btn px-3 py-1.5 text-sm"
        >
          {saving ? "Saving…" : req.admin_reply ? "Update reply" : "Send reply"}
        </button>

        <select
          value={req.status}
          onChange={(e) => save({ status: e.target.value as AdminRequest["status"] })}
          disabled={saving}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm"
          aria-label="Status"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>

        {/* The reply is in-app only; nothing emails them. Until SMTP is set
            up this is the escape hatch for anything urgent. */}
        <a
          href={`mailto:${req.email}?subject=${encodeURIComponent("Re: " + req.subject)}`}
          className="text-sm text-[var(--color-accent)] underline"
        >
          Email instead
        </a>

        {saved && <span className="text-xs text-[var(--color-ok-text)]">Saved</span>}
        {req.replied_at && !saved && (
          <span className="text-xs text-[var(--color-text-muted)]">Replied {formatDate(req.replied_at)}</span>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--color-error-text)]">
          {error}
        </p>
      )}
    </li>
  );
}

export default function AdminSupportList() {
  const [requests, setRequests] = useState<AdminRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/support");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Couldn't load support requests");
      setRequests(data.requests ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <p role="alert" className="text-sm text-[var(--color-error-text)]">
        {error}
      </p>
    );
  }
  if (!requests) return <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>;

  const outstanding = requests.filter((r) => r.status !== "resolved");
  const visible = showResolved ? requests : outstanding;
  const resolvedCount = requests.length - outstanding.length;

  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
        <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
        Show resolved ({resolvedCount})
      </label>

      {visible.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          {requests.length === 0 ? "No support requests yet." : "Nothing outstanding."}
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {visible.map((req) => (
            <Row
              key={req.id}
              req={req}
              onSaved={(updated) =>
                setRequests((prev) => (prev ?? []).map((r) => (r.id === updated.id ? updated : r)))
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}
