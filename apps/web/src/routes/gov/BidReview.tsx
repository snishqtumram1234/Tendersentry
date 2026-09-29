import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../../lib/api";
import type { ComplianceRun, Decision, ExceptionItem } from "../../lib/compliance";
import Chip, { RISK_TONE } from "../../components/Chip";

interface BidDetail {
  id: string;
  code: string;
  state: string;
  bidderOrgId: string;
  tender: { title: string; code: string };
}

interface ClaimItem {
  id: string;
  claimType: string;
  value: unknown;
  status: string;
  verificationStatus: string | null;
}

const DECISION_ACTIONS: { action: string; label: string }[] = [
  { action: "TECHNICALLY_COMPLIANT", label: "Technically compliant" },
  { action: "TECHNICALLY_NON_COMPLIANT", label: "Technically non-compliant" },
  { action: "NEEDS_CLARIFICATION", label: "Needs clarification" },
  { action: "REFER_TO_COMMITTEE", label: "Refer to committee" },
  { action: "FINAL_DECISION", label: "Record final decision" },
];

export default function BidReview() {
  const { id } = useParams<{ id: string }>();
  const [bid, setBid] = useState<BidDetail | null>(null);
  const [run, setRun] = useState<ComplianceRun | null>(null);
  const [exceptions, setExceptions] = useState<ExceptionItem[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [claims, setClaims] = useState<ClaimItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [decisionAction, setDecisionAction] = useState("TECHNICALLY_COMPLIANT");
  const [decisionNote, setDecisionNote] = useState("");
  const [ackException, setAckException] = useState<{ id: string; title: string }[] | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const [b, exc, dec, cl] = await Promise.all([
      api<BidDetail>(`/bids/${id}`),
      api<{ items: ExceptionItem[] }>(`/bids/${id}/exceptions`),
      api<{ items: Decision[] }>(`/bids/${id}/decisions`),
      api<{ items: ClaimItem[] }>(`/bids/${id}/claims`),
    ]);
    setBid(b);
    setExceptions(exc.items);
    setDecisions(dec.items);
    setClaims(cl.items);
    try {
      const latest = await api<ComplianceRun>(`/bids/${id}/compliance/latest`);
      setRun(latest);
    } catch {
      setRun(null); // no completed run yet
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function runEvaluation() {
    if (!id) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/bids/${id}/compliance/run`, { method: "POST" });
      await load();
      setNotice("Evaluation run complete.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The compliance run failed.");
    } finally {
      setBusy(false);
    }
  }

  async function resolveException(excId: string) {
    const resolution = window.prompt("Resolution note:");
    if (!resolution) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/exceptions/${excId}/resolve`, { body: { resolution } });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not resolve the exception.");
    } finally {
      setBusy(false);
    }
  }

  async function requestVerification(claimId: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/verification/claims/${claimId}/request`, { method: "POST" });
      setNotice("Verification requested — see the verification queue.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not request verification for this claim.");
    } finally {
      setBusy(false);
    }
  }

  async function recordDecision(acknowledgedExceptionIds?: string[]) {
    if (!id) return;
    setBusy(true);
    setError(null);
    setAckException(null);
    try {
      await api(`/bids/${id}/decisions`, { body: { action: decisionAction, note: decisionNote || undefined, acknowledgedExceptionIds } });
      setDecisionNote("");
      await load();
      setNotice("Decision recorded.");
    } catch (err) {
      if (err instanceof ApiError && err.code === "VALIDATION_ERROR" && Array.isArray(err.details.exceptions)) {
        setAckException(err.details.exceptions as { id: string; title: string }[]);
      } else {
        setError(err instanceof ApiError ? err.message : "Could not record the decision.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (!bid) return <div className="page-shell">Loading…</div>;

  return (
    <div className="page-shell">
      <div className="topbar">
        <div>
          <strong>{bid.code}</strong>
          <span className="field hint" style={{ marginLeft: 8 }}>
            {bid.tender.title} ({bid.tender.code})
          </span>
        </div>
        <Link to={`/verification/tasks`} className="link">
          Verification queue →
        </Link>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {notice && (
        <div className="card" style={{ background: "var(--pass-bg)", color: "var(--pass-fg)", borderColor: "var(--pass-fg)" }}>
          {notice}
        </div>
      )}

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Compliance</h3>
          <button className="secondary" disabled={busy} onClick={runEvaluation}>
            Run evaluation
          </button>
        </div>

        {!run && <p className="field hint">No completed run yet — click "Run evaluation".</p>}

        {run && (
          <>
            <div style={{ display: "flex", gap: 24, marginTop: 12, marginBottom: 16 }}>
              <div>
                <div className="field hint">Mandatory gate</div>
                <Chip label={run.gate.status} tone={run.gate.status === "PASS" ? "pass" : run.gate.status === "FAIL" ? "fail" : "review"} />
              </div>
              <div>
                <div className="field hint">Compliance score {run.score.provisional ? "(provisional)" : ""}</div>
                <strong style={{ fontSize: 20 }}>{run.score.total}%</strong>
                {run.score.provisional && <span className="field hint"> — max achievable {run.score.maxAchievable}%</span>}
              </div>
              <div>
                <div className="field hint">Risk</div>
                <Chip label={run.risk.level} tone={RISK_TONE[run.risk.level]} />
              </div>
            </div>

            <table className="simple">
              <thead>
                <tr>
                  <th>Requirement</th>
                  <th>Mandatory</th>
                  <th>Weight</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {run.results.map((r) => (
                  <tr key={r.id}>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {r.requirementId}
                    </td>
                    <td>{r.mandatory ? "Yes" : "No"}</td>
                    <td>{r.weight}</td>
                    <td>
                      <Chip label={r.result} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {run.risk.signals.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <strong style={{ fontSize: 13 }}>Risk signals</strong>
                <ul style={{ paddingLeft: 18, fontSize: 13 }}>
                  {run.risk.signals.map((s, i) => (
                    <li key={i}>
                      <Chip label={s.severity} tone={RISK_TONE[s.severity]} /> {s.detail ?? s.category}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h3>Claims &amp; verification</h3>
        {claims.length === 0 && <p className="field hint">No claims extracted yet for this bidder.</p>}
        <table className="simple">
          <thead>
            <tr>
              <th>Claim</th>
              <th>Value</th>
              <th>Status</th>
              <th>Verification</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {claims.map((c) => (
              <tr key={c.id}>
                <td>{c.claimType}</td>
                <td className="mono" style={{ fontSize: 12 }}>
                  {typeof c.value === "string" ? c.value : JSON.stringify(c.value)}
                </td>
                <td>
                  <Chip label={c.status} />
                </td>
                <td>{c.verificationStatus ? <Chip label={c.verificationStatus} /> : <span className="field hint">Not requested</span>}</td>
                <td>
                  {c.verificationStatus !== "AUTHORITATIVE_VERIFIED" && (
                    <button className="link" disabled={busy} onClick={() => requestVerification(c.id)}>
                      Request verification
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Exceptions</h3>
        {exceptions.length === 0 && <p className="field hint">No exceptions.</p>}
        {exceptions.map((e) => (
          <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--rule)" }}>
            <div>
              <Chip label={e.severity} tone={RISK_TONE[e.severity]} /> <strong style={{ marginLeft: 8 }}>{e.title}</strong>
              <div className="field hint">
                {e.category} · {e.status}
                {e.nextAction ? ` · ${e.nextAction}` : ""}
              </div>
              {e.resolution && <div className="field hint">Resolved: {e.resolution}</div>}
            </div>
            {e.status !== "RESOLVED" && (
              <button className="secondary" disabled={busy} onClick={() => resolveException(e.id)}>
                Resolve
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Decisions</h3>
        {decisions.map((d) => (
          <div key={d.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--rule)" }}>
            <strong>{d.label}</strong> <span className="field hint">{new Date(d.createdAt).toLocaleString()}</span>
            {d.note && <div className="field hint">{d.note}</div>}
          </div>
        ))}

        {ackException && (
          <div className="card" style={{ background: "var(--review-bg)", borderColor: "var(--review-fg)" }}>
            <p style={{ marginTop: 0, color: "var(--review-fg)" }}>
              Open CRITICAL/HIGH exceptions must be acknowledged before recording "Technically compliant":
            </p>
            <ul style={{ paddingLeft: 18, fontSize: 13 }}>
              {ackException.map((e) => (
                <li key={e.id}>{e.title}</li>
              ))}
            </ul>
            <button className="secondary" disabled={busy} onClick={() => recordDecision(ackException.map((e) => e.id))}>
              Acknowledge and record anyway
            </button>
          </div>
        )}

        <div className="field" style={{ marginTop: 16 }}>
          <label>Action</label>
          <select value={decisionAction} onChange={(e) => setDecisionAction(e.target.value)}>
            {DECISION_ACTIONS.map((a) => (
              <option key={a.action} value={a.action}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Note</label>
          <textarea rows={3} value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} />
        </div>
        <button className="secondary" disabled={busy} onClick={() => recordDecision()}>
          Record decision
        </button>
      </div>
    </div>
  );
}
