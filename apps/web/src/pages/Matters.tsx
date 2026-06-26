import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type MatterRow } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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

function claim(amount: string | null): string {
  if (!amount) return "—";
  const n = Number(amount);
  return Number.isFinite(n) ? formatCurrency(n) : amount;
}

export function Matters() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<MatterRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listMatters()
      .then(setRows)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-base font-semibold tracking-tight">案件</h1>
          <p className="text-xs text-muted-foreground">由收案转化而来的正式案件，按程序分阶段办理</p>
        </div>
        <span className="text-xs text-muted-foreground tabular">{rows.length} 件</span>
      </div>

      {error && (
        <div className="rounded-sm border border-destructive/30 bg-[#fde8e8] px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>案号</TableHead>
              <TableHead>标题</TableHead>
              <TableHead>类别</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">标的额</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow
                key={r.id}
                className="cursor-pointer"
                onClick={() => navigate(`/matters/${r.id}`)}
              >
                <TableCell className="font-mono text-xs">{r.internalCode}</TableCell>
                <TableCell className="font-medium">{r.title}</TableCell>
                <TableCell className="text-muted-foreground">
                  {CATEGORY_CN[r.category] ?? r.category}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{r.status}</Badge>
                </TableCell>
                <TableCell className="text-right tabular text-muted-foreground">
                  {claim(r.claimAmount)}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && !error && (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                  暂无案件（你可见范围内）
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
