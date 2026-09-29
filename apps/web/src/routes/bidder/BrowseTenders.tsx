import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import type { PublicTender } from "../../lib/tenders";

export default function BrowseTenders() {
  const [tenders, setTenders] = useState<PublicTender[] | null>(null);

  useEffect(() => {
    api<{ items: PublicTender[] }>("/public/tenders").then((res) => setTenders(res.items));
  }, []);

  return (
    <div className="page-shell">
      <div className="topbar">
        <strong>Published tenders</strong>
        <Link to="/bidder/dashboard" className="link">
          ← Dashboard
        </Link>
      </div>

      {tenders === null && <p className="field hint">Loading…</p>}
      {tenders?.length === 0 && <p className="field hint">No published tenders yet.</p>}

      <div className="card list-nav" style={{ padding: 0 }}>
        {tenders?.map((t) => (
          <Link key={t.id} to={`/bidder/tenders/${t.id}`} className="list-nav-item">
            <div style={{ fontWeight: 500 }}>{t.title}</div>
            <div className="field hint" style={{ margin: 0 }}>
              {t.category ?? "—"} · deadline {t.bidDeadline ? new Date(t.bidDeadline).toLocaleDateString() : "not set"}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
