import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type NotificationRow } from "@/lib/api";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const TYPE_CN: Record<string, string> = {
  PRESERVATION_EXPIRY: "保全到期",
  HEARING_REMINDER: "开庭提醒",
  DEADLINE_REMINDER: "期限提醒",
  SEAL_STATUS_CHANGE: "用印状态",
  SMS_ARRIVAL: "法院短信",
  TASK_ASSIGNED: "任务指派",
  ARCHIVE_APPROVED: "归档通过",
  ARCHIVE_REJECTED: "归档驳回",
  SYSTEM: "系统",
};
const PRIORITY_VARIANT: Record<string, BadgeProps["variant"]> = {
  LOW: "secondary",
  NORMAL: "secondary",
  HIGH: "orange",
  URGENT: "destructive",
};

export function Notifications() {
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setRows(await api.listNotifications(unreadOnly));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadOnly]);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const unread = rows.filter((r) => !r.read).length;

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-base font-semibold tracking-tight">通知中心</h1>
          <p className="text-xs text-muted-foreground">用印审批、任务指派、保全到期等提醒</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setUnreadOnly((v) => !v)}>
            {unreadOnly ? "查看全部" : "只看未读"}
          </Button>
          <Button variant="outline" size="sm" disabled={unread === 0} onClick={() => act(() => api.markAllNotificationsRead())}>
            全部已读
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-sm border border-destructive/30 bg-[#fde8e8] px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <Card className="divide-y divide-border">
        {rows.map((n) => {
          const body = (
            <div className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                  <Badge variant="secondary" className="text-[10px]">{TYPE_CN[n.type] ?? n.type}</Badge>
                  {(n.priority === "HIGH" || n.priority === "URGENT") && (
                    <Badge variant={PRIORITY_VARIANT[n.priority] ?? "secondary"} className="text-[10px]">
                      {n.priority === "URGENT" ? "紧急" : "重要"}
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground tabular">{n.createdAt.slice(0, 16).replace("T", " ")}</span>
                </div>
                <div className={`text-sm ${n.read ? "text-muted-foreground" : "font-medium"}`}>{n.title}</div>
                {n.content && <div className="text-xs text-muted-foreground">{n.content}</div>}
              </div>
              {!n.read && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.preventDefault();
                    void act(() => api.markNotificationRead(n.id));
                  }}
                >
                  标记已读
                </Button>
              )}
            </div>
          );
          // A notification with an href links to its target (and is dismissed there
          // via the explicit button); without one it's a plain row.
          return n.href ? (
            <Link key={n.id} to={n.href} className="block hover:bg-muted/40" onClick={() => !n.read && act(() => api.markNotificationRead(n.id))}>
              {body}
            </Link>
          ) : (
            <div key={n.id}>{body}</div>
          );
        })}
        {rows.length === 0 && (
          <div className="py-12 text-center text-xs text-muted-foreground">
            {unreadOnly ? "没有未读通知" : "暂无通知"}
          </div>
        )}
      </Card>
    </div>
  );
}
