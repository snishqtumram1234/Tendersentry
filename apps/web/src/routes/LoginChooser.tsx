import { Link } from "react-router-dom";

// spec §6.1: three separate entry URLs sharing one auth service; /login shows a chooser.
export default function LoginChooser() {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1>Sign in to TenderSentry</h1>
        <p className="subtitle">Choose the portal that matches your account.</p>
        <div className="portal-chooser-grid">
          <Link to="/login/government" className="portal-option">
            <div className="title">Government</div>
            <div className="desc">Procurement officers, evaluators, approving authorities, auditors</div>
          </Link>
          <Link to="/login/bidder" className="portal-option">
            <div className="title">Bidder</div>
            <div className="desc">Suppliers submitting bids on tenders</div>
          </Link>
          <Link to="/login/admin" className="portal-option">
            <div className="title">Platform admin</div>
            <div className="desc">TenderSentry system administrators</div>
          </Link>
        </div>
        <p className="subtitle" style={{ marginTop: 16, marginBottom: 0, textAlign: "center" }}>
          New bidder organisation? <Link to="/register/bidder">Register here</Link>
        </p>
      </div>
    </div>
  );
}
