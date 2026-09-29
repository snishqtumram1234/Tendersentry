import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";

// Route guard (spec §21.1: "Route guards check GET /auth/me permissions; the API remains the
// enforcement point" — this only controls navigation, never data access).
// `portal` omitted means "any authenticated portal" — used by portal-agnostic Phase 1 routes
// (e.g. /documents) that don't yet have a per-portal home (spec §21.1 routes land with tenders/bids).
export default function ProtectedRoute({ children, portal }: { children: ReactNode; portal?: "GOVERNMENT" | "BIDDER" | "PLATFORM" }) {
  const { me, loading } = useAuth();

  if (loading) return null;
  if (!me || (portal && me.user.portal !== portal)) {
    const loginPath = portal === "GOVERNMENT" ? "/login/government" : portal === "BIDDER" ? "/login/bidder" : portal === "PLATFORM" ? "/login/admin" : "/login";
    return <Navigate to={loginPath} replace />;
  }
  return <>{children}</>;
}
