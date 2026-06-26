import { useEffect, useState, type FormEvent } from "react";
import {
  api,
  type SealRequestRow,
  type SealTypeRow,
  type MatterRow,
  type DocumentRow,
} from "@/lib/api";
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

const SEAL_STATUS_CN: Record<string, string> = {
  PENDING: "待审批",
  APPROVED: "已批准待盖章",
  STAMPED: "已盖章",
  REJECTED: "已驳回",
  CANCELLED: "已撤销",
};
const SEAL_STATUS_VARIANT: Record<string, BadgeProps["variant"]> = {
  PENDING: "orange",
  APPROVED: "blue",
  STAMPED: "green",
  REJECTED: "secondary",
  CANCELLED: "secondary",
};

const URGENCY_CN: Record<string, string> = {
  NORMAL: "普通",
  URGENT: "加急",
};
const URGENCIES = Object.keys(URGENCY_CN);

export function Seals() {
  const [rows, setRows] = useState<SealRequestRow[]>([]);
  const [sealTypes, setSealTypes] = useState<SealTypeRow[]>([]);
  const [matters, setMatters] = useState<MatterRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [matterId, setMatterId] = useState("");
  const [matterDocs, setMatterDocs] = useState<DocumentRow[]>([]);
  const [draftDocId, setDraftDocId] = useState("");
  const [sealType, setSealType] = useState("");
  const [purpose, setPurpose] = useState("");
  const [documentTitle, setDocumentTitle] = useState("");
  const [urgency, setUrgency] = useState(URGENCIES[0]);
  const [busy, setBusy] = useState(false);

  const [stampingId, setStampingId] = useState<string | null>(null);
  const [stampDocs, setStampDocs] = useState<DocumentRow[]>([]);
  const [stampDocId, setStampDocId] = useState("");

  const sealTypeLabel = (type: string) =>
    sealTypes.find((t) => t.type === type)?.label ?? type;

  async function refresh() {
    try {
      setRows(await api.listSeals());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  useEffect(() => {
    void refresh();
    api
      .getSealTypes()
      .then(setSealTypes)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    api
      .listMatters()
      .then(setMatters)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function onMatterChange(id: string) {
    setMatterId(id);
    setDraftDocId("");
    try {
      setMatterDocs(await api.listDocuments(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.createSeal({ sealType, matterId, draftDocId, purpose, documentTitle, urgency });
      setMatterId("");
      setMatterDocs([]);
      setDraftDocId("");
      setSealType("");
      setPurpose("");
      setDocumentTitle("");
      setUrgency(URGENCIES[0]);
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

  async function startStamp(r: SealRequestRow) {
    setStampingId(r.id);
    setStampDocId("");
    setStampDocs([]);
    if (!r.matterId) return;
    try {
      setStampDocs(await api.listDocuments(r.matterId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const canSubmit =
    !busy && !!matterId && !!draftDocId && !!sealType && !!purpose && !!documentTitle && !!urgency;

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-base font-semibold tracking-tight">用印审批</h1>
          <p className="text-xs text-muted-foreground">
            用章申请与审批：发起 → 审批 → 登记盖章（DOMAIN-SPEC §5.3）
          </p>
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
          <CardTitle className="text-sm font-semibold">新建用印申请</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:items-end">
            <div className="space-y-1.5">
              <Label>关联案件</Label>
              <Select value={matterId} onValueChange={onMatterChange}>
                <SelectTrigger>
                  <SelectValue placeholder="选择案件" />
                </SelectTrigger>
                <SelectContent>
                  {matters.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.internalCode} {m.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>待盖章稿</Label>
              <Select value={draftDocId} onValueChange={setDraftDocId}>
                <SelectTrigger>
                  <SelectValue placeholder="选择待盖章稿" />
                </SelectTrigger>
                <SelectContent>
                  {matterDocs.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>章种类</Label>
              <Select value={sealType} onValueChange={setSealType}>
                <SelectTrigger>
                  <SelectValue placeholder="选择章种类" />
                </SelectTrigger>
                <SelectContent>
                  {sealTypes.map((t) => (
                    <SelectItem key={t.type} value={t.type}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="purpose">用章事由</Label>
              <Input
                id="purpose"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="用章事由"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="documentTitle">文件标题</Label>
              <Input
                id="documentTitle"
                value={documentTitle}
                onChange={(e) => setDocumentTitle(e.target.value)}
                placeholder="文件标题"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>加急</Label>
              <Select value={urgency} onValueChange={setUrgency}>
                <SelectTrigger>
                  <SelectValue placeholder="选择" />
                </SelectTrigger>
                <SelectContent>
                  {URGENCIES.map((u) => (
                    <SelectItem key={u} value={u}>
                      {URGENCY_CN[u]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={!canSubmit}>
              {busy ? "提交中…" : "新建用印申请"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>编号</TableHead>
              <TableHead>章种类</TableHead>
              <TableHead>文件标题</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>申请时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.code}</TableCell>
                <TableCell className="text-muted-foreground">{sealTypeLabel(r.sealType)}</TableCell>
                <TableCell>{r.documentTitle}</TableCell>
                <TableCell>
                  <Badge variant={SEAL_STATUS_VARIANT[r.status] ?? "secondary"}>
                    {SEAL_STATUS_CN[r.status] ?? r.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground tabular">
                  {r.requestedAt.slice(0, 10)}
                </TableCell>
                <TableCell className="text-right">
                  {r.status === "PENDING" ? (
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => act(() => api.approveSeal(r.id))}
                      >
                        通过
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => act(() => api.rejectSeal(r.id))}
                      >
                        驳回
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => act(() => api.cancelSeal(r.id))}
                      >
                        撤销
                      </Button>
                    </div>
                  ) : r.status === "APPROVED" ? (
                    stampingId === r.id ? (
                      <div className="flex justify-end gap-2">
                        <Select value={stampDocId} onValueChange={setStampDocId}>
                          <SelectTrigger className="w-44">
                            <SelectValue placeholder="选择盖章后扫描件" />
                          </SelectTrigger>
                          <SelectContent>
                            {stampDocs.map((d) => (
                              <SelectItem key={d.id} value={d.id}>
                                {d.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!stampDocId}
                          onClick={() => act(() => api.stampSeal(r.id, stampDocId))}
                        >
                          确认
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setStampingId(null)}>
                          取消
                        </Button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => startStamp(r)}>
                          登记盖章
                        </Button>
                      </div>
                    )
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-xs text-muted-foreground">
                  暂无用印申请
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
