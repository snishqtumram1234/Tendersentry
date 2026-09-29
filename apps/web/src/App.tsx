import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./lib/AuthContext";
import LoginChooser from "./routes/LoginChooser";
import LoginFlow from "./routes/LoginFlow";
import Dashboard from "./routes/Dashboard";
import DocumentsPage from "./routes/DocumentsPage";
import ProtectedRoute from "./routes/ProtectedRoute";

import GovDashboard from "./routes/gov/GovDashboard";
import TenderCreate from "./routes/gov/TenderCreate";
import TenderDetail from "./routes/gov/TenderDetail";
import BidReview from "./routes/gov/BidReview";
import VerificationQueue from "./routes/gov/VerificationQueue";

import Register from "./routes/bidder/Register";
import BidderDashboard from "./routes/bidder/BidderDashboard";
import Vault from "./routes/bidder/Vault";
import BrowseTenders from "./routes/bidder/BrowseTenders";
import TenderView from "./routes/bidder/TenderView";
import BidWorkspace from "./routes/bidder/BidWorkspace";

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginChooser />} />
        <Route path="/login/:portal" element={<LoginFlow />} />
        <Route path="/register/bidder" element={<Register />} />

        {/* Government portal */}
        <Route path="/government/dashboard" element={<ProtectedRoute portal="GOVERNMENT"><GovDashboard /></ProtectedRoute>} />
        <Route path="/tenders/new" element={<ProtectedRoute portal="GOVERNMENT"><TenderCreate /></ProtectedRoute>} />
        <Route path="/tenders/:id" element={<ProtectedRoute portal="GOVERNMENT"><TenderDetail /></ProtectedRoute>} />
        <Route path="/bids/:id" element={<ProtectedRoute portal="GOVERNMENT"><BidReview /></ProtectedRoute>} />
        <Route path="/verification/tasks" element={<ProtectedRoute portal="GOVERNMENT"><VerificationQueue /></ProtectedRoute>} />

        {/* Bidder portal */}
        <Route path="/bidder/dashboard" element={<ProtectedRoute portal="BIDDER"><BidderDashboard /></ProtectedRoute>} />
        <Route path="/bidder/vault" element={<ProtectedRoute portal="BIDDER"><Vault /></ProtectedRoute>} />
        <Route path="/bidder/tenders" element={<ProtectedRoute portal="BIDDER"><BrowseTenders /></ProtectedRoute>} />
        <Route path="/bidder/tenders/:id" element={<ProtectedRoute portal="BIDDER"><TenderView /></ProtectedRoute>} />
        <Route path="/bidder/bids/:id" element={<ProtectedRoute portal="BIDDER"><BidWorkspace /></ProtectedRoute>} />

        <Route path="/admin/dashboard" element={<ProtectedRoute portal="PLATFORM"><Dashboard /></ProtectedRoute>} />

        <Route path="/documents" element={<ProtectedRoute><DocumentsPage /></ProtectedRoute>} />

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </AuthProvider>
  );
}
