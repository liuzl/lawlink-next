import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { api, getRole, type MatterDetail as MatterDetailData } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
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

const PROC_CN: Record<string, string> = {
  FIRST_INSTANCE: "一审", SECOND_INSTANCE: "二审", RETRIAL_REVIEW: "再审审查", RETRIAL: "再审",
  REMAND_FIRST: "重审一审", REMAND_SECOND: "重审二审", PROSECUTORIAL_SUPERVISION: "检察监督",
  COMMERCIAL_ARBITRATION: "民商事仲裁", LABOR_ARBITRATION: "劳动仲裁", ARBITRATION_SET_ASIDE: "申请撤销仲裁",
  ARBITRATION_ENFORCEMENT_REVIEW: "不予执行仲裁审查", ENFORCEMENT: "强制执行", ENFORCEMENT_OBJECTION: "执行异议",
  INVESTIGATION: "侦查", PROSECUTION_REVIEW: "审查起诉", DEATH_PENALTY_REVIEW: "死刑复核",
  CRIMINAL_ENFORCEMENT: "刑罚执行", COMMUTATION_PAROLE_REVIEW: "减刑假释审查",
  ADMIN_RECONSIDERATION: "行政复议", ADMIN_NON_LITIGATION_ENFORCEMENT: "非诉行政执行",
  NON_LITIGATION_PHASE: "项目阶段", CUSTOM: "自定义",
};
// Mirrors core PROCEDURES_BY_CATEGORY (server validates authoritatively).
const PROCS_BY_CAT: Record<string, string[]> = {
  CIVIL_COMMERCIAL: ["FIRST_INSTANCE", "SECOND_INSTANCE", "RETRIAL_REVIEW", "RETRIAL", "REMAND_FIRST", "REMAND_SECOND", "COMMERCIAL_ARBITRATION", "LABOR_ARBITRATION", "ARBITRATION_SET_ASIDE", "ARBITRATION_ENFORCEMENT_REVIEW", "ENFORCEMENT", "ENFORCEMENT_OBJECTION", "PROSECUTORIAL_SUPERVISION", "CUSTOM"],
  CRIMINAL: ["INVESTIGATION", "PROSECUTION_REVIEW", "FIRST_INSTANCE", "SECOND_INSTANCE", "DEATH_PENALTY_REVIEW", "RETRIAL_REVIEW", "RETRIAL", "CRIMINAL_ENFORCEMENT", "COMMUTATION_PAROLE_REVIEW", "PROSECUTORIAL_SUPERVISION", "CUSTOM"],
  ADMINISTRATIVE: ["ADMIN_RECONSIDERATION", "FIRST_INSTANCE", "SECOND_INSTANCE", "RETRIAL_REVIEW", "RETRIAL", "ADMIN_NON_LITIGATION_ENFORCEMENT", "PROSECUTORIAL_SUPERVISION", "CUSTOM"],
  NON_LITIGATION: ["NON_LITIGATION_PHASE", "CUSTOM"],
  LEGAL_COUNSEL: ["NON_LITIGATION_PHASE", "CUSTOM"],
  SPECIAL_PROJECT: ["NON_LITIGATION_PHASE", "CUSTOM"],
};
const PARTY_CN: Record<string, string> = {
  CLIENT_PARTY: "委托方",
  OPPOSING_PARTY: "对方",
  THIRD_PARTY: "第三人",
};

export function MatterDetail() {
  const { id = "" } = useParams();
  const [matter, setMatter] = useState<MatterDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState("");
  const [caseNumber, setCaseNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const role = getRole();
  const canEdit = role === "ADMIN" || role === "PRINCIPAL_LAWYER" || role === "LAWYER";

  // Load on id change with a cancellation guard so a slower response from a
  // previous matter can't overwrite the current route; clear stale state first.
  useEffect(() => {
    let active = true;
    setMatter(null);
    setError(null);
    api
      .getMatter(id)
      .then((m) => {
        if (active) setMatter(m);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [id]);

  async function refresh() {
    try {
      setMatter(await api.getMatter(id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const allowedTypes = matter ? (PROCS_BY_CAT[matter.category] ?? []) : [];

  async function addProc(e: FormEvent) {
    e.preventDefault();
    if (!type) return;
    setBusy(true);
    setError(null);
    try {
      await api.addProcedure(id, { type, caseNumber: caseNumber || undefined });
      setType("");
      setCaseNumber("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (error && !matter) {
    return (
      <div className="space-y-4">
        <Link to="/matters" className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-3.5 w-3.5" /> 返回案件列表
        </Link>
        <div className="rounded-sm border border-destructive/30 bg-[#fde8e8] px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      </div>
    );
  }
  if (!matter) return <div className="text-xs text-muted-foreground">加载中…</div>;

  return (
    <div className="space-y-5">
      <Link to="/matters" className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-3.5 w-3.5" /> 返回案件列表
      </Link>

      <div className="flex flex-wrap items-baseline gap-3">
        <span className="font-mono text-sm text-muted-foreground">{matter.internalCode}</span>
        <h1 className="text-base font-semibold tracking-tight">{matter.title}</h1>
        <Badge variant="secondary">{matter.status}</Badge>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">当事人</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {matter.parties.map((p) => (
            <span key={p.id} className="ll-chip">
              <span className="text-muted-foreground">{PARTY_CN[p.role] ?? p.role}</span>
              {p.name}
            </span>
          ))}
          {matter.parties.length === 0 && <span className="text-xs text-muted-foreground">无</span>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">程序</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {matter.procedures.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-sm border border-border px-3 py-2.5"
            >
              <div className="flex items-center gap-3">
                <span className="ll-chip-primary ll-chip tabular">{p.order}</span>
                <span className="text-sm font-medium">{PROC_CN[p.type] ?? p.type}</span>
                {p.engagement === "INFORMATIONAL" && (
                  <Badge variant="secondary" className="text-[10px]">前序参考</Badge>
                )}
                {p.caseNumber && (
                  <span className="font-mono text-xs text-muted-foreground">{p.caseNumber}</span>
                )}
              </div>
              <Badge variant="secondary" className="text-[10px]">{p.status}</Badge>
            </div>
          ))}
          {matter.procedures.length === 0 && (
            <p className="py-2 text-xs text-muted-foreground">尚无程序</p>
          )}

          {canEdit && (
            <form onSubmit={addProc} className="flex flex-wrap items-end gap-3 pt-2">
              <div className="space-y-1.5">
                <Label>新增程序</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger className="w-44">
                    <SelectValue placeholder="选择程序类型" />
                  </SelectTrigger>
                  <SelectContent>
                    {allowedTypes.map((t) => (
                      <SelectItem key={t} value={t}>
                        {PROC_CN[t] ?? t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>案号（可选）</Label>
                <Input
                  value={caseNumber}
                  onChange={(e) => setCaseNumber(e.target.value)}
                  placeholder="(2026)沪01民初…"
                  className="w-52"
                />
              </div>
              <Button type="submit" disabled={busy || !type}>
                {busy ? "添加中…" : "添加程序"}
              </Button>
            </form>
          )}
          {error && matter && <p className="text-xs text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
