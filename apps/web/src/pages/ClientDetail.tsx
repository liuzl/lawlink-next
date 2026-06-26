import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { api, getRole, type ClientDetail as ClientDetailData } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const TYPE_CN: Record<string, string> = {
  INDIVIDUAL: "自然人",
  COMPANY: "公司",
  ORGANIZATION: "组织",
};

export function ClientDetail() {
  const { id = "" } = useParams();
  const [client, setClient] = useState<ClientDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cName, setCName] = useState("");
  const [cTitle, setCTitle] = useState("");
  const [cPhone, setCPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const role = getRole();
  const canEdit = role === "ADMIN" || role === "PRINCIPAL_LAWYER" || role === "LAWYER";

  useEffect(() => {
    let active = true;
    setClient(null);
    setError(null);
    api
      .getClient(id)
      .then((c) => {
        if (active) setClient(c);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [id]);

  async function addContact(e: FormEvent) {
    e.preventDefault();
    if (!cName) return;
    setBusy(true);
    setError(null);
    try {
      await api.addContact(id, { name: cName, title: cTitle || undefined, phone: cPhone || undefined });
      setCName("");
      setCTitle("");
      setCPhone("");
      setClient(await api.getClient(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (error && !client) {
    return (
      <div className="space-y-4">
        <Link to="/clients" className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-3.5 w-3.5" /> 返回客户列表
        </Link>
        <div className="rounded-sm border border-destructive/30 bg-[#fde8e8] px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      </div>
    );
  }
  if (!client) return <div className="text-xs text-muted-foreground">加载中…</div>;

  return (
    <div className="space-y-5">
      <Link to="/clients" className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-3.5 w-3.5" /> 返回客户列表
      </Link>

      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-base font-semibold tracking-tight">{client.name}</h1>
        <Badge variant="secondary">{TYPE_CN[client.type] ?? client.type}</Badge>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">基本信息</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <div className="text-xs text-muted-foreground">证件号</div>
            <div className="font-mono">{client.idNumber ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">电话</div>
            <div>{client.phone ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">邮箱</div>
            <div>{client.email ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">地址</div>
            <div>{client.address ?? "—"}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">联系人</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {client.contacts.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-sm border border-border px-3 py-2 text-sm">
              <span className="font-medium">{c.name}</span>
              {c.title && <span className="text-xs text-muted-foreground">{c.title}</span>}
              {c.phone && <span className="ml-auto text-xs text-muted-foreground">{c.phone}</span>}
              {c.isPrimary && <Badge variant="secondary" className="text-[10px]">主联系人</Badge>}
            </div>
          ))}
          {client.contacts.length === 0 && <p className="py-2 text-xs text-muted-foreground">尚无联系人</p>}

          {canEdit && (
            <form onSubmit={addContact} className="flex flex-wrap items-end gap-3 pt-2">
              <div className="space-y-1.5">
                <Label>姓名</Label>
                <Input value={cName} onChange={(e) => setCName(e.target.value)} className="w-32" />
              </div>
              <div className="space-y-1.5">
                <Label>职位</Label>
                <Input value={cTitle} onChange={(e) => setCTitle(e.target.value)} className="w-32" />
              </div>
              <div className="space-y-1.5">
                <Label>电话</Label>
                <Input value={cPhone} onChange={(e) => setCPhone(e.target.value)} className="w-36" />
              </div>
              <Button type="submit" disabled={busy || !cName}>
                添加联系人
              </Button>
            </form>
          )}
          {error && client && <p className="text-xs text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
