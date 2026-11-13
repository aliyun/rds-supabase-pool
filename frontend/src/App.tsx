import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { DashboardPage } from "./pages/Dashboard";
import { GlobalOverviewPage } from "./pages/GlobalOverview";
import { PoolsPage } from "./pages/Pools";
import { InstancesPage } from "./pages/Instances";
import { CapacityPage } from "./pages/Capacity";
import { TasksPage } from "./pages/Tasks";
import { SettingsPage } from "./pages/Settings";
import { BillingPage } from "./pages/Billing";
import { UsersPage } from "./pages/Users";
import { PortalApp } from "./pages/Portal";
import { BootstrapPage, LoginPage } from "./pages/Login";
import { useAuth } from "./lib/auth";
import { AppDataProvider } from "./lib/store";
import { PoolMark } from "./components/Layout";
import { Spinner } from "./components/ui";

export default function App() {
  const { status, user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <PoolMark />
        <Spinner size={22} />
        <span className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Connecting control plane</span>
      </div>
    );
  }
  if (!status) return <LoginPage />;
  if (!status.configured) {
    return (
      <AppDataProvider>
        <AdminRoutes />
      </AppDataProvider>
    );
  }
  if (status.bootstrap_required) return <BootstrapPage />;
  if (!status.authenticated || !user) return <LoginPage />;
  if (user.role === "user") {
    return (
      <Routes>
        <Route path="/portal" element={<PortalApp />} />
        <Route path="*" element={<Navigate to="/portal" replace />} />
      </Routes>
    );
  }
  return (
    <AppDataProvider>
      <AdminRoutes />
    </AppDataProvider>
  );
}

function AdminRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="global" element={<GlobalOverviewPage />} />
        <Route index element={<DashboardPage />} />
        <Route path="pools" element={<PoolsPage />} />
        <Route path="instances" element={<InstancesPage />} />
        <Route path="capacity" element={<CapacityPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="billing" element={<BillingPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
