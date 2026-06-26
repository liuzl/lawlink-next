import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CalendarClock, ClipboardCheck, FolderOpen, Snowflake } from "lucide-react";
import { api, type DashboardData } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const DL_CAT_CN: Record<string, string> = {
  APPEAL: "上诉期",
  RESPONSE: "答辩期",
  ENFORCEMENT: "申请执行",
  RETRIAL_APPLICATION: "申请再审",
  ARBITRATION_SET_ASIDE: "撤销仲裁",
  LIMITATION: "诉讼时效",
  CUSTOM: "自定义",
};
const PROP_CN: Record<string, string> = {
  BANK_DEPOSIT: "银行存款",
  REAL_ESTATE: "房产",
  VEHICLE: "车辆",
  EQUITY: "股权",
  IP: "知识产权",
  OTHER: "其他",
};

function days(dateStr: string): number {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  const due = new Date(y, (m ?? 1) - 1, d ?? 1);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}
function countdown(n: number) {
  const cls = n < 0 ? "text-destructive" : n <= 7 ? "text-destructive" : n <= 15 ? "text-status-orange" : "text-muted-foreground";
  return <span className={`tabular ${cls}`}>{n < 0 ? `已逾期 ${-n} 天` : `剩 ${n} 天`}</span>;
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">{icon}</div>
        <div>
          <div className="ll-stat text-xl">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getDashboard()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!data) return <p className="text-xs text-muted-foreground">加载中…</p>;

  return (
    <div className="space-y-5">
      <h1 className="text-base font-semibold tracking-tight">工作台</h1>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={<FolderOpen className="h-4 w-4" />} label="办理中案件" value={data.counts.activeMatters} />
        <Kpi icon={<ClipboardCheck className="h-4 w-4" />} label="待确认收案" value={data.counts.pendingIntakes} />
        <Kpi icon={<CalendarClock className="h-4 w-4" />} label={`近${data.horizonDays}天到期期限`} value={data.counts.upcomingDeadlines} />
        <Kpi icon={<Snowflake className="h-4 w-4" />} label={`近${data.horizonDays}天到期保全`} value={data.counts.expiringPreservations} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <CalendarClock className="h-4 w-4 text-primary" strokeWidth={1.8} /> 近期到期期限
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.upcomingDeadlines.map((d) => (
              <Link
                key={d.id}
                to={`/matters/${d.matterId}`}
                className="ll-row flex items-center justify-between rounded-sm border border-hairline px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <span className="ll-chip tabular mr-2">{DL_CAT_CN[d.category] ?? d.category}</span>
                  <span className="font-medium">{d.title}</span>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    <span className="font-mono">{d.internalCode}</span> · {d.matterTitle} · 截止 {d.dueAt.slice(0, 10)}
                  </div>
                </div>
                {countdown(days(d.dueAt))}
              </Link>
            ))}
            {data.upcomingDeadlines.length === 0 && (
              <p className="py-3 text-center text-xs text-muted-foreground">近 {data.horizonDays} 天无到期期限</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="h-4 w-4 text-status-orange" strokeWidth={1.8} /> 近期到期保全
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.expiringPreservations.map((p) => (
              <Link
                key={p.id}
                to={`/matters/${p.matterId}`}
                className="ll-row flex items-center justify-between rounded-sm border border-hairline px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <span className="font-medium">{PROP_CN[p.propertyType] ?? p.propertyType}</span>
                  {p.respondent && <span className="ml-2 text-xs text-muted-foreground">{p.respondent}</span>}
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    <span className="font-mono">{p.internalCode}</span> · 到期 {p.expiryDate.slice(0, 10)}
                  </div>
                </div>
                {countdown(days(p.expiryDate))}
              </Link>
            ))}
            {data.expiringPreservations.length === 0 && (
              <p className="py-3 text-center text-xs text-muted-foreground">近 {data.horizonDays} 天无到期保全</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
