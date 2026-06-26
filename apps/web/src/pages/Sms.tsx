import { useEffect, useState, type FormEvent } from "react";
import { api, type SmsRow, type MatterRow } from "@/lib/api";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SMS_TYPE_CN: Record<string, string> = {
  HEARING_NOTICE: "开庭通知",
  SERVICE_NOTICE: "送达通知",
  FEE_NOTICE: "缴费通知",
  MEDIATION: "调解通知",
  ENFORCEMENT: "执行通知",
  FILING_NOTICE: "立案通知",
  JUDGMENT_NOTICE: "判决通知",
  EVIDENCE_SUBMIT: "举证通知",
  OTHER: "其他",
};

const MATCH_CN: Record<string, string> = {
  AUTO_CASE_NUMBER: "按案号自动",
  MANUAL: "手动匹配",
  UNMATCHED: "未匹配",
};

function matchVariant(matchedBy: string): BadgeProps["variant"] {
  return matchedBy === "AUTO_CASE_NUMBER" || matchedBy === "MANUAL"
    ? "green"
    : "secondary";
}

export function Sms() {
  const [rows, setRows] = useState<SmsRow[]>([]);
  const [matters, setMatters] = useState<MatterRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rawText, setRawText] = useState("");
  const [busy, setBusy] = useState(false);
  const [assignChoice, setAssignChoice] = useState<Record<string, string>>({});

  async function refresh() {
    try {
      setRows(await api.listSms());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  useEffect(() => {
    void refresh();
    api
      .listMatters()
      .then(setMatters)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function ingest(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.ingestSms(rawText);
      setRawText("");
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

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-base font-semibold tracking-tight">法院短信</h1>
          <p className="text-xs text-muted-foreground">
            粘贴法院短信，本地解析并按案号匹配案件，一键生成开庭/期限（DOMAIN-SPEC §5.6）
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
          <CardTitle className="text-sm font-semibold">粘贴短信</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={ingest} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="rawText">短信内容</Label>
              <textarea
                id="rawText"
                className="flex min-h-[90px] w-full rounded-sm border border-input bg-background px-3 py-2 text-sm"
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder="粘贴法院短信原文"
              />
            </div>
            <Button type="submit" disabled={busy || !rawText}>
              {busy ? "解析中…" : "解析入库"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {rows.map((row) => {
          const parsed = row.parsed;
          const choice = assignChoice[row.id] ?? "";
          return (
            <div key={row.id} className="rounded-sm border border-border p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="blue">{SMS_TYPE_CN[row.smsType] ?? row.smsType}</Badge>
                <Badge variant={matchVariant(row.matchedBy)}>
                  {MATCH_CN[row.matchedBy] ?? row.matchedBy}
                </Badge>
                <span className="text-xs text-muted-foreground tabular">
                  {row.receivedAt.slice(0, 10)}
                </span>
                {row.processed && (
                  <span className="text-xs text-muted-foreground">已处理</span>
                )}
              </div>

              {parsed?.summary && <p className="text-sm">{parsed.summary}</p>}

              {parsed && (
                <div className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                  {parsed.caseNumbers.length > 0 && (
                    <span>案号：{parsed.caseNumbers.join(" ")}</span>
                  )}
                  {parsed.court && <span>法院：{parsed.court}</span>}
                  {parsed.hearingDate && <span>开庭：{parsed.hearingDate}</span>}
                  {parsed.judge && <span>法官：{parsed.judge}</span>}
                  {parsed.appealDeadline && <span>上诉期：{parsed.appealDeadline}</span>}
                </div>
              )}

              <p className="text-xs text-muted-foreground line-clamp-2">{row.rawText}</p>

              {!row.matchedMatterId ? (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Select
                    value={choice}
                    onValueChange={(v) =>
                      setAssignChoice((prev) => ({ ...prev, [row.id]: v }))
                    }
                  >
                    <SelectTrigger className="w-60">
                      <SelectValue placeholder="选择关联案件" />
                    </SelectTrigger>
                    <SelectContent>
                      {matters.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.internalCode} {m.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!choice}
                    onClick={() => act(() => api.assignSms(row.id, choice))}
                  >
                    匹配
                  </Button>
                </div>
              ) : !row.processed ? (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {parsed?.hearingDate && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => act(() => api.genHearingFromSms(row.id))}
                    >
                      生成开庭
                    </Button>
                  )}
                  {parsed?.appealDeadline && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => act(() => api.genDeadlineFromSms(row.id))}
                    >
                      生成期限
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => act(() => api.markSmsProcessed(row.id, true))}
                  >
                    标记已处理
                  </Button>
                </div>
              ) : (
                <div className="flex justify-end">
                  <span className="text-xs text-muted-foreground">—</span>
                </div>
              )}
            </div>
          );
        })}
        {rows.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-xs text-muted-foreground">
              暂无短信
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
