import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, setSession } from "../lib/api.js";
import { Button, Card, Field, Input } from "../ui.js";

export function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token, user } = await api.login(email, password);
      setSession(token, user.role);
      nav("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-1 text-lg font-semibold">LawLink</h1>
        <p className="mb-5 text-xs text-muted-foreground">律师案件管理 · 登录</p>
        <form onSubmit={onSubmit} className="space-y-3">
          <Field label="邮箱">
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="username"
              placeholder="you@firm.com"
            />
          </Field>
          <Field label="密码">
            <Input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
            />
          </Field>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "登录中…" : "登录"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
