import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { CalendarClock, Check, ChevronLeft, Gavel, ListChecks, MessageSquare, Snowflake } from "lucide-react";
import {
  api,
  getRole,
  type DeadlineRow,
  type HearingRow,
  type MatterDetail as MatterDetailData,
  type NoteRow,
  type PreservationRow,
  type TaskRow,
} from "@/lib/api";
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
const DL_EVENTS: { value: string; label: string }[] = [
  { value: "JUDGMENT_SERVED", label: "判决书送达" },
  { value: "RULING_SERVED", label: "裁定书送达" },
  { value: "COMPLAINT_SERVED", label: "起诉状副本送达" },
  { value: "JUDGMENT_EFFECTIVE", label: "裁判生效" },
  { value: "PERFORMANCE_DUE", label: "履行期限届满" },
  { value: "ARBITRATION_AWARD_RECEIVED", label: "收到仲裁裁决书" },
];
const DL_CAT_CN: Record<string, string> = {
  APPEAL: "上诉期",
  RESPONSE: "答辩期",
  ENFORCEMENT: "申请执行",
  RETRIAL_APPLICATION: "申请再审",
  ARBITRATION_SET_ASIDE: "撤销仲裁",
  LIMITATION: "诉讼时效",
  CUSTOM: "自定义",
};

/** Whole-calendar-day diff (local time): 0 = due today, <0 = overdue (the first
 * calendar day after the due date), >0 = days remaining. Avoids the timezone /
 * fractional-instant bugs of comparing raw millisecond timestamps. */
const PRES_TYPE_CN: Record<string, string> = {
  PRE_LITIGATION: "诉前",
  IN_LITIGATION: "诉中",
  ENFORCEMENT: "执行",
};
const PROP_TYPE: { value: string; label: string }[] = [
  { value: "BANK_DEPOSIT", label: "银行存款" },
  { value: "REAL_ESTATE", label: "房产" },
  { value: "VEHICLE", label: "车辆" },
  { value: "EQUITY", label: "股权" },
  { value: "IP", label: "知识产权" },
  { value: "OTHER", label: "其他" },
];
const PROP_TYPE_CN: Record<string, string> = Object.fromEntries(
  PROP_TYPE.map((p) => [p.value, p.label]),
);
const PRES_STATUS_CN: Record<string, string> = {
  ACTIVE: "生效",
  RENEWED: "已续保",
  EXPIRED: "已到期",
  LIFTED: "已解除",
};

const NOTE_CHANNEL_CN: Record<string, string> = {
  PHONE: "电话",
  WECHAT: "微信",
  EMAIL: "邮件",
  MEETING: "会议",
  COURT: "法院",
  OTHER: "其他",
};

