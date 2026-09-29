import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../../lib/api";
import type { Bid, ReadinessItem } from "../../lib/bids";
import Chip from "../../components/Chip";

interface PublicTenderDetail {
  id: string;
  publicId: string;
  title: string;
  category: string | null;
  department: string | null;
  objective: string | null;
  bidDeadline: string | null;
  eligibility: { requirementCode: string; mandatory: boolean; plainEnglish: string | null }[];
}

export default function TenderView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tender, setTender] = useState<PublicTenderDetail | null>(null);
  const [readiness, setReadiness] = useState<ReadinessItem[] | null>(null);
  const [existingBid, setExistingBid] = useState<Bid | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    // Public detail is keyed by publicId, but we only have the internal id here (from the list
    // response, which now includes both) — the internal id round-trips through /tenders/:id/publicId
    // in a full build; for this prototype we fetch the tender list once more and match by id.
    api<{ items: PublicTenderDetail[] }>("/public/tenders").then(async (res) => {
      const summary = res.items.find((t) => t.id === id);
      if (!summary) return;
      const detail = await api<PublicTenderDetail>(`/public/tenders/${summary.publicId}`);
      setTender({ ...detail, id: summary.id });
    });
    api<{ items: Bid[] }>("/bids").then((res) => {
      const mine = res.items.find((b) => b.tenderId === id);
      if (mine) setExistingBid(mine);
    });
  }, [id]);

  async function checkReadiness() {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ preview: boolean; items: ReadinessItem[] }>(`/bidder/tenders/${id}/readiness`, { method: "POST" });
      setReadiness(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not check readiness.");
    } finally {
      setBusy(false);
    }
  }

  async function startBid() {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const bid = await api<Bid>(`/bidder/tenders/${id}/bids`, { method: "POST" });
      navigate(`/bidder/bids/${bid.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start a bid.");
    } finally {
      setBusy(false);
    }
  }

  if (!tender) return <div className="page-shell">Loading…</div>;

  const actionsNeeded = readiness?.filter((r) => r.status !== "AVAILABLE").length ?? 0;

  return (
    <div className="page-shell">
      <div className="topbar">
        <strong>{tender.title}</strong>
        <Link to="/bidder/tenders" className="link">
          ← All tenders
        </Link>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <dl className="kv">
          <dt>Category</dt>
          <dd>{tender.category ?? "—"}</dd>
          <dt>Department</dt>
          <dd>{tender.department ?? "—"}</dd>
          <dt>Bid deadline</dt>
          <dd>{tender.bidDeadline ? new Date(tender.bidDeadline).toLocaleString() : "Not set"}</dd>
        </dl>
      </div>

      <div className="card">
        <h3>Eligibility requirements</h3>
        <ul style={{ paddingLeft: 18, fontSize: 13 }}>
          {tender.eligibility.map((e) => (
            <li key={e.requirementCode}>
              {e.mandatory ? <strong>Mandatory — </strong> : null}
              {e.plainEnglish ?? e.requirementCode}
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h3>Readiness preview</h3>
        <p className="field hint">Compares your evidence vault against this tender's requirements — a preview, not an evaluation.</p>
        <button className="secondary" disabled={busy} onClick={checkReadiness}>
          Check readiness
        </button>
        {readiness && (
          <>
            <p style={{ fontSize: 13, marginTop: 12 }}>{actionsNeeded === 0 ? "Everything needed is in your vault." : `${actionsNeeded} action(s) required before submission.`}</p>
            <table className="simple">
              <thead>
                <tr>
                  <th>Requirement</th>
                  <th>Mandatory</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {readiness.map((r) => (
                  <tr key={r.requirementCode}>
                    <td>{r.requirementCode}</td>
                    <td>{r.mandatory ? "Yes" : "No"}</td>
                    <td>
                      <Chip label={r.status} tone={r.status === "AVAILABLE" ? "pass" : "review"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="card">
        {existingBid ? (
          <button className="primary" style={{ width: "auto", padding: "8px 16px" }} onClick={() => navigate(`/bidder/bids/${existingBid.id}`)}>
            Continue your bid ({existingBid.state}) →
          </button>
        ) : (
          <button className="primary" style={{ width: "auto", padding: "8px 16px" }} disabled={busy} onClick={startBid}>
            Start a bid
          </button>
        )}
      </div>
    </div>
  );
}
