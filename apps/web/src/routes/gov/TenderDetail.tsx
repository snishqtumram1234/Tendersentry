import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../../lib/api";
import { uploadForm } from "../../lib/upload";
import type { RuleListItem, Tender, TenderDocumentItem } from "../../lib/tenders";
import Chip from "../../components/Chip";

interface BidSummary {
  id: string;
  code: string;
  bidderOrgId: string;
  bidderLegalName: string;
  state: string;
  submittedAt: string | null;
}

function RuleRow({ rule, onChanged }: { rule: RuleListItem; onChanged: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [dslText, setDslText] = useState(() => JSON.stringify(rule.currentVersion?.dsl ?? {}, null, 2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, string>>({});

  const version = rule.currentVersion;
  const canApprove = version && ["DRAFT", "AI_EXTRACTED", "REVIEW_REQUIRED"].includes(version.status);
  const unresolvedAmbiguities = (version?.ambiguityFlags ?? []).filter((a) => !a.resolution);

  async function saveVersion() {
    setError(null);
    setBusy(true);
    try {
      const dsl = JSON.parse(dslText);
      await api(`/rules/${rule.ruleId}/versions`, { body: { dsl } });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof SyntaxError ? "Invalid JSON." : "Could not save this rule version.");
    } finally {
      setBusy(false);
    }
  }

  async function resolveAmbiguity(code: string) {
    if (!version) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/rule-versions/${version.id}/resolve-ambiguity`, { body: { code, resolution: resolutions[code] ?? "" } });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not resolve this ambiguity.");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!version) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/rule-versions/${version.id}/approve`, { method: "POST" });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not approve this rule version.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setExpanded((v) => !v)}>
        <div>
          <strong>{rule.code}</strong> — {rule.requirement.title}
          <span className="field hint" style={{ marginLeft: 8 }}>
            {rule.requirement.mandatory ? "Mandatory" : "Scored"} · weight {rule.requirement.weight}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {version && <Chip label={version.status} />}
          <span className="field hint">{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 16 }}>
          {error && <div className="error-banner">{error}</div>}

          {version?.plainEnglish && <p className="field hint">{version.plainEnglish}</p>}

          {unresolvedAmbiguities.length > 0 && (
            <div className="card" style={{ background: "var(--review-bg)", borderColor: "var(--review-fg)" }}>
              <strong style={{ color: "var(--review-fg)" }}>Ambiguities must be resolved before approval</strong>
              {unresolvedAmbiguities.map((a) => (
                <div key={a.code} style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 13 }}>{a.question}</div>
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <input
                      style={{ flex: 1, padding: "8px 10px", border: "1px solid var(--rule)", borderRadius: 6 }}
                      placeholder="Resolution"
                      value={resolutions[a.code] ?? ""}
                      onChange={(e) => setResolutions((r) => ({ ...r, [a.code]: e.target.value }))}
                    />
                    <button className="secondary" disabled={busy} onClick={() => resolveAmbiguity(a.code)}>
                      Resolve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="field">
            <label>Rule DSL (JSON)</label>
            <textarea rows={14} className="mono" value={dslText} onChange={(e) => setDslText(e.target.value)} />
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button className="secondary" disabled={busy} onClick={saveVersion}>
              Save new version
            </button>
            {canApprove && (
              <button className="secondary" disabled={busy || unresolvedAmbiguities.length > 0} onClick={approve}>
                Approve
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function TenderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tender, setTender] = useState<Tender | null>(null);
  const [docs, setDocs] = useState<TenderDocumentItem[]>([]);
  const [rules, setRules] = useState<RuleListItem[] | null>(null);
  const [bids, setBids] = useState<BidSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<{ valid: boolean; issues: { code: string; message: string }[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const [t, d, r] = await Promise.all([
      api<Tender>(`/tenders/${id}`),
      api<{ items: TenderDocumentItem[] }>(`/tenders/${id}/documents`),
      api<{ items: RuleListItem[] }>(`/tenders/${id}/rules`),
    ]);
    setTender(t);
    setDocs(d.items);
    setRules(r.items);
    if (t.state !== "DRAFT") {
      const b = await api<{ items: BidSummary[] }>(`/tenders/${id}/bids`);
      setBids(b.items);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file || !id) return;
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const uploadRes = await uploadForm<{ documentId: string }>("/documents", form);
      await api(`/tenders/${id}/documents`, { body: { documentId: uploadRes.documentId, role: "MAIN" } });
      if (fileInputRef.current) fileInputRef.current.value = "";
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function analyze() {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/tenders/${id}/analyze`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Analysis failed.");
    } finally {
      setBusy(false);
    }
  }

  async function checkValidation() {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ valid: boolean; issues: { code: string; message: string }[] }>(`/tenders/${id}/validate`, { method: "POST" });
      setValidation(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not validate the tender.");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/tenders/${id}/publish`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not publish the tender.");
    } finally {
      setBusy(false);
    }
  }

  if (!tender) return <div className="page-shell">Loading…</div>;

  return (
    <div className="page-shell">
      <div className="topbar">
        <div>
          <strong>{tender.title}</strong>
          <span className="field hint" style={{ marginLeft: 8 }}>
            {tender.code}
          </span>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <Chip label={tender.state} />
          <Link to="/government/dashboard" className="link">
            ← All tenders
          </Link>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {tender.state === "DRAFT" && (
        <div className="card">
          <h3>1. Upload the tender document</h3>
          <form onSubmit={handleUpload} style={{ display: "flex", gap: 8 }}>
            <input ref={fileInputRef} type="file" accept=".pdf" required />
            <button className="secondary" type="submit" disabled={busy}>
              Upload &amp; attach
            </button>
          </form>
          <ul style={{ marginTop: 12, paddingLeft: 18, fontSize: 13 }}>
            {docs.map((d) => (
              <li key={d.id}>
                {d.document.originalFilename} — {d.document.processingStatus}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tender.state === "DRAFT" && docs.length > 0 && (
        <div className="card">
          <h3>2. Segment clauses into draft requirements</h3>
          <p className="field hint">Reads the attached tender document and proposes one requirement + rule per eligibility clause.</p>
          <button className="secondary" disabled={busy} onClick={analyze}>
            Analyze
          </button>
        </div>
      )}

      {rules && rules.length > 0 && (
        <div>
          <h3>Requirements &amp; rules</h3>
          {rules.map((r) => (
            <RuleRow key={r.ruleId} rule={r} onChanged={load} />
          ))}
        </div>
      )}

      {tender.state === "DRAFT" && rules && rules.length > 0 && (
        <div className="card">
          <h3>3. Publish</h3>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="secondary" disabled={busy} onClick={checkValidation}>
              Check readiness
            </button>
            <button className="primary" style={{ width: "auto", padding: "8px 16px" }} disabled={busy} onClick={publish}>
              Publish
            </button>
          </div>
          {validation && (
            <div style={{ marginTop: 12 }}>
              {validation.valid ? (
                <Chip label="Ready to publish" tone="pass" />
              ) : (
                <ul style={{ paddingLeft: 18, fontSize: 13, color: "var(--fail-fg)" }}>
                  {validation.issues.map((i) => (
                    <li key={i.code}>{i.message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {tender.state !== "DRAFT" && (
        <div className="card">
          <h3>Bids</h3>
          {bids.length === 0 && <p className="field hint">No bids submitted yet.</p>}
          <table className="simple">
            <thead>
              <tr>
                <th>Bidder</th>
                <th>Code</th>
                <th>State</th>
                <th>Submitted</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {bids.map((b) => (
                <tr key={b.id}>
                  <td>{b.bidderLegalName}</td>
                  <td className="mono">{b.code}</td>
                  <td>
                    <Chip label={b.state} />
                  </td>
                  <td>{b.submittedAt ? new Date(b.submittedAt).toLocaleString() : "—"}</td>
                  <td>
                    <button className="link" onClick={() => navigate(`/bids/${b.id}`)}>
                      Review →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
