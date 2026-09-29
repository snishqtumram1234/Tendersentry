import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../../lib/api";

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "", contactName: "", legalName: "", orgSubtype: "Pvt Ltd", mobile: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api("/auth/register/bidder", { body: { ...form, mobile: form.mobile || undefined } });
      navigate("/login/bidder", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Registration failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1>Register as a bidder</h1>
        <p className="subtitle">Create your organisation's TenderSentry account (spec §6.4).</p>

        {error && <div className="error-banner">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="legalName">Legal organisation name</label>
            <input id="legalName" required value={form.legalName} onChange={(e) => set("legalName", e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="orgSubtype">Organisation type</label>
            <select id="orgSubtype" value={form.orgSubtype} onChange={(e) => set("orgSubtype", e.target.value)}>
              <option>Pvt Ltd</option>
              <option>Public Ltd</option>
              <option>Partnership</option>
              <option>Proprietorship</option>
              <option>LLP</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="contactName">Your name</label>
            <input id="contactName" required value={form.contactName} onChange={(e) => set("contactName", e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="mobile">Mobile (optional)</label>
            <input id="mobile" value={form.mobile} onChange={(e) => set("mobile", e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required autoComplete="username" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="password">Password (min 12 characters)</label>
            <input id="password" type="password" minLength={12} required autoComplete="new-password" value={form.password} onChange={(e) => set("password", e.target.value)} />
          </div>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Registering…" : "Register"}
          </button>
        </form>
        <p className="subtitle" style={{ marginTop: 16, marginBottom: 0 }}>
          Already registered? <Link to="/login/bidder">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
