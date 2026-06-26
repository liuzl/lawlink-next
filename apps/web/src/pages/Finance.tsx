import { useEffect, useState, type FormEvent } from "react";
import {
  api,
  getRole,
  type FinanceOverview,
  type InvoiceRow,
  type MatterRow,
  type DocumentRow,
} from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
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

const MONTH_CN: Record<string, string> = {
  "3": "近3月",
  "6": "近6月",
  "12": "近12月",
};
const MONTH_OPTIONS = Object.keys(MONTH_CN);

const FEE_TYPE_CN: Record<string, string> = {
  RECEIVABLE: "应收",
  RECEIVED: "实收",
  REFUND: "退费",
  COST: "成本",
  COMMISSION: "分成",
};

const INVOICE_STATUS_CN: Record<string, string> = {
  PENDING: "待处理",
  APPROVED: "已批准待开具",
  ISSUED: "已开具",
  REJECTED: "已驳回",
};
const INVOICE_STATUS_VARIANT: Record<string, BadgeProps["variant"]> = {
  PENDING: "orange",
  APPROVED: "blue",
  ISSUED: "green",
  REJECTED: "secondary",
};
const INVOICE_TYPE_CN: Record<string, string> = {
  PLAIN: "普通发票",
  SPECIAL: "增值税专用发票",
};
const INVOICE_TYPES = Object.keys(INVOICE_TYPE_CN);
const INVOICE_ITEM_CN: Record<string, string> = {
  LAWYER_FEE: "律师服务费",
  CONSULTING_FEE: "法律咨询费",
  AGENCY_FEE: "代理费",
  OTHER: "其他法律服务",
};
const INVOICE_ITEMS = Object.keys(INVOICE_ITEM_CN);

