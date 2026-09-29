import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../../lib/api";
import type { Bid, BidDocumentItem, PrecheckItem, VaultItem } from "../../lib/bids";
import type { ComplianceRun } from "../../lib/compliance";
import Chip, { RISK_TONE } from "../../components/Chip";

export default function BidWorkspace() {
  const { id } = useParams<{ id: string }>();
  const [bid, setBid] = useState<Bid | null>(null);
  const [bidDocs, setBidDocs] = useState<BidDocumentItem[]>([]);
  const [vault, setVault] = useState<VaultItem[]>([]);
  const [precheck, setPrecheck] = useState<{ ready: boolean; items: PrecheckItem[] } | null>(null);
  const [run, setRun] = useState<ComplianceRun | null>(null);
  const [selectedDoc, setSelectedDoc] = useState("");
  const [requirementCode, setRequirementCode] = useState("");
  const [declaration, setDeclaration] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const [b, docs, vaultRes] = await Promise.all([
      api<Bid>(`/bids/${id}`),
      api<{ items: BidDocumentItem[] }>(`/bids/${id}/documents`),
      api<{ items: VaultItem[] }>("/bidder/vault"),
    ]);
    setBid(b);
    setBidDocs(docs.items);
    setVault(vaultRes.items);
    if (b.state !== "DRAFT") {
      try {
        const latest = await api<ComplianceRun>(`/bids/${id}/compliance/latest`);
        setRun(latest);
      } catch {
        setRun(null);
      }
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function attachDocument(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !selectedDoc) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/bids/${id}/documents`, { body: { documentId: selectedDoc, requirementCodes: requirementCode ? [requirementCode] : [] } });
      setSelectedDoc("");
      setRequirementCode("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not attach the document.");
    } finally {
      setBusy(false);
    }
  }

  async function runPrecheck() {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ ready: boolean; items: PrecheckItem[] }>(`/bids/${id}/precheck`, { method: "POST" });
      setPrecheck(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not run the pre-check.");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/bids/${id}/submit`, { body: { declarationAccepted: declaration } });
      setNotice("Bid submitted.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not submit the bid.");
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
            <Chip label={bid.state} />
          </span>
        </div>
        <Link to="/bidder/dashboard" className="link">
          ← My bids
        </Link>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {notice && (
        <div className="card" style={{ background: "var(--pass-bg)", color: "var(--pass-fg)", borderColor: "var(--pass-fg)" }}>
          {notice}
        </div>
      )}

      {bid.state === "DRAFT" && (
        <div className="card">
          <h3>Attach evidence</h3>
          <form onSubmit={attachDocument} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              <label>Vault document</label>
              <select value={selectedDoc} onChange={(e) => setSelectedDoc(e.target.value)} required>
                <option value="" disabled>
                  Select…
                </option>
                {vault.map((v) => (
                  <option key={v.id} value={v.documentId}>
                    {v.evidenceType.replaceAll("_", " ")} — {v.document.originalFilename}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Requirement code</label>
              <input placeholder="R-01" value={requirementCode} onChange={(e) => setRequirementCode(e.target.value)} />
            </div>
            <button className="secondary" type="submit" disabled={busy}>
              Attach
            </button>
          </form>

          <table className="simple" style={{ marginTop: 16 }}>
            <tbody>
              {bidDocs.map((d) => (
                <tr key={d.documentId}>
                  <td>{d.document.originalFilename}</td>
                  <td>{d.mappedRequirementIds.length > 0 ? d.mappedRequirementIds.length + " requirement(s)" : "unmapped"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {bid.state === "DRAFT" && (
        <div className="card">
          <h3>Pre-check &amp; submit</h3>
          <button className="secondary" disabled={busy} onClick={runPrecheck}>
            Pre-check
          </button>
          {precheck && (
            <table className="simple" style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>Requirement</th>
                  <th>Mandatory</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {precheck.items.map((i) => (
                  <tr key={i.requirementCode}>
                    <td>{i.requirementCode}</td>
                    <td>{i.mandatory ? "Yes" : "No"}</td>
                    <td>
                      <Chip label={i.status} tone={i.status === "PASS" ? "pass" : "review"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="field" style={{ marginTop: 16 }}>
            <label className="checkbox">
              <input type="checkbox" checked={declaration} onChange={(e) => setDeclaration(e.target.checked)} />
              I declare that the information and documents submitted are true and accurate.
            </label>
          </div>
          <button className="primary" style={{ width: "auto", padding: "8px 16px" }} disabled={busy || !declaration} onClick={submit}>
            Submit bid
          </button>
        </div>
      )}

      {bid.state !== "DRAFT" && (
        <div className="card">
          <h3>Compliance status</h3>
          {!run && <p className="field hint">The compliance evaluation hasn't completed yet — check back shortly.</p>}
          {run && (
            <div style={{ display: "flex", gap: 24 }}>
              <div>
                <div className="field hint">Mandatory gate</div>
                <Chip label={run.gate.status} tone={run.gate.status === "PASS" ? "pass" : run.gate.status === "FAIL" ? "fail" : "review"} />
              </div>
              <div>
                <div className="field hint">Compliance score {run.score.provisional ? "(provisional)" : ""}</div>
                <strong style={{ fontSize: 20 }}>{run.score.total}%</strong>
              </div>
              <div>
                <div className="field hint">Risk</div>
                <Chip label={run.risk.level} tone={RISK_TONE[run.risk.level]} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
