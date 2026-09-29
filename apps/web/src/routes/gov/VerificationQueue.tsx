import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../../lib/api";
import { uploadForm } from "../../lib/upload";
import type { VerificationTask } from "../../lib/compliance";
import Chip from "../../components/Chip";

const OUTCOMES = ["MATCH", "NO_MATCH", "NOT_FOUND", "SOURCE_ERROR"] as const;

function TaskPanel({ task, onChanged }: { task: VerificationTask; onChanged: () => void }) {
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]>("MATCH");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await api(`/verification/tasks/${task.id}/start`, { method: "POST" });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start this task.");
    } finally {
      setBusy(false);
    }
  }

  async function submitResult(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("outcome", outcome);
      if (note) form.append("note", note);
      const file = fileRef.current?.files?.[0];
      if (file) form.append("capture", file);
      await uploadForm(`/verification/tasks/${task.id}/result`, form);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record the result.");
    } finally {
      setBusy(false);
    }
  }

  async function markUnavailable() {
    const reason = window.prompt("Reason the source is unavailable:");
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/verification/tasks/${task.id}/unavailable`, { body: { reason } });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not mark unavailable.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <strong>
            {task.claimType} — {task.bidderLegalName}
          </strong>
          <div className="field hint">
            {task.sourceName} · {task.code}
          </div>
        </div>
        <Chip label={task.status} />
      </div>

      {task.portalUrl && (
        <p style={{ fontSize: 13, marginTop: 12 }}>
          <a href={task.portalUrl} target="_blank" rel="noreferrer">
            Open official portal →
          </a>
          <br />
          <span className="field hint">{task.instructions}</span>
        </p>
      )}

      {error && <div className="error-banner">{error}</div>}

      {task.status === "QUEUED" && (
        <button className="secondary" disabled={busy} onClick={start}>
          Start
        </button>
      )}

      {task.status === "IN_PROGRESS" && (
        <form onSubmit={submitResult} style={{ marginTop: 12 }}>
          <div className="field">
            <label>Outcome (what the portal showed)</label>
            <select value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
              {OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {o.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Note</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="field">
            <label>Captured screenshot/PDF {outcome === "MATCH" ? "(required for Match)" : "(optional)"}</label>
            <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg" required={outcome === "MATCH"} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="secondary" type="submit" disabled={busy}>
              Save result
            </button>
            <button className="secondary" type="button" disabled={busy} onClick={markUnavailable}>
              Mark unavailable
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function VerificationQueue() {
  const [tasks, setTasks] = useState<VerificationTask[] | null>(null);

  const load = useCallback(async () => {
    const res = await api<{ items: VerificationTask[] }>("/verification/tasks");
    setTasks(res.items);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="page-shell">
      <div className="topbar">
        <strong>Verification queue</strong>
        <Link to="/government/dashboard" className="link">
          ← Dashboard
        </Link>
      </div>

      <p className="field hint" style={{ marginBottom: 16 }}>
        Officer-assisted verification (spec §14.3): open the official source portal yourself, look the
        identifier up, and record exactly what it showed. Nothing here is scraped or automated.
      </p>

      {tasks === null && <p className="field hint">Loading…</p>}
      {tasks?.length === 0 && <p className="field hint">No verification tasks queued.</p>}
      {tasks?.map((t) => (
        <TaskPanel key={t.id} task={t} onChanged={load} />
      ))}
    </div>
  );
}
