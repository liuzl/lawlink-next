import { useEffect, useState, type FormEvent } from "react";
import { api, getRole, type IntakeRow } from "../lib/api.js";
import { Badge, Button, Card, Field, Input } from "../ui.js";

const CATEGORIES = [
  "CIVIL_COMMERCIAL",
  "CRIMINAL",
  "ADMINISTRATIVE",
  "NON_LITIGATION",
  "LEGAL_COUNSEL",
  "SPECIAL_PROJECT",
];

export function Intakes() {
  const [rows, setRows] = useState<IntakeRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");
  const [opposingName, setOpposingName] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [claimAmount, setClaimAmount] = useState("");
  const isManager = getRole() === "ADMIN" || getRole() === "PRINCIPAL_LAWYER";

  async function refresh() {
    try {
      setRows(await api.listIntakes());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createIntake({
        clientName,
        opposingName: opposingName || undefined,
        category,
        claimAmount: claimAmount || undefined,
      });
      setClientName("");
      setOpposingName("");
      setClaimAmount("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
        <h2 className="text-base font-semibold">收案登记</h2>
        <span className="text-xs text-muted-foreground">{rows.length} 条</span>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}

      <Card className="p-4">
        <form onSubmit={create} className="grid grid-cols-1 gap-3 md:grid-cols-5 md:items-end">
          <Field label="委托方">
            <Input value={clientName} onChange={(e) => setClientName(e.target.value)} required />
          </Field>
          <Field label="对方（可选）">
            <Input value={opposingName} onChange={(e) => setOpposingName(e.target.value)} />
          </Field>
          <Field label="案件类别">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded border border-border bg-card px-3 py-1.5 text-sm"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="标的额（可选）">
            <Input value={claimAmount} onChange={(e) => setClaimAmount(e.target.value)} placeholder="0.00" />
          </Field>
          <Button type="submit">新建收案</Button>
        </form>
      </Card>

      <Card>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b border-hairline">
              <th className="px-4 py-2 font-medium">标题</th>
              <th className="px-4 py-2 font-medium">类别</th>
              <th className="px-4 py-2 font-medium">状态</th>
              <th className="px-4 py-2 font-medium tabular">标的额</th>
              <th className="px-4 py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-hairline last:border-0">
                <td className="px-4 py-2">{r.title}</td>
                <td className="px-4 py-2 text-muted-foreground">{r.category}</td>
                <td className="px-4 py-2">
                  <Badge kind="status" value={r.status} />
                </td>
                <td className="px-4 py-2 tabular text-muted-foreground">{r.claimAmount ?? "—"}</td>
                <td className="px-4 py-2">
                  {isManager && (r.status === "INTAKE" || r.status === "PENDING_CONFIRMATION") ? (
                    <div className="flex gap-2">
                      <Button variant="ghost" onClick={() => act(() => api.convertIntake(r.id))}>
                        转正式案件
                      </Button>
                      <Button variant="ghost" onClick={() => act(() => api.declineIntake(r.id, "不接案"))}>
                        不接案
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-xs text-muted-foreground" colSpan={5}>
                  暂无收案
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
