import { useEffect, useState } from "react";
import { api, getRole, type ReportData } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

const PRESET_CN: Record<string, string> = {
  month: "本月",
  quarter: "本季度",
  year: "本年",
  lastYear: "去年",
};
const PRESETS = Object.keys(PRESET_CN);

const CATEGORY_CN: Record<string, string> = {
  CIVIL_COMMERCIAL: "民商事",
  CRIMINAL: "刑事",
  ADMINISTRATIVE: "行政",
  NON_LITIGATION: "非诉",
  LEGAL_COUNSEL: "顾问",
  SPECIAL_PROJECT: "专项",
};
const STATUS_CN: Record<string, string> = {
  PENDING_ACCEPTANCE: "待接受",
  IN_PROGRESS: "办理中",
  ON_HOLD: "挂起",
  ARCHIVED: "已归档",
};

function yuan(s: string): string {
  const n = Number(s);
  return Number.isFinite(n) ? formatCurrency(n) : s;
}

function Kpi({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="ll-stat text-xl">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

export function Reports() {
  const role = getRole();
  const isManager = role === "ADMIN" || role === "PRINCIPAL_LAWYER";

  const [preset, setPreset] = useState("month");
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isManager) return;
    setError(null);
    api
      .getReport({ preset })
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [isManager, preset]);

  if (!isManager) {
    return (
      <div className="space-y-5">
        <h1 className="text-base font-semibold tracking-tight">报表</h1>
        <div className="rounded-sm border border-destructive/30 bg-[#fde8e8] px-3 py-2 text-xs text-destructive">
          仅管理员 / 主任可查看全所报表
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-base font-semibold tracking-tight">报表</h1>
          <p className="text-xs text-muted-foreground">
            全所统计{data ? ` · ${data.period.label}` : ""}
          </p>
        </div>
        <Select value={preset} onValueChange={setPreset}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="统计区间" />
          </SelectTrigger>
          <SelectContent>
            {PRESETS.map((p) => (
              <SelectItem key={p} value={p}>
                {PRESET_CN[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && (
        <div className="rounded-sm border border-destructive/30 bg-[#fde8e8] px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      {!data && !error && <p className="text-xs text-muted-foreground">加载中…</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="本期新建案件" value={data.activity.newMatters} />
            <Kpi label="本期新收咨询" value={data.activity.newIntakes} />
            <Kpi label="本期结案" value={data.activity.closedMatters} />
            <Kpi label="办理中案件" value={data.portfolio.active} />
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">本期财务</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {[
                  ["实收", data.activity.finance.received],
                  ["退费", data.activity.finance.refund],
                  ["净实收", data.activity.finance.netReceived],
                  ["成本", data.activity.finance.cost],
                  ["分成", data.activity.finance.commission],
                  ["应收", data.activity.finance.receivable],
                ].map(([label, val]) => (
                  <div key={label} className="flex items-center justify-between border-b border-border pb-1.5 last:border-0">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="ll-stat tabular">¥{yuan(val)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">案件分布</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">按类别</div>
                  <div className="flex flex-wrap gap-2">
                    {data.portfolio.byCategory.map((c) => (
                      <span key={c.category} className="ll-chip">
                        {CATEGORY_CN[c.category] ?? c.category}
                        <span className="ml-1 tabular text-muted-foreground">{c.count}</span>
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">按状态（全部 {data.portfolio.total}）</div>
                  <div className="flex flex-wrap gap-2">
                    {data.portfolio.byStatus.map((s) => (
                      <span key={s.status} className="ll-chip">
                        {STATUS_CN[s.status] ?? s.status}
                        <span className="ml-1 tabular text-muted-foreground">{s.count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">律师业绩</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>律师</TableHead>
                    <TableHead className="text-right">在办案件</TableHead>
                    <TableHead className="text-right">本期实收</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byLawyer.map((l) => (
                    <TableRow key={l.userId}>
                      <TableCell className="font-medium">{l.name}</TableCell>
                      <TableCell className="text-right tabular">{l.activeOwned}</TableCell>
                      <TableCell className="text-right tabular">¥{yuan(l.receivedInPeriod)}</TableCell>
                    </TableRow>
                  ))}
                  {data.byLawyer.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="py-8 text-center text-xs text-muted-foreground">
                        本期暂无数据
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
