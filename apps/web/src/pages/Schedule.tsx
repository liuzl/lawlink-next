import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ScheduleData, type ScheduleItem } from "@/lib/api";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const KIND_CN: Record<string, string> = {
  HEARING: "开庭",
  DEADLINE: "期限",
  PRESERVATION: "保全到期",
  TASK: "任务",
};
const KIND_VARIANT: Record<string, BadgeProps["variant"]> = {
  HEARING: "blue",
  DEADLINE: "orange",
  PRESERVATION: "purple",
  TASK: "secondary",
};

function groupByDay(items: ScheduleItem[]): { day: string; items: ScheduleItem[] }[] {
  const groups: { day: string; items: ScheduleItem[] }[] = [];
  for (const item of items) {
    const day = item.at.slice(0, 10);
    let group = groups.find((g) => g.day === day);
    if (!group) {
      group = { day, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

export function Schedule() {
  const [data, setData] = useState<ScheduleData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    api
      .getSchedule()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-base font-semibold tracking-tight">日程</h1>
        <p className="text-xs text-muted-foreground">开庭 / 期限 / 保全到期 / 任务（按时间）</p>
      </div>

      {error && (
        <div className="rounded-sm border border-destructive/30 bg-[#fde8e8] px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      {!data && !error && <p className="text-xs text-muted-foreground">加载中…</p>}

      {data && (
        <Card>
          <CardContent className="space-y-4 py-4">
            {data.items.length === 0 && (
              <p className="py-8 text-center text-xs text-muted-foreground">该时间段暂无日程</p>
            )}
            {groupByDay(data.items).map((group) => (
              <div key={group.day} className="space-y-2">
                <div className="text-xs text-muted-foreground">{group.day}</div>
                {group.items.map((item) => {
                  const past = new Date(item.at) < new Date();
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between rounded-sm border border-border px-3 py-2 text-sm"
                    >
                      <div className={`flex min-w-0 items-center gap-2 ${past ? "text-muted-foreground" : ""}`}>
                        <Badge variant={KIND_VARIANT[item.kind]}>{KIND_CN[item.kind]}</Badge>
                        <span className="tabular text-muted-foreground">{item.at.slice(11, 16)}</span>
                        <span className="truncate font-medium">{item.title}</span>
                      </div>
                      {item.matterId && (
                        <Link
                          to={`/matters/${item.matterId}`}
                          className="ml-2 shrink-0 font-mono text-xs text-primary"
                        >
                          {item.internalCode}
                        </Link>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
