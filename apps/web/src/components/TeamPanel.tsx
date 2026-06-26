import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { api, type MatterMemberRow, type UserRow } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ROLE_CN: Record<string, string> = { LEAD: "主办", CO_LEAD: "协办", ASSISTANT: "助理" };
const ROLE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  LEAD: "default",
  CO_LEAD: "secondary",
  ASSISTANT: "outline",
};
const LAWYER_ROLES = new Set(["ADMIN", "PRINCIPAL_LAWYER", "LAWYER"]);

/** Matter team (承办团队) roster + (for the owner / management) an inline editor
 * that replaces the whole team in one save. */
export function TeamPanel({
  matterId,
  canManage,
  onOwnerChanged,
}: {
  matterId: string;
  canManage: boolean;
  onOwnerChanged?: () => void;
}) {
  const [members, setMembers] = useState<MatterMemberRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [editing, setEditing] = useState(false);
  const [ownerId, setOwnerId] = useState("");
  const [coLeads, setCoLeads] = useState<Set<string>>(new Set());
  const [assistants, setAssistants] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .listMatterMembers(matterId)
      .then(setMembers)
      .catch((e) => setError(e instanceof Error ? e.message : "加载团队失败"));
  }
  useEffect(load, [matterId]);

  async function startEdit() {
    setError(null);
    try {
      const us = await api.listUsers(true);
      setUsers(us);
      const lead = members.find((m) => m.role === "LEAD");
      setOwnerId(lead?.userId ?? us.find((u) => LAWYER_ROLES.has(u.role))?.id ?? "");
      setCoLeads(new Set(members.filter((m) => m.role === "CO_LEAD").map((m) => m.userId)));
      setAssistants(new Set(members.filter((m) => m.role === "ASSISTANT").map((m) => m.userId)));
      setEditing(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载用户失败");
    }
  }

  function toggle(set: Set<string>, setter: (s: Set<string>) => void, id: string) {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    setter(next);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const coLeadIds = [...coLeads].filter((id) => id !== ownerId);
      const assistantIds = [...assistants].filter((id) => id !== ownerId && !coLeads.has(id));
      await api.setMatterTeam(matterId, { ownerId, coLeadIds, assistantIds });
      setEditing(false);
      load();
      onOwnerChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  const lawyers = users.filter((u) => LAWYER_ROLES.has(u.role));
  const assistantCandidates = users.filter((u) => u.role !== "FINANCE");

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm font-semibold">
          <span className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" strokeWidth={1.8} />
            承办团队
          </span>
          {canManage && !editing && (
            <Button variant="outline" size="sm" onClick={startEdit}>
              调整团队
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {error && <p className="text-xs text-destructive">{error}</p>}

        {!editing && (
          <>
            {members.map((m) => (
              <div key={m.userId} className="flex items-center gap-2 rounded-sm border border-border px-3 py-2">
                <Badge variant={ROLE_VARIANT[m.role] ?? "outline"} className="text-[10px]">
                  {ROLE_CN[m.role] ?? m.role}
                </Badge>
                <span className="text-sm font-medium">{m.name}</span>
                {!m.active && <span className="text-xs text-muted-foreground">（已停用）</span>}
              </div>
            ))}
            {members.length === 0 && <p className="py-2 text-xs text-muted-foreground">尚未设置承办团队</p>}
          </>
        )}

        {editing && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>主办律师</Label>
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="选择主办" />
                </SelectTrigger>
                <SelectContent>
                  {lawyers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>协办律师</Label>
              <div className="flex flex-wrap gap-3">
                {lawyers
                  .filter((u) => u.id !== ownerId)
                  .map((u) => (
                    <label key={u.id} className="flex items-center gap-1.5 text-sm">
                      <Checkbox checked={coLeads.has(u.id)} onCheckedChange={() => toggle(coLeads, setCoLeads, u.id)} />
                      {u.name}
                    </label>
                  ))}
                {lawyers.filter((u) => u.id !== ownerId).length === 0 && (
                  <span className="text-xs text-muted-foreground">无其他律师</span>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>助理</Label>
              <div className="flex flex-wrap gap-3">
                {assistantCandidates
                  .filter((u) => u.id !== ownerId && !coLeads.has(u.id))
                  .map((u) => (
                    <label key={u.id} className="flex items-center gap-1.5 text-sm">
                      <Checkbox
                        checked={assistants.has(u.id)}
                        onCheckedChange={() => toggle(assistants, setAssistants, u.id)}
                      />
                      {u.name}
                    </label>
                  ))}
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button onClick={save} disabled={busy || !ownerId}>
                {busy ? "保存中…" : "保存团队"}
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
                取消
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
