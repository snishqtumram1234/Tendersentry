import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../../lib/api";
import type { Tender } from "../../lib/tenders";

export default function TenderCreate() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [procurementMode, setProcurementMode] = useState<"SINGLE_ENVELOPE" | "TWO_ENVELOPE">("SINGLE_ENVELOPE");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const tender = await api<Tender>("/tenders", { body: { title, procurementMode, category: category || undefined } });
      navigate(`/tenders/${tender.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the tender.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-shell" style={{ maxWidth: 560 }}>
      <div className="topbar">
        <strong>New tender</strong>
        <Link to="/government/dashboard" className="link">
          ← Back
        </Link>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <form className="card" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="title">Title</label>
          <input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="category">Category (optional)</label>
          <input id="category" value={category} onChange={(e) => setCategory(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="mode">Procurement mode</label>
          <select id="mode" value={procurementMode} onChange={(e) => setProcurementMode(e.target.value as typeof procurementMode)}>
            <option value="SINGLE_ENVELOPE">Single envelope</option>
            <option value="TWO_ENVELOPE">Two envelope</option>
          </select>
        </div>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create tender"}
        </button>
      </form>
    </div>
  );
}
