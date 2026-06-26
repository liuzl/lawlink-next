import { useState, type FormEvent } from "react";
import { api, type ConflictResult } from "../lib/api.js";
import { Badge, Button, Card, Field, Input } from "../ui.js";

const ROLES = ["OPPOSING_PARTY", "CLIENT_PARTY", "THIRD_PARTY"];

export function Conflicts() {
  const [name, setName] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [candidateRole, setCandidateRole] = useState(ROLES[0]);
  const [result, setResult] = useState<ConflictResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    try {
      setResult(
        await api.conflictCheck({
          name: name || undefined,
          idNumber: idNumber || undefined,
          candidateRole,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-5">
      <h2 className="text-base font-semibold">利益冲突检索</h2>
      {error && <p className="text-xs text-destructive">{error}</p>}

      <Card className="p-4">
        <form onSubmit={run} className="grid grid-cols-1 gap-3 md:grid-cols-4 md:items-end">
          <Field label="名称">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="当事人名称" />
          </Field>
          <Field label="证件号（可选）">
            <Input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
          </Field>
          <Field label="本次角色">
            <select
              value={candidateRole}
              onChange={(e) => setCandidateRole(e.target.value)}
              className="w-full rounded border border-border bg-card px-3 py-1.5 text-sm"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <Button type="submit">检索</Button>
        </form>
      </Card>

      {result && (
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">最高等级</span>
            <Badge kind="severity" value={result.topSeverity} />
            <span className="text-muted-foreground">· {result.hitCount} 命中</span>
          </div>
          <div className="space-y-2">
            {result.hits.map((h, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded border border-hairline px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-medium">{h.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    历史角色 {h.historyRole} · 命中 {h.matchedField} ·{" "}
                    {h.matterId ? "案件" : "收案"}
                  </span>
                </div>
                <Badge kind="severity" value={h.severity} />
              </div>
            ))}
            {result.hits.length === 0 && (
              <p className="text-xs text-muted-foreground">无命中 — 未发现利益冲突。</p>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
