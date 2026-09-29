import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../../lib/api";
import { uploadForm } from "../../lib/upload";
import type { VaultItem } from "../../lib/bids";
import Chip from "../../components/Chip";

const EVIDENCE_TYPES = [
  "PAN_CARD",
  "GST_CERTIFICATE",
  "UDYAM_CERTIFICATE",
  "INCORPORATION_CERTIFICATE",
  "ITR_ACKNOWLEDGEMENT",
  "BALANCE_SHEET",
  "PROFIT_AND_LOSS",
  "CA_CERTIFICATE_TURNOVER",
  "CA_CERTIFICATE_NETWORTH",
  "EXPERIENCE_CERTIFICATE",
  "WORK_ORDER",
  "COMPLETION_CERTIFICATE",
  "OEM_AUTHORISATION",
  "BIS_CERTIFICATE",
  "ISO_CERTIFICATE",
  "DECLARATION",
  "LOCAL_CONTENT_CERTIFICATE",
  "EPFO_REGISTRATION",
  "ESIC_REGISTRATION",
  "AUTHORISATION_LETTER",
  "OTHER",
];

export default function Vault() {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [evidenceType, setEvidenceType] = useState(EVIDENCE_TYPES[0]!);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await api<{ items: VaultItem[] }>("/bidder/vault");
    setItems(res.items);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("evidenceType", evidenceType);
      await uploadForm("/bidder/vault", form);
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-shell" style={{ maxWidth: 800 }}>
      <div className="topbar">
        <strong>Evidence vault</strong>
        <Link to="/bidder/dashboard" className="link">
          ← Dashboard
        </Link>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <form className="card" onSubmit={handleUpload}>
        <div className="field">
          <label htmlFor="evidenceType">Evidence type</label>
          <select id="evidenceType" value={evidenceType} onChange={(e) => setEvidenceType(e.target.value)}>
            {EVIDENCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="file">File</label>
          <input ref={fileRef} id="file" type="file" accept=".pdf,.png,.jpg,.jpeg" required />
        </div>
        <button className="secondary" type="submit" disabled={busy}>
          {busy ? "Uploading…" : "Upload"}
        </button>
      </form>

      <div className="card list-nav" style={{ padding: 0 }}>
        {items.length === 0 && (
          <p className="field hint" style={{ padding: 12 }}>
            No evidence uploaded yet.
          </p>
        )}
        {items.map((item) => (
          <div key={item.id} className="list-nav-item" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 500 }}>{item.evidenceType.replaceAll("_", " ")}</div>
              <div className="field hint" style={{ margin: 0 }}>
                {item.document.originalFilename} — {item.document.processingStatus}
                {item.document.docType && item.document.docType !== item.evidenceType ? ` (classified as ${item.document.docType})` : ""}
              </div>
            </div>
            <Chip label={item.status} />
          </div>
        ))}
      </div>
    </div>
  );
}
