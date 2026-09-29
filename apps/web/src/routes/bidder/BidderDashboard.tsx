import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/AuthContext";
import type { Bid } from "../../lib/bids";
import Chip from "../../components/Chip";

export default function BidderDashboard() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const [bids, setBids] = useState<Bid[] | null>(null);

  useEffect(() => {
    api<{ items: Bid[] }>("/bids").then((res) => setBids(res.items));
  }, []);

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="page-shell">
      <div className="topbar">
        <strong>TenderSentry — Bidder</strong>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <span className="field hint" style={{ margin: 0 }}>
            {me?.user.name} · {me?.organisation?.displayName}
          </span>
          <Link to="/bidder/vault" className="link">
            Evidence vault
          </Link>
          <Link to="/bidder/tenders" className="link">
            Browse tenders
          </Link>
          <button className="link" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>My bids</h2>
        {bids === null && <p className="field hint">Loading…</p>}
        {bids?.length === 0 && (
          <p className="field hint">
            No bids yet — <Link to="/bidder/tenders">browse published tenders</Link> to get started.
          </p>
        )}
      </div>

      {bids && bids.length > 0 && (
        <div className="card list-nav" style={{ padding: 0 }}>
          {bids.map((b) => (
            <Link key={b.id} to={`/bidder/bids/${b.id}`} className="list-nav-item">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 500 }}>{b.tender?.title ?? b.tenderId}</div>
                  <div className="field hint" style={{ margin: 0 }}>
                    {b.code}
                  </div>
                </div>
                <Chip label={b.state} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
