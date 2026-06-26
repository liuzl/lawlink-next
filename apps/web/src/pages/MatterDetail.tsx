import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { Archive, Banknote, CalendarClock, Check, ChevronLeft, FolderClosed, Gavel, ListChecks, MessageSquare, Snowflake, Trash2 } from "lucide-react";
import {
  api,
  getRole,
  type DeadlineRow,
  type DocumentRow,
  type FinanceData,
  type FolderRow,
  type HearingRow,
  type MatterDetail as MatterDetailData,
  type NoteRow,
  type PreservationRow,
  type TaskRow,
  type TemplateRow,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TeamPanel } from "@/components/TeamPanel";

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

const FEE_TYPE_CN: Record<string, string> = {
  RECEIVABLE: "应收",
  RECEIVED: "实收",
  REFUND: "退款",
  COST: "成本",
  COMMISSION: "分成",
};
// Types selectable in the add-entry form (COMMISSION rows are auto-generated).
const FEE_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "RECEIVABLE", label: "应收" },
  { value: "RECEIVED", label: "实收" },
  { value: "REFUND", label: "退款" },
  { value: "COST", label: "成本" },
];

const NOTE_CHANNEL_CN: Record<string, string> = {
  PHONE: "电话",
  WECHAT: "微信",
  EMAIL: "邮件",
  MEETING: "会议",
  COURT: "法院",
  OTHER: "其他",
};
const DOC_CAT_CN: Record<string, string> = {
  EVIDENCE: "证据",
  PLEADING: "诉讼文书",
  PROCEDURE: "程序材料",
  JUDGMENT: "裁判文书",
  CONTRACT: "合同",
  OTHER: "其他",
};
const DOC_STATUS_CN: Record<string, string> = {
  DRAFT: "草稿",
  PENDING_REVIEW: "待审核",
  APPROVED: "已通过",
  FILED: "已入卷",
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
  const [finance, setFinance] = useState<FinanceData | null>(null);
  const [feeType, setFeeType] = useState("RECEIVED");
  const [feeAmount, setFeeAmount] = useState("");
  const [feePayer, setFeePayer] = useState("");
  const [archiveChecklist, setArchiveChecklist] = useState<string[] | null>(null);
  const [archiveChecked, setArchiveChecked] = useState<Record<string, boolean>>({});
  const [archiveSummary, setArchiveSummary] = useState("");
  const [archiveForceReason, setArchiveForceReason] = useState("");
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveLoadError, setArchiveLoadError] = useState<string | null>(null);
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [docName, setDocName] = useState("");
  const [docCategory, setDocCategory] = useState("OTHER");
  const [docFolderId, setDocFolderId] = useState("");
  const [folderName, setFolderName] = useState("");
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [genTemplateId, setGenTemplateId] = useState("");
  const role = getRole();
  const canEdit = role === "ADMIN" || role === "PRINCIPAL_LAWYER" || role === "LAWYER";
  const isManagement = role === "ADMIN" || role === "PRINCIPAL_LAWYER";
  // Archived matters are read-only for case-body edits (§6.6) — finance stays
  // editable, so finance controls keep using canEdit.
  const canModifyMatter = canEdit && matter?.status !== "ARCHIVED";

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
    setFolders([]);
    setDocuments([]);
    api.listFolders(id).then((f) => {
      if (active) setFolders(f);
    }).catch(() => {});
    api.listDocuments(id).then((d) => {
      if (active) setDocuments(d);
    }).catch(() => {});
    setFinance(null);
    api.getFinance(id).then((f) => {
      if (active) setFinance(f);
    }).catch(() => {});
    setArchiveChecklist(null);
    setArchiveError(null);
    setArchiveLoadError(null);
    api.getArchiveChecklist(id).then((c) => {
      if (active) setArchiveChecklist(c.required);
    }).catch((err) => {
      if (active) setArchiveLoadError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      active = false;
    };
  }, [id]);

  // Load templates applicable to this matter's category for the 套用模板 control.
  useEffect(() => {
    if (matter) api.listTemplates(matter.category).then(setTemplates).catch(() => {});
  }, [matter?.category]);

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
    try {
      setFolders(await api.listFolders(id));
    } catch { /* ignore */ }
    try {
      setDocuments(await api.listDocuments(id));
    } catch { /* ignore */ }
    try {
      setFinance(await api.getFinance(id));
    } catch { /* ignore */ }
    try {
      setArchiveChecklist((await api.getArchiveChecklist(id)).required);
      setArchiveLoadError(null);
    } catch (err) {
      setArchiveLoadError(err instanceof Error ? err.message : String(err));
    }
  }

  async function doArchive() {
    if (!archiveSummary) return;
    setBusy(true);
    setArchiveError(null);
    try {
      await api.archiveMatter(id, {
        summary: archiveSummary,
        checklist: archiveChecked,
        forceReason: archiveForceReason || undefined,
      });
      setArchiveSummary("");
      setArchiveForceReason("");
      setArchiveChecked({});
      await refresh();
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
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
        // Convert the offset-less datetime-local value to a real UTC instant
        // based on the user's browser timezone (not the API host's).
        startsAt: new Date(hStarts).toISOString(),
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

  async function addFee(e: FormEvent) {
    e.preventDefault();
    if (!feeAmount) return;
    setBusy(true);
    setError(null);
    try {
      await api.addFeeEntry(id, {
        type: feeType,
        amount: feeAmount,
        payerOrPayee: feePayer || undefined,
      });
      setFeeType("RECEIVED");
      setFeeAmount("");
      setFeePayer("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteFee(feeId: string) {
    setError(null);
    try {
      await api.deleteFeeEntry(feeId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function addFolder(e: FormEvent) {
    e.preventDefault();
    if (!folderName) return;
    setBusy(true);
    setError(null);
    try {
      await api.createFolder(id, folderName);
      setFolderName("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function registerDoc(e: FormEvent) {
    e.preventDefault();
    if (!docName) return;
    setBusy(true);
    setError(null);
    try {
      await api.registerDocument(id, {
        name: docName,
        category: docCategory,
        folderId: docFolderId || undefined,
      });
      setDocName("");
      setDocCategory("OTHER");
      setDocFolderId("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function genFromTemplate() {
    if (!genTemplateId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.generateFromTemplate(genTemplateId, {
        matterId: id,
        folderId: docFolderId || undefined,
      });
      await refresh();
      setGenTemplateId("");
      await api.downloadDocument(res.documentId, res.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function uploadDocFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await api.uploadDocument(id, file, { category: docCategory, folderId: docFolderId || undefined });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  /** Run a document lifecycle action then refresh; surface its error inline. */
  async function docAction(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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

      <TeamPanel matterId={matter.id} canManage={canEdit} onOwnerChanged={() => id && api.getMatter(id).then(setMatter)} />

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

          {canModifyMatter && (
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
                {canModifyMatter && !d.completed && (
                  <Button variant="ghost" size="sm" onClick={() => completeDl(d.id)}>
                    <Check className="mr-1 h-3.5 w-3.5" /> 完成
                  </Button>
                )}
              </div>
            );
          })}
          {deadlines.length === 0 && <p className="py-2 text-xs text-muted-foreground">尚无期限</p>}

          {canModifyMatter && matter.procedures.some((p) => p.engagement === "ENGAGED") && (
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
                  {canModifyMatter && active && p.daysToExpiry >= 0 && (
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

          {canModifyMatter && (
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
              {canModifyMatter && !t.completed && (
                <Button variant="ghost" size="sm" onClick={() => doCompleteTask(t.id)}>
                  <Check className="mr-1 h-3.5 w-3.5" /> 完成
                </Button>
              )}
            </div>
          ))}
          {tasks.length === 0 && <p className="py-2 text-xs text-muted-foreground">尚无任务</p>}

          {canModifyMatter && (
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

          {canModifyMatter && (
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

          {canModifyMatter && matter.procedures.some((p) => p.engagement === "ENGAGED") && (
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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <FolderClosed className="h-4 w-4 text-primary" strokeWidth={1.8} />
            卷宗 / 材料
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Group documents by folder; the trailing "未归卷" group holds both
              unfiled docs AND any doc whose folderId no longer resolves to a
              current folder (e.g. its folder was deleted) — so a material can
              never silently disappear from the matter view. */}
          {[...folders, { id: "", name: "未归卷", isDefault: false } as FolderRow].map((f) => {
            const folderIds = new Set(folders.map((x) => x.id));
            const docs =
              f.id === ""
                ? documents.filter((d) => !d.folderId || !folderIds.has(d.folderId))
                : documents.filter((d) => d.folderId === f.id);
            if (f.id === "" && docs.length === 0) return null;
            return (
              <div key={f.id || "__loose"} className="rounded-sm border border-border">
                <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-1.5">
                  <span className="flex items-center gap-1.5 text-xs font-medium">
                    {f.name}
                    {f.isDefault && <Badge variant="secondary" className="text-[10px]">预置</Badge>}
                    <span className="text-muted-foreground">({docs.length})</span>
                  </span>
                  {canModifyMatter && f.id !== "" && !f.isDefault && docs.length === 0 && (
                    <Button variant="ghost" size="sm" onClick={() => docAction(() => api.deleteFolder(f.id))}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                <div className="divide-y divide-border">
                  {docs.map((d) => (
                    <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm">{d.name}</span>
                        <Badge variant="secondary" className="text-[10px]">{DOC_CAT_CN[d.category] ?? d.category}</Badge>
                        <Badge variant="outline" className="text-[10px]">{DOC_STATUS_CN[d.status] ?? d.status}</Badge>
                      </div>
                      <div className="flex items-center gap-1">
                        {d.size != null && (
                          <Button variant="ghost" size="sm" onClick={() => docAction(() => api.downloadDocument(d.id, d.name))}>
                            下载
                          </Button>
                        )}
                      {canModifyMatter && (
                        <div className="flex items-center gap-1">
                          {d.status === "DRAFT" && (
                            <Button variant="ghost" size="sm" onClick={() => docAction(() => api.submitDocument(d.id))}>
                              提交审核
                            </Button>
                          )}
                          {d.status === "PENDING_REVIEW" && isManagement && (
                            <>
                              <Button variant="ghost" size="sm" onClick={() => docAction(() => api.approveDocument(d.id))}>
                                通过
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => docAction(() => api.rejectDocument(d.id))}>
                                退回
                              </Button>
                            </>
                          )}
                          {d.status === "APPROVED" && (
                            <Button variant="ghost" size="sm" onClick={() => docAction(() => api.fileDocument(d.id))}>
                              入卷
                            </Button>
                          )}
                          <Select
                            value={d.folderId ?? "__root__"}
                            onValueChange={(v) => docAction(() => api.moveDocument(d.id, v === "__root__" ? null : v))}
                          >
                            <SelectTrigger className="h-7 w-24 text-xs">
                              <SelectValue placeholder="移动" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__root__">未归卷</SelectItem>
                              {folders.map((fo) => (
                                <SelectItem key={fo.id} value={fo.id}>
                                  {fo.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button variant="ghost" size="sm" onClick={() => docAction(() => api.deleteDocument(d.id))}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                      </div>
                    </div>
                  ))}
                  {docs.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">（空）</p>}
                </div>
              </div>
            );
          })}
          {folders.length === 0 && documents.length === 0 && (
            <p className="py-2 text-xs text-muted-foreground">尚无卷宗或材料</p>
          )}

          {canModifyMatter && (
            <div className="space-y-3 pt-1">
              <form onSubmit={registerDoc} className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <Label>材料名称</Label>
                  <Input value={docName} onChange={(e) => setDocName(e.target.value)} placeholder="如 借款合同.pdf" className="w-52" />
                </div>
                <div className="space-y-1.5">
                  <Label>分类</Label>
                  <Select value={docCategory} onValueChange={setDocCategory}>
                    <SelectTrigger className="w-28">
                      <SelectValue placeholder="选择" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(DOC_CAT_CN).map(([v, l]) => (
                        <SelectItem key={v} value={v}>
                          {l}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>卷宗（可选）</Label>
                  <Select value={docFolderId} onValueChange={setDocFolderId}>
                    <SelectTrigger className="w-32">
                      <SelectValue placeholder="未归卷" />
                    </SelectTrigger>
                    <SelectContent>
                      {folders.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" disabled={busy || !docName}>
                  {busy ? "登记中…" : "登记材料"}
                </Button>
              </form>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <Label>上传文件</Label>
                  <input
                    type="file"
                    onChange={uploadDocFile}
                    disabled={busy}
                    className="block w-72 text-xs file:mr-2 file:rounded-sm file:border file:border-input file:bg-background file:px-2 file:py-1 file:text-xs"
                  />
                </div>
                <span className="pb-1.5 text-[11px] text-muted-foreground">按上方所选分类 / 卷宗归档</span>
              </div>
              <form onSubmit={addFolder} className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <Label>新建卷宗</Label>
                  <Input value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder="卷宗名称" className="w-52" />
                </div>
                <Button type="submit" variant="outline" disabled={busy || !folderName}>
                  添加卷宗
                </Button>
              </form>
              {templates.length > 0 && (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1.5">
                    <Label>套用模板</Label>
                    <Select value={genTemplateId} onValueChange={setGenTemplateId}>
                      <SelectTrigger className="w-52">
                        <SelectValue placeholder="选择模板" />
                      </SelectTrigger>
                      <SelectContent>
                        {templates.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="button" onClick={genFromTemplate} disabled={busy || !genTemplateId}>
                    {busy ? "生成中…" : "生成"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Banknote className="h-4 w-4 text-primary" strokeWidth={1.8} />
            财务
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {finance && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {([
                  { label: "应收", value: finance.summary.receivable },
                  { label: "实收", value: finance.summary.received },
                  { label: "退款", value: finance.summary.refund },
                  { label: "成本", value: finance.summary.cost },
                  { label: "分成", value: finance.summary.commission },
                  { label: "净实收", value: finance.summary.netReceived },
                ] as const).map((s) => (
                  <div key={s.label} className="rounded-sm border border-border px-3 py-2">
                    <div className="text-[11px] text-muted-foreground">{s.label}</div>
                    <div className="ll-stat text-sm">¥{s.value}</div>
                  </div>
                ))}
              </div>

              {finance.plan.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">分成方案</span>
                  {finance.plan.map((p) => (
                    <span key={p.id} className="ll-chip">
                      {p.label || p.userId.slice(0, 8)} {p.percent}%
                    </span>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                {finance.entries.map((entry) => {
                  const isCommission = entry.type === "COMMISSION";
                  const muted = isCommission || entry.type === "REFUND" || entry.amount.startsWith("-");
                  return (
                    <div
                      key={entry.id}
                      className={`flex items-center justify-between rounded-sm border border-border px-3 py-2.5 ${isCommission ? "ml-4" : ""}`}
                    >
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="text-[10px]">{FEE_TYPE_CN[entry.type] ?? entry.type}</Badge>
                        {isCommission && <Badge variant="secondary" className="text-[10px]">自动分成</Badge>}
                        <span className={`ll-stat text-sm ${muted ? "text-destructive" : ""}`}>¥{entry.amount}</span>
                        <span className="text-xs text-muted-foreground">{entry.occurredAt.slice(0, 10)}</span>
                        {entry.payerOrPayee && <span className="text-xs text-muted-foreground">{entry.payerOrPayee}</span>}
                        {entry.note && <span className="text-xs text-muted-foreground">{entry.note}</span>}
                      </div>
                      {!isCommission && canEdit && (
                        <Button variant="ghost" size="sm" onClick={() => deleteFee(entry.id)}>
                          删除
                        </Button>
                      )}
                    </div>
                  );
                })}
                {finance.entries.length === 0 && (
                  <p className="py-2 text-xs text-muted-foreground">尚无财务记录</p>
                )}
              </div>

              {canEdit && (
                <form onSubmit={addFee} className="flex flex-wrap items-end gap-3 pt-2">
                  <div className="space-y-1.5">
                    <Label>类型</Label>
                    <Select value={feeType} onValueChange={setFeeType}>
                      <SelectTrigger className="w-28">
                        <SelectValue placeholder="选择" />
                      </SelectTrigger>
                      <SelectContent>
                        {FEE_TYPE_OPTIONS.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>金额</Label>
                    <Input
                      value={feeAmount}
                      onChange={(e) => setFeeAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-32"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>付款方/收款方（可选）</Label>
                    <Input value={feePayer} onChange={(e) => setFeePayer(e.target.value)} className="w-40" />
                  </div>
                  <Button type="submit" disabled={busy || !feeAmount}>
                    {busy ? "记账中…" : "记一笔"}
                  </Button>
                </form>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Archive className="h-4 w-4 text-primary" strokeWidth={1.8} />
            归档
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {matter.status === "ARCHIVED" ? (
            <div className="flex items-center gap-2">
              <Badge variant="secondary">已归档</Badge>
              <span className="text-xs text-muted-foreground">案件已归档，处于只读状态。</span>
            </div>
          ) : canEdit && archiveChecklist ? (
            <>
              <div className="space-y-2">
                <Label>结案完整性核对</Label>
                {archiveChecklist.length === 0 && (
                  <p className="py-1 text-xs text-muted-foreground">无核对项</p>
                )}
                {archiveChecklist.map((item) => (
                  <label key={item} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={!!archiveChecked[item]}
                      onCheckedChange={(v) =>
                        setArchiveChecked((prev) => ({ ...prev, [item]: v === true }))
                      }
                    />
                    {item}
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <Label>结案小结</Label>
                  <Input
                    value={archiveSummary}
                    onChange={(e) => setArchiveSummary(e.target.value)}
                    placeholder="结案小结"
                    className="w-72"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>强制归档理由（仅当核对项缺失时需要）</Label>
                  <Input
                    value={archiveForceReason}
                    onChange={(e) => setArchiveForceReason(e.target.value)}
                    placeholder="可选"
                    className="w-72"
                  />
                </div>
                <Button onClick={doArchive} disabled={busy || !archiveSummary}>
                  {busy ? "归档中…" : "归档"}
                </Button>
              </div>
              {archiveError && <p className="text-xs text-destructive">{archiveError}</p>}
            </>
          ) : canEdit && archiveLoadError ? (
            <p className="text-xs text-destructive">
              归档清单加载失败：{archiveLoadError}
              <button
                type="button"
                className="ml-2 underline"
                onClick={async () => {
                  setArchiveLoadError(null);
                  try {
                    setArchiveChecklist((await api.getArchiveChecklist(id)).required);
                  } catch (err) {
                    setArchiveLoadError(err instanceof Error ? err.message : String(err));
                  }
                }}
              >
                重试
              </button>
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
