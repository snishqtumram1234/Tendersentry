import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import DocumentViewer, { type Highlight } from "../components/DocumentViewer";
import {
  IN_PROGRESS_STATUSES,
  PROCESSING_LABELS,
  type ClaimWithEvidence,
  type DocumentMeta,
  type ExtractedField,
} from "../lib/documents";

// Walking-skeleton evidence viewer (spec §27.1 Phase 1 acceptance: "Upload two synthetic PDFs
// with matching/mismatching PAN and see the correct outcome with highlighted boxes"). Not yet the
// full three-pane Evidence Workbench (spec §21.2) — that arrives once bids/tenders exist.
// Deviation: this route is portal-agnostic for now (any logged-in user's organisation), since
// Phase 1 has no tender/bid context to scope it to yet.

function StatusChip({ status }: { status: DocumentMeta["processingStatus"] }) {
  const tone =
    status === "EXTRACTED" ? "pass" : status === "FAILED" ? "fail" : status === "REVIEW_REQUIRED" ? "review" : "neutral";
  const colours: Record<string, [string, string]> = {
    pass: ["var(--pass-fg)", "var(--pass-bg)"],
    fail: ["var(--fail-fg)", "var(--fail-bg)"],
    review: ["var(--review-fg)", "var(--review-bg)"],
    neutral: ["var(--neutral-fg)", "var(--neutral-bg)"],
  };
  const [fg, bg] = colours[tone]!;
  return (
    <span style={{ color: fg, background: bg, borderRadius: 4, padding: "2px 8px", fontSize: 12, fontWeight: 500 }}>
      {PROCESSING_LABELS[status]}
    </span>
  );
}

function OutcomeChip({ outcome }: { outcome: string }) {
  const pass = outcome === "CONSISTENT" || outcome === "NORMALISED_MATCH";
  return (
    <span
      style={{
        color: pass ? "var(--pass-fg)" : "var(--fail-fg)",
        background: pass ? "var(--pass-bg)" : "var(--fail-bg)",
        borderRadius: 4,
        padding: "2px 8px",
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {pass ? "✓ Consistent" : "≠ Conflict"}
    </span>
  );
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<DocumentMeta[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [fields, setFields] = useState<ExtractedField[]>([]);
  const [claims, setClaims] = useState<ClaimWithEvidence[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDocs = useCallback(async () => {
    const res = await api<{ items: DocumentMeta[] }>("/documents");
    setDocs(res.items);
    return res.items;
  }, []);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  // Poll while anything is still processing — no queue/websocket yet (Phase 1 deviation, see
  // docs/PROGRESS.md), so short polling is the honest stand-in for real job-status streaming.
  useEffect(() => {
    if (!docs.some((d) => IN_PROGRESS_STATUSES.has(d.processingStatus))) return;
    const t = setInterval(loadDocs, 1500);
    return () => clearInterval(t);
  }, [docs, loadDocs]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      // The shared `api()` helper always JSON-encodes its body; multipart needs a raw fetch.
      const csrf = document.cookie.match(/(?:^|; )ts_csrf=([^;]*)/)?.[1];
      const res = await fetch("/api/v1/documents", {
        method: "POST",
        credentials: "include",
        headers: csrf ? { "x-csrf-token": decodeURIComponent(csrf) } : {},
        body: form,
      });
      if (!res.ok) {
        const body = await res.json();
        throw new ApiError(res.status, body);
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadDocs();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  const selectDocument = useCallback(async (id: string) => {
    setSelected(id);
    setSignedUrl(null);
    setFields([]);
    setClaims([]);
    try {
      const [urlRes, fieldsRes, claimsRes] = await Promise.all([
        api<{ url: string }>(`/documents/${id}/url`),
        api<{ items: ExtractedField[] }>(`/documents/${id}/fields`),
        api<{ items: ClaimWithEvidence[] }>(`/documents/${id}/claims`),
      ]);
      setSignedUrl(urlRes.url);
      setFields(fieldsRes.items);
      setClaims(claimsRes.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this document.");
    }
  }, []);

  const highlights: Highlight[] = fields.map((f) => {
    const claim = claims.find((c) => c.claimType === f.field);
    const conflict = claim?.reconciliation?.outcome === "CONFLICT";
    return { key: f.id, pageNo: f.pageNo, bbox: f.bbox, colour: conflict ? "conflicts" : "supports", label: `${f.field}: ${f.valueRaw}` };
  });

  return (
    <div className="dashboard-shell" style={{ maxWidth: 1100 }}>
      <div className="topbar">
        <strong>TenderSentry — Documents</strong>
        <Link to="/" className="link">
          ← Back
        </Link>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <form onSubmit={handleUpload} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 20 }}>
        <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg" required />
        <button className="primary" type="submit" disabled={uploading} style={{ width: "auto", padding: "8px 16px" }}>
          {uploading ? "Uploading…" : "Upload document"}
        </button>
      </form>

      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr 340px", gap: 16, alignItems: "start" }}>
        <div className="kv" style={{ display: "block", padding: 0, overflow: "hidden" }}>
          {docs.length === 0 && <p className="field hint" style={{ padding: 12 }}>No documents yet — upload one above.</p>}
          {docs.map((d) => (
            <button
              key={d.id}
              onClick={() => selectDocument(d.id)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "10px 12px",
                border: "none",
                borderBottom: "1px solid var(--rule)",
                background: selected === d.id ? "var(--canvas)" : "var(--surface)",
                cursor: "pointer",
                font: "inherit",
              }}
            >
              <div style={{ fontWeight: 500, marginBottom: 4, wordBreak: "break-all" }}>{d.originalFilename}</div>
              <StatusChip status={d.processingStatus} />
            </button>
          ))}
        </div>

        <div>
          {selected && signedUrl && (
            <DocumentViewer fileUrl={signedUrl} pageNo={1} highlights={highlights} />
          )}
          {selected && !signedUrl && <p className="field hint">Loading…</p>}
          {!selected && <p className="field hint">Select a document to view it.</p>}
        </div>

        <div>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Claims &amp; reconciliation</h2>
          {selected && claims.length === 0 && (
            <p className="field hint">No PAN/GSTIN found yet, or still processing.</p>
          )}
          {claims.map((c) => (
            <div key={c.claimId} className="kv" style={{ display: "block", marginBottom: 12, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <strong>{c.claimType}</strong>
                {c.reconciliation && <OutcomeChip outcome={c.reconciliation.outcome} />}
              </div>
              {c.evidence.map((e) => (
                <div key={e.evidenceId} style={{ fontSize: 13, marginBottom: 4, display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ color: "var(--ink-muted)" }}>{e.documentFilename}</span>
                  <span className="mono" style={{ fontWeight: e.isThisDocument ? 700 : 400 }}>
                    {e.excerpt}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
