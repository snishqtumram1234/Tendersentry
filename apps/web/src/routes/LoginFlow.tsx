import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import QRCode from "qrcode";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { PORTAL_LABELS, type LoginResponse, type Portal } from "../lib/auth";

type Step =
  | { name: "credentials" }
  | { name: "mfa"; challenge: string }
  | { name: "mfaEnroll"; challenge: string; otpauthUrl: string; qrDataUrl: string | null }
  | { name: "selectOrg"; challenge: string; organisations: { id: string; displayName: string }[] };

const HOME_BY_PORTAL: Record<string, string> = {
  GOVERNMENT: "/government/dashboard",
  BIDDER: "/bidder/dashboard",
  PLATFORM: "/admin/dashboard",
};

export default function LoginFlow() {
  const { portal } = useParams<{ portal: string }>();
  const navigate = useNavigate();
  const { refresh } = useAuth();

  const [step, setStep] = useState<Step>({ name: "credentials" });
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isKnownPortal = !!portal && portal in PORTAL_LABELS;

  function handleResponse(res: LoginResponse) {
    if (res.status === "SESSION") {
      refresh().then(() => navigate(HOME_BY_PORTAL[res.user.portal] ?? "/", { replace: true }));
      return;
    }
    if (res.status === "MFA_REQUIRED") {
      setStep({ name: "mfa", challenge: res.challenge });
      return;
    }
    if (res.status === "MFA_ENROLLMENT_REQUIRED") {
      setStep({ name: "mfaEnroll", challenge: res.challenge, otpauthUrl: res.otpauthUrl, qrDataUrl: null });
      return;
    }
    setStep({ name: "selectOrg", challenge: res.challenge, organisations: res.organisations });
  }

  // Generate the QR entirely client-side — the TOTP secret never leaves the browser.
  useEffect(() => {
    if (step.name !== "mfaEnroll" || step.qrDataUrl) return;
    let cancelled = false;
    QRCode.toDataURL(step.otpauthUrl, { margin: 1, width: 200 }).then((url) => {
      if (!cancelled) setStep((s) => (s.name === "mfaEnroll" ? { ...s, qrDataUrl: url } : s));
    });
    return () => {
      cancelled = true;
    };
  }, [step]);

  async function submitCredentials(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<LoginResponse>(`/auth/${portal}/login`, { body: { identifier, password } });
      handleResponse(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitMfa(e: React.FormEvent, challenge: string) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<LoginResponse>("/auth/mfa/verify", { body: { challenge, code } });
      handleResponse(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitOrg(challenge: string, organisationId: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await api<LoginResponse>("/auth/select-organisation", { body: { challenge, organisationId } });
      handleResponse(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!isKnownPortal) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>Unknown login portal</h1>
          <p className="subtitle">
            <a href="/login">Back to sign-in</a>
          </p>
        </div>
      </div>
    );
  }
  const label = PORTAL_LABELS[portal as Portal];

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1>{label} sign-in</h1>
        <p className="subtitle">TenderSentry — decision support for government procurement.</p>

        {error && <div className="error-banner">{error}</div>}

        {step.name === "credentials" && (
          <form onSubmit={submitCredentials}>
            <div className="field">
              <label htmlFor="identifier">Email</label>
              <input id="identifier" type="email" autoComplete="username" required value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <button className="primary" type="submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}

        {step.name === "mfa" && (
          <form onSubmit={(e) => submitMfa(e, step.challenge)}>
            <p className="field hint">Enter the 6-digit code from your authenticator app.</p>
            <div className="field">
              <label htmlFor="code">Authentication code</label>
              <input id="code" inputMode="numeric" pattern="[0-9]*" maxLength={8} autoFocus required value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <button className="primary" type="submit" disabled={busy}>
              {busy ? "Verifying…" : "Verify"}
            </button>
          </form>
        )}

        {step.name === "mfaEnroll" && (
          <form onSubmit={(e) => submitMfa(e, step.challenge)}>
            <p className="field hint">Set up multi-factor authentication: scan this code with an authenticator app, then enter the 6-digit code it shows.</p>
            {step.qrDataUrl && (
              <div className="qr-box">
                <img src={step.qrDataUrl} width={200} height={200} alt="Authenticator QR code" />
              </div>
            )}
            <div className="field">
              <label htmlFor="enroll-code">Authentication code</label>
              <input id="enroll-code" inputMode="numeric" pattern="[0-9]*" maxLength={8} required value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <button className="primary" type="submit" disabled={busy}>
              {busy ? "Verifying…" : "Verify and continue"}
            </button>
          </form>
        )}

        {step.name === "selectOrg" && (
          <div>
            <p className="field hint">Choose an organisation to continue.</p>
            <div className="org-list">
              {step.organisations.map((org) => (
                <button key={org.id} className="org-option" disabled={busy} onClick={() => submitOrg(step.challenge, org.id)}>
                  {org.displayName}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
