import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, getRole, type TemplateRow } from "@/lib/api";
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
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const TEMPLATE_CATEGORY_CN: Record<string, string> = {
  INTAKE: "收案文书",
  RETAINER: "委托文书",
  LITIGATION: "诉讼文书",
  HEARING: "庭审文书",
  WORK_PRODUCT: "工作成果",
  ARCHIVE: "卷宗文书",
  CLOSING: "结案文书",
  BLANK: "空白文档",
};
const TEMPLATE_CATEGORIES = Object.keys(TEMPLATE_CATEGORY_CN);

const MATTER_CATEGORY_CN: Record<string, string> = {
  CIVIL_COMMERCIAL: "民商事",
  CRIMINAL: "刑事",
  ADMINISTRATIVE: "行政",
  NON_LITIGATION: "非诉",
  LEGAL_COUNSEL: "顾问",
  SPECIAL_PROJECT: "专项",
};

export function Templates() {
  const role = getRole();
  const allowed = role === "ADMIN" || role === "PRINCIPAL_LAWYER";

  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [varCount, setVarCount] = useState<number | null>(null);

  async function refresh() {
    try {
      setRows(await api.listTemplates());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  useEffect(() => {
    if (!allowed) return;
    void refresh();
  }, [allowed]);

  async function upload(e: FormEvent) {
    e.preventDefault();
    if (!file || !name || !category) return;
    setError(null);
    setVarCount(null);
    setBusy(true);
    try {
      const res = await api.uploadTemplate(file, {
        name,
        category,
        description: description || undefined,
        applicableCategories: [],
      });
      setVarCount(res.variables.length);
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setName("");
      setCategory("");
      setDescription("");
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

  if (!allowed) {
    return (
      <div className="space-y-5">
        <h1 className="text-base font-semibold tracking-tight">文书模板</h1>
        <div className="rounded-sm border border-destructive/30 bg-[#fde8e8] px-3 py-2 text-xs text-destructive">
          仅管理员 / 主任可管理文书模板
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-base font-semibold tracking-tight">文书模板</h1>
          <p className="text-xs text-muted-foreground">
            上传 .docx 模板，套用案件数据生成文书（DOMAIN-SPEC §5.5）
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
          <CardTitle className="text-sm font-semibold">上传模板</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={upload} className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label>模板文件</Label>
              <input
                ref={fileRef}
                type="file"
                accept=".docx"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                disabled={busy}
                className="block w-72 text-xs file:mr-2 file:rounded-sm file:border file:border-input file:bg-background file:px-2 file:py-1 file:text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tplName">名称</Label>
              <Input
                id="tplName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="模板名称"
                className="w-52"
              />
            </div>
            <div className="space-y-1.5">
              <Label>类别</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="选择类别" />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {TEMPLATE_CATEGORY_CN[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tplDesc">说明（可选）</Label>
              <Input
                id="tplDesc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="模板说明"
                className="w-52"
              />
            </div>
            <Button type="submit" disabled={busy || !file || !name || !category}>
              {busy ? "上传中…" : "上传模板"}
            </Button>
            {varCount !== null && (
              <span className="pb-1.5 text-xs text-primary">已识别 {varCount} 个变量</span>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>类别</TableHead>
              <TableHead className="text-right">变量数</TableHead>
              <TableHead>适用类别</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{TEMPLATE_CATEGORY_CN[t.category] ?? t.category}</Badge>
                </TableCell>
                <TableCell className="text-right tabular text-muted-foreground">
                  {t.variables.length}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {t.applicableCategories.length === 0
                    ? "全部"
                    : t.applicableCategories.map((c) => MATTER_CATEGORY_CN[c] ?? c).join("、")}
                </TableCell>
                <TableCell className="text-right">
                  {t.isBuiltIn ? (
                    <span className="text-xs text-muted-foreground">内置</span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => act(() => api.deleteTemplate(t.id))}
                    >
                      删除
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-xs text-muted-foreground">
                  暂无模板
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
