import { useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Scale, ShieldCheck, Sparkles, AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { api, setSession } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token, user } = await api.login(email, password);
      setSession(token, user.role);
      // Return to where the user was bounced from. Only honor internal paths
      // (single leading slash) to avoid an open-redirect via ?next=//evil.com.
      const next = searchParams.get("next");
      const dest = next && /^\/(?!\/)/.test(next) ? next : "/";
      navigate(dest, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="grid w-full max-w-5xl grid-cols-1 gap-0 lg:grid-cols-2">
        {/* 左侧：品牌区 */}
        <div className="hidden flex-col justify-between rounded-l-lg border border-r-0 border-border bg-muted/30 p-10 lg:flex">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Scale className="h-4 w-4" strokeWidth={1.8} />
            </div>
            <div>
              <div className="text-lg font-semibold tracking-tight">LawLink</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">律师工作台</div>
            </div>
          </div>

          <div className="space-y-8">
            <div className="space-y-4">
              <div className="text-xs text-primary">{new Date().getFullYear()}</div>
              <h2 className="text-2xl font-semibold leading-snug tracking-tight">
                把精力放在案件本身，
                <br />
                而不是表格里。
              </h2>
              <div className="h-[2px] w-8 rounded-full bg-primary" />
            </div>

            <ul className="space-y-3.5 text-sm text-muted-foreground">
              <Feature icon={<ShieldCheck className="h-3.5 w-3.5" />}>
                数据自托管，附件可选加密，不依赖第三方 SaaS
              </Feature>
              <Feature icon={<Sparkles className="h-3.5 w-3.5" />}>
                覆盖收案、冲突检索、多程序串接、财务分成、归档全流程
              </Feature>
              <Feature icon={<Scale className="h-3.5 w-3.5" />}>
                规范案由库（民商事 / 刑事 / 行政）从源头消除字符串歧义
              </Feature>
            </ul>
          </div>

          <div className="text-[11px] text-muted-foreground/70">MIT 协议 · 自主部署</div>
        </div>

        {/* 右侧：登录卡 */}
        <div className="flex flex-col justify-center rounded-lg border border-border bg-card p-10 lg:rounded-l-none">
          <div className="mb-8">
            <div className="text-xs text-muted-foreground">登录</div>
            <h1 className="mt-2 text-xl font-semibold tracking-tight">欢迎回来</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">用您的工作邮箱登录</p>
          </div>

          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {error && (
              <Alert variant="destructive" className="border-destructive/40 bg-destructive/10">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                autoComplete="username"
                placeholder="you@example.com"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">密码</Label>
              <div className="relative">
                <Input
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  className="pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button type="submit" disabled={busy} className="h-10 w-full gap-2 shadow-md">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? "登录中..." : "登录"}
            </Button>

            <p className="text-center text-xs text-muted-foreground">忘记密码？联系系统管理员重置</p>
          </form>
        </div>
      </div>
    </div>
  );
}

function Feature({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        {icon}
      </span>
      <span>{children}</span>
    </li>
  );
}
