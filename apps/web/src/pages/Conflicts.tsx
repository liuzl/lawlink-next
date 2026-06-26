import { useState, type FormEvent } from "react";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { api, type ConflictResult } from "@/lib/api";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const QUERY_ROLES: { value: string; label: string }[] = [
  { value: "CLIENT_PARTY", label: "拟委托方" },
  { value: "OPPOSING_PARTY", label: "相对方" },
  { value: "THIRD_PARTY", label: "第三人" },
];

const PARTY_ROLE_CN: Record<string, string> = {
  CLIENT_PARTY: "委托方",
  OPPOSING_PARTY: "对方",
  THIRD_PARTY: "第三人",
  CO_LITIGANT: "共同诉讼人",
  AGENT: "代理人",
  WITNESS: "证人",
  OTHER: "其他",
};

const SEVERITY_CN: Record<string, string> = {
  BLOCKING: "阻塞",
  HIGH: "高",
  MEDIUM: "中",
  LOW: "低",
  NONE: "无",
};
const SEVERITY_VARIANT: Record<string, BadgeProps["variant"]> = {
  BLOCKING: "red",
  HIGH: "red",
  MEDIUM: "orange",
  LOW: "green",
  NONE: "secondary",
};

function SeverityBadge({ severity, className }: { severity: string; className?: string }) {
  return (
    <Badge
      variant={SEVERITY_VARIANT[severity] ?? "secondary"}
      className={`${severity === "BLOCKING" ? "font-semibold" : ""} ${className ?? ""}`.trim()}
    >
      {SEVERITY_CN[severity] ?? severity}
    </Badge>
  );
}

export function Conflicts() {
  const [name, setName] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [candidateRole, setCandidateRole] = useState(QUERY_ROLES[0].value);
  const [result, setResult] = useState<ConflictResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      setResult(
        await api.conflictCheck({
          name: name || undefined,
          idNumber: idNumber || undefined,
          candidateRole,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const clear = result && result.hitCount === 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-base font-semibold tracking-tight">利益冲突检索</h1>
        <p className="text-xs text-muted-foreground">按当事人名称 / 证件号检索历史案件与收案中的潜在冲突</p>
      </div>

      {error && (
        <div className="rounded-sm border border-destructive/30 bg-[#fde8e8] px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">检索条件</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={run} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="name">名称</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="当事人名称"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="idNumber">证件号（可选）</Label>
              <Input
                id="idNumber"
                value={idNumber}
                onChange={(e) => setIdNumber(e.target.value)}
                placeholder="统一社会信用代码 / 身份证号"
              />
            </div>
            <div className="space-y-1.5">
              <Label>本次角色</Label>
              <Select value={candidateRole} onValueChange={setCandidateRole}>
                <SelectTrigger>
                  <SelectValue placeholder="选择角色" />
                </SelectTrigger>
                <SelectContent>
                  {QUERY_ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? "检索中…" : "检索"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              {clear ? (
                <ShieldCheck className="h-4 w-4 text-[#1aa126]" strokeWidth={1.8} />
              ) : (
                <ShieldAlert className="h-4 w-4 text-[#d4252f]" strokeWidth={1.8} />
              )}
              检索结果
              <span className="font-normal text-muted-foreground">· {result.hitCount} 命中</span>
            </CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">最高等级</span>
              <SeverityBadge severity={result.topSeverity} />
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {result.hits.map((h, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-sm border border-border px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{h.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    历史角色 {PARTY_ROLE_CN[h.historyRole] ?? h.historyRole} · 命中字段 {h.matchedField} ·{" "}
                    {h.matterId ? "案件" : "收案"}
                  </div>
                </div>
                <SeverityBadge severity={h.severity} className="shrink-0" />
              </div>
            ))}
            {clear && (
              <p className="py-4 text-center text-xs text-muted-foreground">
                无命中 — 未发现利益冲突。
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