function Kpi({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="ll-stat text-xl">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

export function Finance() {
  const role = getRole();
  const allowed = role === "ADMIN" || role === "PRINCIPAL_LAWYER" || role === "FINANCE";

  const [months, setMonths] = useState(6);
  const [data, setData] = useState<FinanceOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [matters, setMatters] = useState<MatterRow[]>([]);

  const [matterId, setMatterId] = useState("");
  const [matterDocs, setMatterDocs] = useState<DocumentRow[]>([]);
  const [evidenceDocId, setEvidenceDocId] = useState("");
  const [amount, setAmount] = useState("");
  const [invoiceType, setInvoiceType] = useState(INVOICE_TYPES[0]);
  const [invoiceItem, setInvoiceItem] = useState(INVOICE_ITEMS[0]);
  const [buyerName, setBuyerName] = useState("");
  const [buyerTaxNo, setBuyerTaxNo] = useState("");
  const [buyerAddress, setBuyerAddress] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [buyerBank, setBuyerBank] = useState("");
  const [buyerBankAccount, setBuyerBankAccount] = useState("");
  const [busy, setBusy] = useState(false);

  const [issuingId, setIssuingId] = useState<string | null>(null);
  const [issueDocs, setIssueDocs] = useState<DocumentRow[]>([]);
  const [issueNo, setIssueNo] = useState("");
  const [issueFileId, setIssueFileId] = useState("");

  useEffect(() => {
    if (!allowed) return;
    setError(null);
    api
      .getFinanceOverview(months)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [allowed, months]);

  useEffect(() => {
    if (!allowed) return;
    void refreshInvoices();
    api
      .listMatters()
      .then(setMatters)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [allowed]);

  async function refreshInvoices() {
    try {
      setInvoices(await api.listInvoices());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onMatterChange(id: string) {
    setMatterId(id);
    setEvidenceDocId("");
    try {
      setMatterDocs(await api.listDocuments(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function createInvoice(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.createInvoice({
        matterId,
        amount,
        invoiceType,
        invoiceItem,
        buyerName,
        evidenceDocIds: [evidenceDocId],
        ...(invoiceType === "SPECIAL"
          ? { buyerTaxNo, buyerAddress, buyerPhone, buyerBank, buyerBankAccount }
          : {}),
      });
      setMatterId("");
      setMatterDocs([]);
      setEvidenceDocId("");
      setAmount("");
      setInvoiceType(INVOICE_TYPES[0]);
      setInvoiceItem(INVOICE_ITEMS[0]);
      setBuyerName("");
      setBuyerTaxNo("");
      setBuyerAddress("");
      setBuyerPhone("");
      setBuyerBank("");
      setBuyerBankAccount("");
      await refreshInvoices();
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
      await refreshInvoices();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function startIssue(r: InvoiceRow) {
    setIssuingId(r.id);
    setIssueNo("");
    setIssueFileId("");
    setIssueDocs([]);
    if (!r.matterId) return;
    try {
      setIssueDocs(await api.listDocuments(r.matterId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const canSubmitInvoice = !busy && !!matterId && !!evidenceDocId && !!amount;

  if (!allowed) {
    return (
      <div className="space-y-5">
        <h1 className="text-base font-semibold tracking-tight">财务</h1>
        <div className="rounded-sm border border-destructive/30 bg-[#fde8e8] px-3 py-2 text-xs text-destructive">
          仅管理员 / 主任 / 财务可查看全所财务
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-base font-semibold tracking-tight">财务</h1>
          <p className="text-xs text-muted-foreground">
            全所财务台账{data ? ` · 近${data.months}月` : ""}
          </p>
        </div>
        <Select value={String(months)} onValueChange={(v) => setMonths(Number(v))}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="统计区间" />
          </SelectTrigger>
          <SelectContent>
            {MONTH_OPTIONS.map((m) => (
              <SelectItem key={m} value={m}>
                {MONTH_CN[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && (
        <div className="rounded-sm border border-destructive/30 bg-[#fde8e8] px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      {!data && !error && <p className="text-xs text-muted-foreground">加载中…</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="净实收" value={formatCurrency(Number(data.summary.netReceived))} />
            <Kpi label="实收" value={formatCurrency(Number(data.summary.received))} />
            <Kpi label="应收" value={formatCurrency(Number(data.summary.receivable))} />
            <Kpi label="成本" value={formatCurrency(Number(data.summary.cost))} />
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">月度净实收</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {data.monthly.map((m) => (
                <div
                  key={m.month}
                  className="flex items-center justify-between border-b border-border pb-1.5 last:border-0"
                >
                  <span className="text-muted-foreground">{m.month}</span>
                  <span className="ll-stat tabular">{formatCurrency(Number(m.netReceived))}</span>
                </div>
              ))}
              {data.monthly.length === 0 && (
                <p className="py-3 text-center text-xs text-muted-foreground">本期暂无数据</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">流水台账</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>时间</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>案件</TableHead>
                    <TableHead>对象</TableHead>
                    <TableHead className="text-right">金额</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.ledger.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="tabular">{row.occurredAt.slice(0, 10)}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{FEE_TYPE_CN[row.type] ?? row.type}</Badge>
                      </TableCell>
                      <TableCell className="font-mono">{row.internalCode}</TableCell>
                      <TableCell>{row.payerOrPayee ?? "—"}</TableCell>
                      <TableCell className="text-right tabular">
                        {formatCurrency(Number(row.amount))}
                      </TableCell>
                    </TableRow>
                  ))}
                  {data.ledger.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-xs text-muted-foreground">
                        本期暂无流水
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      <h2 className="text-sm font-semibold tracking-tight pt-2">开票</h2>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">申请开票</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={createInvoice}
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:items-end"
          >
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
              <Label>开票依据</Label>
              <Select value={evidenceDocId} onValueChange={setEvidenceDocId}>
                <SelectTrigger>
                  <SelectValue placeholder="选择开票依据" />
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
              <Label htmlFor="invoice-amount">金额</Label>
              <Input
                id="invoice-amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="金额"
                inputMode="decimal"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>发票类型</Label>
              <Select value={invoiceType} onValueChange={setInvoiceType}>
                <SelectTrigger>
                  <SelectValue placeholder="选择发票类型" />
                </SelectTrigger>
                <SelectContent>
                  {INVOICE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {INVOICE_TYPE_CN[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>开票名目</Label>
              <Select value={invoiceItem} onValueChange={setInvoiceItem}>
                <SelectTrigger>
                  <SelectValue placeholder="选择开票名目" />
                </SelectTrigger>
                <SelectContent>
                  {INVOICE_ITEMS.map((i) => (
                    <SelectItem key={i} value={i}>
                      {INVOICE_ITEM_CN[i]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invoice-buyer">抬头</Label>
              <Input
                id="invoice-buyer"
                value={buyerName}
                onChange={(e) => setBuyerName(e.target.value)}
                placeholder="抬头"
              />
            </div>
            {invoiceType === "SPECIAL" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="invoice-taxno">税号</Label>
                  <Input
                    id="invoice-taxno"
                    value={buyerTaxNo}
                    onChange={(e) => setBuyerTaxNo(e.target.value)}
                    placeholder="税号"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="invoice-address">地址</Label>
                  <Input
                    id="invoice-address"
                    value={buyerAddress}
                    onChange={(e) => setBuyerAddress(e.target.value)}
                    placeholder="地址"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="invoice-phone">电话</Label>
                  <Input
                    id="invoice-phone"
                    value={buyerPhone}
                    onChange={(e) => setBuyerPhone(e.target.value)}
                    placeholder="电话"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="invoice-bank">开户行</Label>
                  <Input
                    id="invoice-bank"
                    value={buyerBank}
                    onChange={(e) => setBuyerBank(e.target.value)}
                    placeholder="开户行"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="invoice-bankaccount">银行账号</Label>
                  <Input
                    id="invoice-bankaccount"
                    value={buyerBankAccount}
                    onChange={(e) => setBuyerBankAccount(e.target.value)}
                    placeholder="银行账号"
                  />
                </div>
              </>
            )}
            <Button type="submit" disabled={!canSubmitInvoice}>
              {busy ? "提交中…" : "申请开票"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>抬头/事由</TableHead>
              <TableHead className="text-right">金额</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>发票号</TableHead>
              <TableHead>申请时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.buyerName ?? "—"}</TableCell>
                <TableCell className="text-right tabular">
                  {formatCurrency(Number(r.amount))}
                </TableCell>
                <TableCell>
                  {r.invoiceType ? (
                    <Badge variant="secondary">
                      {INVOICE_TYPE_CN[r.invoiceType] ?? r.invoiceType}
                    </Badge>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={INVOICE_STATUS_VARIANT[r.status] ?? "secondary"}>
                    {INVOICE_STATUS_CN[r.status] ?? r.status}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono">{r.invoiceNo ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground tabular">
                  {r.requestedAt.slice(0, 10)}
                </TableCell>
                <TableCell className="text-right">
                  {r.status === "PENDING" ? (
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => act(() => api.approveInvoice(r.id))}
                      >
                        批准
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => act(() => api.rejectInvoice(r.id))}
                      >
                        驳回
                      </Button>
                    </div>
                  ) : r.status === "APPROVED" ? (
                    issuingId === r.id ? (
                      <div className="flex justify-end gap-2">
                        <Input
                          value={issueNo}
                          onChange={(e) => setIssueNo(e.target.value)}
                          placeholder="发票号"
                          className="w-32"
                        />
                        <Select value={issueFileId} onValueChange={setIssueFileId}>
                          <SelectTrigger className="w-44">
                            <SelectValue placeholder="选择电子发票" />
                          </SelectTrigger>
                          <SelectContent>
                            {issueDocs.map((d) => (
                              <SelectItem key={d.id} value={d.id}>
                                {d.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!issueNo || !issueFileId}
                          onClick={() =>
                            act(() =>
                              api.issueInvoice(r.id, {
                                invoiceNo: issueNo,
                                invoiceFileId: issueFileId,
                              }),
                            )
                          }
                        >
                          确认
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setIssuingId(null)}>
                          取消
                        </Button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => startIssue(r)}>
                          开具
                        </Button>
                      </div>
                    )
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {invoices.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-xs text-muted-foreground">
                  暂无开票申请
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
