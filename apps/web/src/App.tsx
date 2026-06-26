import { NavLink, Navigate, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import { getRole, getToken, setSession } from "./lib/api.js";
import { Login } from "./pages/Login.js";
import { Intakes } from "./pages/Intakes.js";
import { Conflicts } from "./pages/Conflicts.js";

function RequireAuth() {
  return getToken() ? <Shell /> : <Navigate to="/login" replace />;
}

function Shell() {
  const nav = useNavigate();
  const navItem = "block rounded px-3 py-1.5 text-sm";
  return (
    <div className="flex min-h-full">
      <aside className="w-52 shrink-0 border-r border-border bg-muted/40 p-3">
        <div className="mb-4 px-2">
          <div className="text-sm font-semibold">LawLink</div>
          <div className="text-[11px] text-muted-foreground">{getRole()}</div>
        </div>
        <nav className="space-y-1">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `${navItem} ${isActive ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`
            }
          >
            收案
          </NavLink>
          <NavLink
            to="/conflicts"
            className={({ isActive }) =>
              `${navItem} ${isActive ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`
            }
          >
            利益冲突
          </NavLink>
        </nav>
        <button
          onClick={() => {
            setSession(null);
            nav("/login");
          }}
          className="mt-4 px-3 text-xs text-muted-foreground hover:text-foreground"
        >
          退出登录
        </button>
      </aside>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<Intakes />} />
        <Route path="/conflicts" element={<Conflicts />} />
      </Route>
    </Routes>
  );
}