function dueDays(dueAt: string): number {
  const [y, m, d] = dueAt.slice(0, 10).split("-").map(Number);
  const due = new Date(y, (m ?? 1) - 1, d ?? 1);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

export function MatterDetail() {
  const { id = "" } = useParams();
  const [matter, setMatter] = useState<MatterDetailData | null>(null);
  const [deadlines, setDeadlines] = useState<DeadlineRow[]>([]);
  const [preservations, setPreservations] = useState<PreservationRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dlError, setDlError] = useState<string | null>(null);
  const [presError, setPresError] = useState<string | null>(null);
  const [presLoaded, setPresLoaded] = useState(false);
  const [presType, setPresType] = useState("");
  const [presProp, setPresProp] = useState("");
  const [presStart, setPresStart] = useState("");
  const [presAmount, setPresAmount] = useState("");
  const [presRespondent, setPresRespondent] = useState("");
  const [renewId, setRenewId] = useState<string | null>(null);
  const [renewDate, setRenewDate] = useState("");
  const [type, setType] = useState("");
  const [caseNumber, setCaseNumber] = useState("");
  const [dlProc, setDlProc] = useState("");
  const [dlEvent, setDlEvent] = useState("");
  const [dlDate, setDlDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [hearings, setHearings] = useState<HearingRow[]>([]);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [noteChannel, setNoteChannel] = useState("OTHER");
  const [noteWith, setNoteWith] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [hpProc, setHpProc] = useState("");
  const [hTitle, setHTitle] = useState("");
  const [hStarts, setHStarts] = useState("");
  const [hRoom, setHRoom] = useState("");
  const [hJudge, setHJudge] = useState("");
  const role = getRole();
  const canEdit = role === "ADMIN" || role === "PRINCIPAL_LAWYER" || role === "LAWYER";

  // Load on id change with a cancellation guard so a slower response from a
  // previous matter can't overwrite the current route; clear stale state first.
  useEffect(() => {
    let active = true;
    setMatter(null);
    setDeadlines([]);
    setError(null);
    setDlError(null);
    // Matter gates the page; deadlines load independently with a degraded card
    // so a deadlines failure can't blank the whole matter view.
    api
      .getMatter(id)
      .then((m) => {
        if (active) setMatter(m);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      });
    api
      .listDeadlines(id)
      .then((dl) => {
        if (active) setDeadlines(dl);
      })
      .catch((err) => {
        if (active) setDlError(err instanceof Error ? err.message : String(err));
      });
    setPresError(null);
    setPresLoaded(false);
    api
      .listPreservations(id)
      .then((p) => {
        if (active) {
          setPreservations(p);
          setPresLoaded(true);
        }
      })
      .catch((err) => {
        // Surface the failure — an empty card here could hide a lapsing freeze.
        if (active) setPresError(err instanceof Error ? err.message : String(err));
      });
    setTasks([]);
    setNotes([]);
    setHearings([]);
    api.listTasks(id).then((t) => {
      if (active) setTasks(t);
    }).catch(() => {});
    api.listNotes(id).then((n) => {
      if (active) setNotes(n);
    }).catch(() => {});
    api.listHearings(id).then((h) => {
      if (active) setHearings(h);
    }).catch(() => {});
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
    try {
      setDeadlines(await api.listDeadlines(id));
      setDlError(null);
    } catch (err) {
      setDlError(err instanceof Error ? err.message : String(err));
    }
    try {
      setPreservations(await api.listPreservations(id));
      setPresLoaded(true);
      setPresError(null);
    } catch (err) {
      setPresError(err instanceof Error ? err.message : String(err));
    }
    try {
      setTasks(await api.listTasks(id));
    } catch { /* ignore */ }
    try {
      setNotes(await api.listNotes(id));
    } catch { /* ignore */ }
    try {
      setHearings(await api.listHearings(id));
    } catch { /* ignore */ }
  }

  async function addTask(e: FormEvent) {
    e.preventDefault();
    if (!taskTitle) return;
    setBusy(true);
    setError(null);
    try {
      await api.addTask(id, { title: taskTitle, dueAt: taskDue || undefined });
      setTaskTitle("");
      setTaskDue("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function doCompleteTask(taskId: string) {
    setError(null);
    try {
      await api.completeTask(taskId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function addNote(e: FormEvent) {
    e.preventDefault();
    if (!noteContent) return;
    setBusy(true);
    setError(null);
    try {
      await api.addNote(id, {
        content: noteContent,
        channel: noteChannel,
        withWhom: noteWith || undefined,
      });
      setNoteContent("");
      setNoteWith("");
      setNoteChannel("OTHER");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function addHearing(e: FormEvent) {
    e.preventDefault();
    if (!hpProc || !hTitle || !hStarts) return;
    setBusy(true);
    setError(null);
    try {
      await api.addHearing(hpProc, {
        title: hTitle,
        startsAt: hStarts,
        room: hRoom || undefined,
        judge: hJudge || undefined,
      });
      setHpProc("");
      setHTitle("");
      setHStarts("");
      setHRoom("");
      setHJudge("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function createPres(e: FormEvent) {
    e.preventDefault();
    if (!presType || !presProp || !presStart) return;
    setBusy(true);
    setError(null);
    try {
      await api.createPreservation(id, {
        type: presType,
        propertyType: presProp,
        startDate: presStart,
        amount: presAmount || undefined,
        respondent: presRespondent || undefined,
      });
      setPresType("");
      setPresProp("");
      setPresStart("");
      setPresAmount("");
      setPresRespondent("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function doRenew(pid: string) {
    if (!renewDate) return;
    setError(null);
    try {
      await api.renewPreservation(pid, renewDate);
      setRenewId(null);
      setRenewDate("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function computeDl(e: FormEvent) {
    e.preventDefault();
    if (!dlProc || !dlEvent || !dlDate) return;
    setBusy(true);
    setError(null);
    try {
      await api.computeDeadlines(dlProc, { event: dlEvent, eventDate: dlDate });
      setDlEvent("");
      setDlDate("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function completeDl(deadlineId: string) {
    setError(null);
    try {
      await api.completeDeadline(deadlineId);
      await refresh();
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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="h-4 w-4 text-primary" strokeWidth={1.8} />
            期限
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {dlError && <p className="text-xs text-destructive">期限加载失败：{dlError}</p>}
          {deadlines.map((d) => {
            const days = dueDays(d.dueAt);
            const overdue = !d.completed && days < 0;
            const soon = !d.completed && days >= 0 && days <= 7;
            return (
              <div
                key={d.id}
                className="flex items-center justify-between rounded-sm border border-border px-3 py-2.5"
                title={d.basis ?? undefined}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="ll-chip tabular">{DL_CAT_CN[d.category] ?? d.category}</span>
                    <span className={`text-sm font-medium ${d.completed ? "text-muted-foreground line-through" : ""}`}>
                      {d.title}
                    </span>
                    {d.autoComputed && <Badge variant="secondary" className="text-[10px]">自动推算</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    截止 {d.dueAt.slice(0, 10)}
                    {!d.completed && (
                      <span className={overdue ? "ml-2 text-destructive" : soon ? "ml-2 text-status-orange" : "ml-2"}>
                        {overdue ? `已逾期 ${-days} 天` : `剩 ${days} 天`}
                      </span>
                    )}
                  </div>
                </div>
                {canEdit && !d.completed && (
                  <Button variant="ghost" size="sm" onClick={() => completeDl(d.id)}>
                    <Check className="mr-1 h-3.5 w-3.5" /> 完成
                  </Button>
                )}
              </div>
            );
          })}
          {deadlines.length === 0 && <p className="py-2 text-xs text-muted-foreground">尚无期限</p>}

          {canEdit && matter.procedures.some((p) => p.engagement === "ENGAGED") && (
            <form onSubmit={computeDl} className="flex flex-wrap items-end gap-3 pt-2">
              <div className="space-y-1.5">
                <Label>程序</Label>
                <Select value={dlProc} onValueChange={setDlProc}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="选择程序" />
                  </SelectTrigger>
                  <SelectContent>
                    {matter.procedures
                      .filter((p) => p.engagement === "ENGAGED")
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {PROC_CN[p.type] ?? p.type}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>事件</Label>
                <Select value={dlEvent} onValueChange={setDlEvent}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="选择事件" />
                  </SelectTrigger>
                  <SelectContent>
                    {DL_EVENTS.map((e) => (
                      <SelectItem key={e.value} value={e.value}>
                        {e.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>事件日期</Label>
                <Input type="date" value={dlDate} onChange={(e) => setDlDate(e.target.value)} className="w-40" />
              </div>
              <Button type="submit" disabled={busy || !dlProc || !dlEvent || !dlDate}>
                {busy ? "推算中…" : "推算期限"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Snowflake className="h-4 w-4 text-status-blue" strokeWidth={1.8} />
            财产保全
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {presError && (
            <p className="text-xs text-destructive">保全加载失败：{presError}（请重试，勿据此判断无保全）</p>
          )}
          {preservations.map((p) => {
            const active = p.status === "ACTIVE" || p.status === "RENEWED";
            const overdue = active && p.daysToExpiry < 0;
            const soon = active && p.daysToExpiry >= 0 && p.daysToExpiry <= 30;
            return (
              <div key={p.id} className="rounded-sm border border-border px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="ll-chip tabular">{PRES_TYPE_CN[p.type] ?? p.type}</span>
                      <span className="text-sm font-medium">{PROP_TYPE_CN[p.propertyType] ?? p.propertyType}</span>
                      {p.respondent && <span className="text-xs text-muted-foreground">{p.respondent}</span>}
                      <Badge variant="secondary" className="text-[10px]">{PRES_STATUS_CN[p.status] ?? p.status}</Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      到期 {p.expiryDate.slice(0, 10)}
                      {active && (
                        <span className={overdue ? "ml-2 text-destructive" : soon ? "ml-2 text-status-orange" : "ml-2"}>
                          {overdue ? `已逾期 ${-p.daysToExpiry} 天` : `剩 ${p.daysToExpiry} 天`}
                        </span>
                      )}
                    </div>
                  </div>
                  {canEdit && active && p.daysToExpiry >= 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setRenewId(renewId === p.id ? null : p.id);
                        setRenewDate("");
                      }}
                    >
                      续保
                    </Button>
                  )}
                </div>
                {renewId === p.id && (
                  <div className="mt-2 flex items-end gap-2">
                    <Input type="date" value={renewDate} onChange={(e) => setRenewDate(e.target.value)} className="w-40" />
                    <Button size="sm" disabled={!renewDate} onClick={() => doRenew(p.id)}>
                      确认续保
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
          {presLoaded && !presError && preservations.length === 0 && (
            <p className="py-2 text-xs text-muted-foreground">尚无保全</p>
          )}

          {canEdit && (
            <form onSubmit={createPres} className="flex flex-wrap items-end gap-3 pt-2">
              <div className="space-y-1.5">
                <Label>保全类型</Label>
                <Select value={presType} onValueChange={setPresType}>
                  <SelectTrigger className="w-28">
                    <SelectValue placeholder="选择" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PRES_TYPE_CN).map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>财产类型</Label>
                <Select value={presProp} onValueChange={setPresProp}>
                  <SelectTrigger className="w-32">
                    <SelectValue placeholder="选择" />
                  </SelectTrigger>
                  <SelectContent>
                    {PROP_TYPE.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>生效日</Label>
                <Input type="date" value={presStart} onChange={(e) => setPresStart(e.target.value)} className="w-36" />
              </div>
              <div className="space-y-1.5">
                <Label>被保全人（可选）</Label>
                <Input value={presRespondent} onChange={(e) => setPresRespondent(e.target.value)} className="w-36" />
              </div>
              <Button type="submit" disabled={busy || !presType || !presProp || !presStart}>
                {busy ? "添加中…" : "新增保全"}
              </Button>
            </form>
          )}
          <p className="pt-1 text-[11px] text-muted-foreground">
            到期期限按财产类型自动推算（存款 1 年 / 动产 2 年 / 不动产·股权·知识产权 3 年），可手工覆盖。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <ListChecks className="h-4 w-4 text-primary" strokeWidth={1.8} />
            任务
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {tasks.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between rounded-sm border border-border px-3 py-2.5"
            >
              <div className="min-w-0">
                <span className={`text-sm font-medium ${t.completed ? "text-muted-foreground line-through" : ""}`}>
                  {t.title}
                </span>
                {t.dueAt && (
                  <span className="ml-2 text-xs text-muted-foreground">截止 {t.dueAt.slice(0, 10)}</span>
                )}
              </div>
              {canEdit && !t.completed && (
                <Button variant="ghost" size="sm" onClick={() => doCompleteTask(t.id)}>
                  <Check className="mr-1 h-3.5 w-3.5" /> 完成
                </Button>
              )}
            </div>
          ))}
          {tasks.length === 0 && <p className="py-2 text-xs text-muted-foreground">尚无任务</p>}

          {canEdit && (
            <form onSubmit={addTask} className="flex flex-wrap items-end gap-3 pt-2">
              <div className="space-y-1.5">
                <Label>任务</Label>
                <Input
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  placeholder="任务标题"
                  className="w-52"
                />
              </div>
              <div className="space-y-1.5">
                <Label>截止（可选）</Label>
                <Input type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} className="w-40" />
              </div>
              <Button type="submit" disabled={busy || !taskTitle}>
                {busy ? "添加中…" : "添加任务"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <MessageSquare className="h-4 w-4 text-primary" strokeWidth={1.8} />
            沟通记录
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {notes.map((n) => (
            <div key={n.id} className="rounded-sm border border-border px-3 py-2.5">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px]">{NOTE_CHANNEL_CN[n.channel] ?? n.channel}</Badge>
                {n.withWhom && <span className="text-xs text-muted-foreground">{n.withWhom}</span>}
                <span className="text-xs text-muted-foreground">{n.occurredAt.slice(0, 10)}</span>
              </div>
              <div className="mt-0.5 text-sm">{n.content}</div>
            </div>
          ))}
          {notes.length === 0 && <p className="py-2 text-xs text-muted-foreground">尚无沟通记录</p>}

          {canEdit && (
            <form onSubmit={addNote} className="flex flex-wrap items-end gap-3 pt-2">
              <div className="space-y-1.5">
                <Label>方式</Label>
                <Select value={noteChannel} onValueChange={setNoteChannel}>
                  <SelectTrigger className="w-28">
                    <SelectValue placeholder="选择" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(NOTE_CHANNEL_CN).map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>对象（可选）</Label>
                <Input value={noteWith} onChange={(e) => setNoteWith(e.target.value)} className="w-36" />
              </div>
              <div className="space-y-1.5">
                <Label>内容</Label>
                <Input
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  placeholder="沟通内容"
                  className="w-52"
                />
              </div>
              <Button type="submit" disabled={busy || !noteContent}>
                {busy ? "添加中…" : "添加沟通"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Gavel className="h-4 w-4 text-primary" strokeWidth={1.8} />
            开庭
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {hearings.map((h) => (
            <div key={h.id} className="rounded-sm border border-border px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{h.title}</span>
                {h.room && <span className="text-xs text-muted-foreground">{h.room}</span>}
                {h.judge && <span className="text-xs text-muted-foreground">{h.judge}</span>}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {new Date(h.startsAt).toLocaleString("zh-CN")}
              </div>
            </div>
          ))}
          {hearings.length === 0 && <p className="py-2 text-xs text-muted-foreground">尚无开庭</p>}

          {canEdit && matter.procedures.some((p) => p.engagement === "ENGAGED") && (
            <form onSubmit={addHearing} className="flex flex-wrap items-end gap-3 pt-2">
              <div className="space-y-1.5">
                <Label>程序</Label>
                <Select value={hpProc} onValueChange={setHpProc}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="选择程序" />
                  </SelectTrigger>
                  <SelectContent>
                    {matter.procedures
                      .filter((p) => p.engagement === "ENGAGED")
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {PROC_CN[p.type] ?? p.type}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>庭审标题</Label>
                <Input value={hTitle} onChange={(e) => setHTitle(e.target.value)} className="w-44" />
              </div>
              <div className="space-y-1.5">
                <Label>开庭时间</Label>
                <Input type="datetime-local" value={hStarts} onChange={(e) => setHStarts(e.target.value)} className="w-52" />
              </div>
              <div className="space-y-1.5">
                <Label>法庭（可选）</Label>
                <Input value={hRoom} onChange={(e) => setHRoom(e.target.value)} className="w-32" />
              </div>
              <div className="space-y-1.5">
                <Label>法官（可选）</Label>
                <Input value={hJudge} onChange={(e) => setHJudge(e.target.value)} className="w-32" />
              </div>
              <Button type="submit" disabled={busy || !hpProc || !hTitle || !hStarts}>
                {busy ? "添加中…" : "添加开庭"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
