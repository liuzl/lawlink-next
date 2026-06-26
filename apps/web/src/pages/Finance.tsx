import { useEffect, useState } from "react";
import { api, getRole, type FinanceOverview } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
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

const MONTH_CN: Record<string, string> = {
  "3": "近3月",
  "6": "近6月",
  "12": "近12月",
};
const MONTH_OPTIONS = Object.keys(MONTH_CN);

const FEE_TYPE_CN: Record<string, string> = {
  RECEIVABLE: "应收",
  RECEIVED: "实收",
  REFUND: "退费",
  COST: "成本",
  COMMISSION: "分成",
};

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

export function Finance() {
  const role = getRole();
  const allowed = role === "ADMIN" || role === "PRINCIPAL_LAWYER" || role === "FINANCE";

  const [months, setMonths] = useState(6);
  const [data, setData] = useState<FinanceOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed) return;
    setError(null);
    api
      .getFinanceOverview(months)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [allowed, months]);

  if (!allowed) {
    return (
      <div className="space-y-5">
        <h1 className="text-base font-semibold tracking-tight">财务</h1>
        <div className="rounded-sm border border-destructive/30 bg-[#fde8e8] px-3 py-2 text-xs text-destructive">
          仅管理员 / 主任 / 财务可查看全所财务
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-base font-semibold tracking-tight">财务</h1>
          <p className="text-xs text-muted-foreground">
            全所财务台账{data ? ` · 近${data.months}月` : ""}
          </p>
        </div>
        <Select value={String(months)} onValueChange={(v) => setMonths(Number(v))}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="统计区间" />
          </SelectTrigger>
          <SelectContent>
            {MONTH_OPTIONS.map((m) => (
              <SelectItem key={m} value={m}>
                {MONTH_CN[m]}
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
            <Kpi label="净实收" value={formatCurrency(Number(data.summary.netReceived))} />
            <Kpi label="实收" value={formatCurrency(Number(data.summary.received))} />
            <Kpi label="应收" value={formatCurrency(Number(data.summary.receivable))} />
            <Kpi label="成本" value={formatCurrency(Number(data.summary.cost))} />
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">月度净实收</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {data.monthly.map((m) => (
                <div
                  key={m.month}
                  className="flex items-center justify-between border-b border-border pb-1.5 last:border-0"
                >
                  <span className="text-muted-foreground">{m.month}</span>
                  <span className="ll-stat tabular">{formatCurrency(Number(m.netReceived))}</span>
                </div>
              ))}
              {data.monthly.length === 0 && (
                <p className="py-3 text-center text-xs text-muted-foreground">本期暂无数据</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">流水台账</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>时间</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>案件</TableHead>
                    <TableHead>对象</TableHead>
                    <TableHead className="text-right">金额</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.ledger.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="tabular">{row.occurredAt.slice(0, 10)}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{FEE_TYPE_CN[row.type] ?? row.type}</Badge>
                      </TableCell>
                      <TableCell className="font-mono">{row.internalCode}</TableCell>
                      <TableCell>{row.payerOrPayee ?? "—"}</TableCell>
                      <TableCell className="text-right tabular">
                        {formatCurrency(Number(row.amount))}
                      </TableCell>
                    </TableRow>
                  ))}
                  {data.ledger.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-xs text-muted-foreground">
                        本期暂无流水
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
