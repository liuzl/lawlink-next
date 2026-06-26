import { Navigate, Route, Routes } from "react-router-dom";
import { getToken } from "@/lib/api";
import { AppShell } from "@/components/layout/app-shell";
import { Login } from "@/pages/Login";
import { Dashboard } from "@/pages/Dashboard";
import { Intakes } from "@/pages/Intakes";
import { Conflicts } from "@/pages/Conflicts";
import { Matters } from "@/pages/Matters";
import { MatterDetail } from "@/pages/MatterDetail";
import { Clients } from "@/pages/Clients";
import { ClientDetail } from "@/pages/ClientDetail";
import { Seals } from "@/pages/Seals";
import { Sms } from "@/pages/Sms";
import { Audit } from "@/pages/Audit";
import { Reports } from "@/pages/Reports";
import { Notifications } from "@/pages/Notifications";
import { Settings } from "@/pages/Settings";

/** 认证门卫：无 token 跳登录，否则渲染外壳布局 */
function RequireAuth() {
  return getToken() ? <AppShell /> : <Navigate to="/login" replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/intakes" element={<Intakes />} />
        <Route path="/conflicts" element={<Conflicts />} />
        <Route path="/matters" element={<Matters />} />
        <Route path="/matters/:id" element={<MatterDetail />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/clients/:id" element={<ClientDetail />} />
        <Route path="/seals" element={<Seals />} />
        <Route path="/sms" element={<Sms />} />
        <Route path="/audit" element={<Audit />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
