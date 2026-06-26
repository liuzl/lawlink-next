import { useEffect, useState } from "react";

/**
 * P0 placeholder UI — verifies the SPA can reach the Hono API.
 * Real screens (ported from the original React components) arrive in P3.
 */
export function App() {
  const [status, setStatus] = useState("checking…");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d: { status: string }) => setStatus(d.status))
      .catch(() => setStatus("unreachable"));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui", padding: "2rem", lineHeight: 1.6 }}>
      <h1>lawlink-next</h1>
      <p>Agent-native rewrite — P0 skeleton.</p>
      <p>
        API health: <strong>{status}</strong>
      </p>
    </main>
  );
}
