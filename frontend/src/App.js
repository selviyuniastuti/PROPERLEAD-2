import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import AppLayout from "@/components/AppLayout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import PerumahanPage from "@/pages/PerumahanPage";
import PerumahanDetail from "@/pages/PerumahanDetail";
import DevelopersPage from "@/pages/DevelopersPage";
import DeveloperDetail from "@/pages/DeveloperDetail";
import RencanaPage from "@/pages/RencanaPage";
import CRMBoard from "@/pages/CRMBoard";
import FinancePage from "@/pages/FinancePage";
import MapPage from "@/pages/MapPage";
import LaporanPage from "@/pages/LaporanPage";
import NotificationsPage from "@/pages/NotificationsPage";
import UsersPage from "@/pages/UsersPage";
import SettingsPage from "@/pages/SettingsPage";

function Protected({ children, adminOnly }) {
  const { user, isAdmin } = useAuth();
  const location = useLocation();
  if (user === null)
    return <div className="min-h-screen flex items-center justify-center text-slate-400">Memuat…</div>;
  if (user === false) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />;
  return children;
}

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              element={
                <Protected>
                  <AppLayout />
                </Protected>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route path="/perumahan" element={<PerumahanPage />} />
              <Route path="/perumahan/:id" element={<PerumahanDetail />} />
              <Route path="/developer" element={<DevelopersPage />} />
              <Route path="/developer/detail" element={<DeveloperDetail />} />
              <Route path="/rencana" element={<RencanaPage />} />
              <Route path="/crm" element={<CRMBoard />} />
              <Route path="/finance" element={<FinancePage />} />
              <Route path="/peta" element={<MapPage />} />
              <Route path="/laporan" element={<LaporanPage />} />
              <Route path="/notifikasi" element={<NotificationsPage />} />
              <Route path="/users" element={<Protected adminOnly><UsersPage /></Protected>} />
              <Route path="/settings" element={<Protected adminOnly><SettingsPage /></Protected>} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-right" richColors />
      </AuthProvider>
    </div>
  );
}

export default App;
