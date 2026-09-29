import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";

// Placeholder dashboard shared by all three portals for Phase 0 — proves the session round-trips.
// Real portal dashboards (spec §21.2-21.4) come in later phases.
export default function Dashboard() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();

  if (!me) return null;

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="dashboard-shell">
      <div className="topbar">
        <strong>TenderSentry</strong>
        <button className="link" onClick={handleLogout}>
          Sign out
        </button>
      </div>
      <p className="subtitle">Signed in — this confirms the login, session and permission plumbing all work end to end.</p>
      <dl className="kv">
        <dt>Name</dt>
        <dd>{me.user.name}</dd>
        <dt>Email</dt>
        <dd className="mono">{me.user.email}</dd>
        <dt>Portal</dt>
        <dd>{me.user.portal}</dd>
        <dt>Organisation</dt>
        <dd>{me.organisation?.displayName ?? "—"}</dd>
        <dt>Roles</dt>
        <dd className="mono">{me.roles.join(", ") || "—"}</dd>
      </dl>
      <p style={{ marginTop: 20 }}>
        <Link to="/documents">Documents &amp; evidence →</Link>
      </p>
    </div>
  );
}
