import { useEffect, useState } from "react";
import { api, type AuditRow } from "@/lib/api";
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

const ACTION_CN: Record<string, string> = {
  LOGIN: "登录",
  INTAKE_CREATE: "新建收案",
  INTAKE_CONVERT: "转正式案件",
  INTAKE_DECLINE: "不接案",
  CONFLICT_CHECK: "利益冲突检索",
  PROCEDURE_CREATE: "新增程序",
  DEADLINE_RULES_APPLY: "推算期限",
  DEADLINE_CREATE: "新增期限",
  DEADLINE_COMPLETE: "完成期限",
  PRESERVATION_CREATE: "新增保全",
  PRESERVATION_RENEW: "保全续期",
  PRESERVATION_LIFT: "解除保全",
  PRESERVATION_EXPIRE_SCAN: "保全到期扫描",
  TASK_CREATE: "新建任务",
  TASK_COMPLETE: "完成任务",
  NOTE_CREATE: "沟通记录",
  HEARING_CREATE: "新增开庭",
  CLIENT_CREATE: "新建客户",
  CLIENT_UPDATE: "编辑客户",
  CONTACT_CREATE: "新增联系人",
  MATTER_ARCHIVE: "归档",
  COMMISSION_PLAN_SET: "设分成方案",
  FEE_ENTRY_CREATE: "记收付",
  FEE_ENTRY_DELETE: "删收付",
};

export function Audit() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getAudit()
      .then(setRows)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-base font-semibold tracking-tight">审计日志</h1>
        <p className="text-xs text-muted-foreground">关键操作留痕（仅管理员可见，只追加）</p>
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
              <TableHead>时间</TableHead>
              <TableHead>操作</TableHead>
              <TableHead>对象</TableHead>
              <TableHead>详情</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular">
                  {new Date(r.createdAt).toLocaleString("zh-CN")}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{ACTION_CN[r.action] ?? r.action}</Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.targetType ? `${r.targetType} ${r.targetId?.slice(0, 8) ?? ""}` : "—"}
                </TableCell>
                <TableCell className="max-w-xs truncate font-mono text-xs text-muted-foreground">
                  {r.detailJson ?? "—"}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && !error && (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-xs text-muted-foreground">
                  暂无审计记录
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
