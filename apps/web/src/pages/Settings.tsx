import { useEffect, useState, type FormEvent } from "react";
import { api, getRole, type SettingRow, type UserRow } from "@/lib/api";
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

const ROLE_CN: Record<string, string> = {
  ADMIN: "管理员",
  PRINCIPAL_LAWYER: "主任",
  LAWYER: "律师",
  ASSISTANT: "助理",
  FINANCE: "财务",
};

// Sentinel for the "未设置" option (shadcn SelectItem can't use an empty value).
const NONE = "__none__";

export function Settings() {
  const role = getRole();
  const isAdmin = role === "ADMIN";

  const [users, setUsers] = useState<UserRow[]>([]);
  const [legalRep, setLegalRep] = useState<string>(NONE);
  const [firmName, setFirmName] = useState("");
  const [firmAddress, setFirmAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    api
      .listUsers(true)
      .then(setUsers)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    api
      .listSettings()
      .then((rows: SettingRow[]) => {
        const get = (k: string) => rows.find((r) => r.key === k)?.value;
        const rep = get("firmLegalRepUserId");
        setLegalRep(typeof rep === "string" && rep ? rep : NONE);
        const name = get("firmName");
        setFirmName(typeof name === "string" ? name : "");
        const addr = get("firmAddress");
        setFirmAddress(typeof addr === "string" ? addr : "");
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [isAdmin]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      // Empty legalRep (NONE) clears the setting; the server validates a real id.
      await api.setSetting("firmLegalRepUserId", legalRep === NONE ? "" : legalRep);
      await api.setSetting("firmName", firmName);
      await api.setSetting("firmAddress", firmAddress);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) {
    return (
      <div className="space-y-5">
        <h1 className="text-base font-semibold tracking-tight">系统设置</h1>
        <div className="rounded-sm border border-destructive/30 bg-[#fde8e8] px-3 py-2 text-xs text-destructive">
          仅管理员可访问系统设置
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-base font-semibold tracking-tight">系统设置</h1>
        <p className="text-xs text-muted-foreground">律所级配置（仅管理员）</p>
      </div>

      {error && (
        <div className="rounded-sm border border-destructive/30 bg-[#fde8e8] px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      {saved && (
        <div className="rounded-sm border border-[#007b7f]/30 bg-[#e6f4f4] px-3 py-2 text-xs text-primary">
          已保存
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">律所信息</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="grid max-w-xl grid-cols-1 gap-4">
            <div className="space-y-1.5">
              <Label>法定代表人</Label>
              <Select value={legalRep} onValueChange={setLegalRep}>
                <SelectTrigger>
                  <SelectValue placeholder="选择法定代表人" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>未设置</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}（{ROLE_CN[u.role] ?? u.role}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                用于「法定代表人章」用印审批——仅此人可审批该章种类。
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="firmName">律所名称</Label>
              <Input id="firmName" value={firmName} onChange={(e) => setFirmName(e.target.value)} placeholder="如 示例律师事务所" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="firmAddress">律所地址</Label>
              <Input id="firmAddress" value={firmAddress} onChange={(e) => setFirmAddress(e.target.value)} placeholder="如 上海市浦东新区…" />
            </div>
            <div>
              <Button type="submit" disabled={busy}>
                {busy ? "保存中…" : "保存"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
