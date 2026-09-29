import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/AuthContext";
import type { Tender } from "../../lib/tenders";
import Chip from "../../components/Chip";

export default function GovDashboard() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const [tenders, setTenders] = useState<Tender[] | null>(null);

  useEffect(() => {
    api<{ items: Tender[] }>("/tenders").then((res) => setTenders(res.items));
  }, []);

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="page-shell">
      <div className="topbar">
        <strong>TenderSentry — Government</strong>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <span className="field hint" style={{ margin: 0 }}>
            {me?.user.name} · {me?.organisation?.displayName} · {me?.roles.join(", ")}
          </span>
          <Link to="/verification/tasks" className="link">
            Verification queue
          </Link>
          <button className="link" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Tenders</h2>
          <button className="secondary" onClick={() => navigate("/tenders/new")}>
            + New tender
          </button>
        </div>
      </div>

      {tenders === null && <p className="field hint">Loading…</p>}
      {tenders?.length === 0 && <p className="field hint">No tenders yet — create one above.</p>}

      <div className="card list-nav" style={{ padding: 0 }}>
        {tenders?.map((t) => (
          <Link key={t.id} to={`/tenders/${t.id}`} className="list-nav-item">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 500 }}>{t.title}</div>
                <div className="field hint" style={{ margin: 0 }}>
                  {t.code} · {t.procurementMode.replace("_", "-")}
                </div>
              </div>
              <Chip label={t.state} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
