import { useEffect, useState, type FormEvent } from "react";
import { api, getRole, type IntakeRow } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const CATEGORY_CN: Record<string, string> = {
  CIVIL_COMMERCIAL: "民商",
  CRIMINAL: "刑事",
  ADMINISTRATIVE: "行政",
  NON_LITIGATION: "非诉",
  LEGAL_COUNSEL: "顾问",
  SPECIAL_PROJECT: "专项",
};
const CATEGORIES = Object.keys(CATEGORY_CN);

const STATUS_CN: Record<string, string> = {
  INTAKE: "已咨询",
  PENDING_CONFIRMATION: "待确认",
  CONVERTED: "已转化",
  DECLINED: "不接案",
  NEEDS_REVISION: "待补正",
};
const STATUS_VARIANT: Record<string, BadgeProps["variant"]> = {
  INTAKE: "blue",
  PENDING_CONFIRMATION: "orange",
  CONVERTED: "green",
  DECLINED: "secondary",
  NEEDS_REVISION: "purple",
};

const NON_TERMINAL = new Set(["INTAKE", "PENDING_CONFIRMATION"]);

function claimDisplay(amount: string | null): string {
  if (!amount) return "—";
  const n = Number(amount);
  return Number.isFinite(n) ? formatCurrency(n) : amount;
}

export function Intakes() {
  const [rows, setRows] = useState<IntakeRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");
  const [opposingName, setOpposingName] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [claimAmount, setClaimAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const role = getRole();
  const isManager = role === "ADMIN" || role === "PRINCIPAL_LAWYER";

  async function refresh() {
    try {
      setRows(await api.listIntakes());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.createIntake({
        clientName,
        opposingName: opposingName || undefined,
        category,
        claimAmount: claimAmount || undefined,
      });
      setClientName("");
      setOpposingName("");
      setClaimAmount("");
      setCategory(CATEGORIES[0]);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-base font-semibold tracking-tight">收案登记</h1>
          <p className="text-xs text-muted-foreground">登记新咨询，并对线索进行转正式案件 / 不接案处置</p>
        </div>
        <span className="text-xs text-muted-foreground tabular">{rows.length} 条</span>
      </div>

      {error && (
        <div className="rounded-sm border border-destructive/30 bg-[#fde8e8] px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">新建收案</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="clientName">委托方</Label>
              <Input
                id="clientName"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="委托方名称"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opposingName">对方（可选）</Label>
              <Input
                id="opposingName"
                value={opposingName}
                onChange={(e) => setOpposingName(e.target.value)}
                placeholder="相对方名称"
              />
            </div>
            <div className="space-y-1.5">
              <Label>案件类别</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="选择类别" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CATEGORY_CN[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="claimAmount">标的额（可选）</Label>
              <Input
                id="claimAmount"
                value={claimAmount}
                onChange={(e) => setClaimAmount(e.target.value)}
                placeholder="0.00"
                inputMode="decimal"
              />
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? "提交中…" : "新建收案"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>标题</TableHead>
              <TableHead>类别</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">标的额</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const actionable = isManager && NON_TERMINAL.has(r.status);
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.title}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {CATEGORY_CN[r.category] ?? r.category}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[r.status] ?? "secondary"}>
                      {STATUS_CN[r.status] ?? r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular text-muted-foreground">
                    {claimDisplay(r.claimAmount)}
                  </TableCell>
                  <TableCell className="text-right">
                    {actionable ? (
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => act(() => api.convertIntake(r.id))}
                        >
                          转正式案件
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => act(() => api.declineIntake(r.id, "不接案"))}
                        >
                          不接案
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-xs text-muted-foreground">
                  暂无收案
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
