/** Tiny REST client over the Hono API. JWT kept in localStorage. */
const TOKEN_KEY = "lawlink_token";
const ROLE_KEY = "lawlink_role";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function getRole(): string | null {
  return localStorage.getItem(ROLE_KEY);
}
export function setSession(token: string | null, role?: string): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    if (role) localStorage.setItem(ROLE_KEY, role);
  } else {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
  }
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export interface IntakeRow {
  id: string;
  title: string;
  category: string;
  status: string;
  claimAmount: string | null;
  clientName: string;
  declinedReason: string | null;
  createdAt: string;
}

export interface ConflictHit {
  name: string;
  historyRole: string;
  matchedField: string;
  severity: string;
  matterId: string | null;
  intakeId: string | null;
}
export interface ConflictResult {
  topSeverity: string;
  hitCount: number;
  hits: ConflictHit[];
}

export interface MatterRow {
  id: string;
  internalCode: string;
  title: string;
  category: string;
  status: string;
  claimAmount: string | null;
  primaryClientName: string | null;
  ownerId: string;
  createdAt: string;
}
export interface ProcedureRow {
  id: string;
  type: string;
  engagement: string;
  order: number;
  caseNumber: string | null;
  handlingAgency: string | null;
  status: string;
}
export interface MatterPartyRow {
  id: string;
  role: string;
  name: string;
  idNumber: string | null;
}
export interface MatterDetail extends MatterRow {
  procedures: ProcedureRow[];
  parties: MatterPartyRow[];
}
export interface DeadlineRow {
  id: string;
  procedureId: string;
  category: string;
  title: string;
  dueAt: string;
  basis: string | null;
  autoComputed: boolean;
  completed: boolean;
}
export interface PreservationRow {
  id: string;
  type: string;
  propertyType: string;
  amount: string | null;
  respondent: string | null;
  startDate: string;
  durationDays: number;
  expiryDate: string;
  status: string;
  daysToExpiry: number;
}

export interface DashCounts {
  activeMatters: number;
  pendingIntakes: number;
  upcomingDeadlines: number;
  expiringPreservations: number;
}
export interface DashDeadline {
  id: string;
  title: string;
  category: string;
  dueAt: string;
  matterId: string;
  internalCode: string;
  matterTitle: string;
}
export interface DashPreservation {
  id: string;
  propertyType: string;
  respondent: string | null;
  expiryDate: string;
  status: string;
  matterId: string;
  internalCode: string;
  matterTitle: string;
}
export interface DashboardData {
  counts: DashCounts;
  upcomingDeadlines: DashDeadline[];
  expiringPreservations: DashPreservation[];
  horizonDays: number;
}
export interface AuditRow {
  id: string;
  userId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detailJson: string | null;
  ip: string | null;
  createdAt: string;
}
export interface FolderRow {
  id: string;
  matterId: string;
  name: string;
  orderIndex: number;
  isDefault: boolean;
}
export interface DocumentRow {
  id: string;
  matterId: string | null;
  folderId: string | null;
  name: string;
  category: string;
  sourceParty: string | null;
  status: string;
  version: number;
  tags: string[];
  uploadedById: string;
  createdAt: string;
}
export interface SealTypeRow {
  type: string;
  label: string;
  requiresLegalRep: boolean;
}
export interface SealRequestRow {
  id: string;
  code: string;
  sealType: string;
  matterId: string | null;
  purpose: string;
  documentTitle: string;
  pageCount: number;
  copies: number;
  urgency: string;
  draftDocId: string;
  stampedDocId: string | null;
  status: string;
  requestNote: string | null;
  approveNote: string | null;
  requestedById: string;
  requestedAt: string;
  createdAt: string;
}
export interface ParsedSms {
  smsType: string;
  caseNumbers: string[];
  court: string | null;
  hearingDate: string | null;
  filingDate: string | null;
  judgmentDate: string | null;
  appealDeadline: string | null;
  courtRoom: string | null;
  judge: string | null;
  clerk: string | null;
  phones: string[];
  amounts: string[];
  urls: string[];
  summary: string;
}
export interface SmsRow {
  id: string;
  rawText: string;
  receivedAt: string;
  smsType: string;
  matchedMatterId: string | null;
  matchedBy: string;
  generatedHearingId: string | null;
  generatedDeadlineId: string | null;
  processed: boolean;
  parsed: ParsedSms | null;
}
export interface ReportData {
  period: { start: string; end: string; label: string };
  portfolio: {
    total: number;
    active: number;
    archived: number;
    byCategory: { category: string; count: number }[];
    byStatus: { status: string; count: number }[];
  };
  activity: {
    newMatters: number;
    newIntakes: number;
    closedMatters: number;
    finance: {
      receivable: string;
      received: string;
      refund: string;
      cost: string;
      commission: string;
      netReceived: string;
    };
  };
  byLawyer: { userId: string; name: string; activeOwned: number; receivedInPeriod: string }[];
}
export interface NotificationRow {
  id: string;
  type: string;
  priority: string;
  title: string;
  content: string | null;
  href: string | null;
  refType: string | null;
  refId: string | null;
  read: boolean;
  createdAt: string;
}
export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
}
export interface SettingRow {
  key: string;
  value: unknown;
  updatedAt: string;
}
export interface ClientRow {
  id: string;
  name: string;
  type: string;
  idNumber: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
}
export interface ClientContact {
  id: string;
  name: string;
  title: string | null;
  phone: string | null;
  email: string | null;
  isPrimary: boolean;
}
export interface ClientDetail extends ClientRow {
  contacts: ClientContact[];
}
export interface TaskRow {
  id: string;
  title: string;
  dueAt: string | null;
  completed: boolean;
}
export interface NoteRow {
  id: string;
  channel: string;
  withWhom: string | null;
  occurredAt: string;
  content: string;
}
export interface HearingRow {
  id: string;
  title: string;
  startsAt: string;
  room: string | null;
  judge: string | null;
}
export interface FeeEntryRow {
  id: string;
  type: string;
  amount: string;
  occurredAt: string;
  payerOrPayee: string | null;
  note: string | null;
  parentFeeEntryId: string | null;
  beneficiaryUserId: string | null;
}
export interface CommissionPlanRow {
  id: string;
  userId: string;
  percent: string;
  label: string | null;
}
export interface FinanceData {
  entries: FeeEntryRow[];
  plan: CommissionPlanRow[];
  summary: {
    receivable: string;
    received: string;
    refund: string;
    cost: string;
    commission: string;
    netReceived: string;
  };
}

export const api = {
  login: (email: string, password: string) =>
    req<{ token: string; user: { role: string } }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  getDashboard: () => req<DashboardData>("/dashboard"),
  listClients: () => req<ClientRow[]>("/clients"),
  getClient: (id: string) => req<ClientDetail>(`/clients/${id}`),
  createClient: (body: Record<string, unknown>) =>
    req<{ id: string }>("/clients", { method: "POST", body: JSON.stringify(body) }),
  addContact: (id: string, body: Record<string, unknown>) =>
    req<{ id: string }>(`/clients/${id}/contacts`, { method: "POST", body: JSON.stringify(body) }),
  listIntakes: () => req<IntakeRow[]>("/intakes"),
  createIntake: (body: Record<string, unknown>) =>
    req<IntakeRow>("/intakes", { method: "POST", body: JSON.stringify(body) }),
  convertIntake: (id: string) =>
    req<{ internalCode: string }>(`/intakes/${id}/convert`, { method: "POST" }),
  declineIntake: (id: string, reason: string) =>
    req<{ status: string }>(`/intakes/${id}/decline`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  conflictCheck: (body: Record<string, unknown>) =>
    req<ConflictResult>("/conflicts/check", { method: "POST", body: JSON.stringify(body) }),
  listMatters: () => req<MatterRow[]>("/matters"),
  getMatter: (id: string) => req<MatterDetail>(`/matters/${id}`),
  addProcedure: (id: string, body: Record<string, unknown>) =>
    req<ProcedureRow>(`/matters/${id}/procedures`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listDeadlines: (matterId: string) => req<DeadlineRow[]>(`/matters/${matterId}/deadlines`),
  computeDeadlines: (procedureId: string, body: Record<string, unknown>) =>
    req<{ created: number }>(`/procedures/${procedureId}/deadlines/compute`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  completeDeadline: (id: string) =>
    req<{ completed: boolean }>(`/deadlines/${id}/complete`, { method: "POST" }),
  listPreservations: (matterId: string) => req<PreservationRow[]>(`/matters/${matterId}/preservations`),
  createPreservation: (matterId: string, body: Record<string, unknown>) =>
    req<{ expiryDate: string }>(`/matters/${matterId}/preservations`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  renewPreservation: (id: string, newExpiryDate: string) =>
    req<{ status: string }>(`/preservations/${id}/renew`, {
      method: "POST",
      body: JSON.stringify({ newExpiryDate }),
    }),
  listTasks: (matterId: string) => req<TaskRow[]>(`/matters/${matterId}/tasks`),
  addTask: (matterId: string, body: Record<string, unknown>) =>
    req<{ id: string }>(`/matters/${matterId}/tasks`, { method: "POST", body: JSON.stringify(body) }),
  completeTask: (id: string) => req<{ completed: boolean }>(`/tasks/${id}/complete`, { method: "POST" }),
  listNotes: (matterId: string) => req<NoteRow[]>(`/matters/${matterId}/notes`),
  addNote: (matterId: string, body: Record<string, unknown>) =>
    req<{ id: string }>(`/matters/${matterId}/notes`, { method: "POST", body: JSON.stringify(body) }),
  listHearings: (matterId: string) => req<HearingRow[]>(`/matters/${matterId}/hearings`),
  addHearing: (procedureId: string, body: Record<string, unknown>) =>
    req<{ id: string }>(`/procedures/${procedureId}/hearings`, { method: "POST", body: JSON.stringify(body) }),
  getFinance: (matterId: string) => req<FinanceData>(`/matters/${matterId}/finance`),
  addFeeEntry: (matterId: string, body: Record<string, unknown>) =>
    req<{ id: string }>(`/matters/${matterId}/fee-entries`, { method: "POST", body: JSON.stringify(body) }),
  deleteFeeEntry: (id: string) => req<{ deleted: boolean }>(`/fee-entries/${id}/delete`, { method: "POST" }),
  setCommissionPlan: (matterId: string, plans: { userId: string; percent: number; label?: string }[]) =>
    req<{ count: number }>(`/matters/${matterId}/commission-plan`, {
      method: "POST",
      body: JSON.stringify({ plans }),
    }),
  getAudit: (action?: string) =>
    req<AuditRow[]>(`/audit${action ? `?action=${encodeURIComponent(action)}` : ""}`),
  listFolders: (matterId: string) => req<FolderRow[]>(`/matters/${matterId}/folders`),
  createFolder: (matterId: string, name: string) =>
    req<{ id: string }>(`/matters/${matterId}/folders`, { method: "POST", body: JSON.stringify({ name }) }),
  renameFolder: (id: string, name: string) =>
    req<{ id: string }>(`/folders/${id}/rename`, { method: "POST", body: JSON.stringify({ name }) }),
  deleteFolder: (id: string) => req<{ deleted: boolean }>(`/folders/${id}/delete`, { method: "POST" }),
  listDocuments: (matterId: string) => req<DocumentRow[]>(`/matters/${matterId}/documents`),
  registerDocument: (matterId: string, body: Record<string, unknown>) =>
    req<{ id: string }>(`/matters/${matterId}/documents`, { method: "POST", body: JSON.stringify(body) }),
  moveDocument: (id: string, folderId: string | null) =>
    req<{ id: string }>(`/documents/${id}/move`, { method: "POST", body: JSON.stringify({ folderId }) }),
  submitDocument: (id: string) => req<{ status: string }>(`/documents/${id}/submit`, { method: "POST" }),
  approveDocument: (id: string) => req<{ status: string }>(`/documents/${id}/approve`, { method: "POST" }),
  rejectDocument: (id: string, reason?: string) =>
    req<{ status: string }>(`/documents/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),
  fileDocument: (id: string) => req<{ status: string }>(`/documents/${id}/file`, { method: "POST" }),
  deleteDocument: (id: string) => req<{ deleted: boolean }>(`/documents/${id}/delete`, { method: "POST" }),
  getSealTypes: () => req<SealTypeRow[]>("/seals/types"),
  listSeals: (status?: string) => req<SealRequestRow[]>(`/seals${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  createSeal: (body: Record<string, unknown>) =>
    req<{ id: string; code: string }>("/seals", { method: "POST", body: JSON.stringify(body) }),
  approveSeal: (id: string, approveNote?: string) =>
    req<{ status: string }>(`/seals/${id}/approve`, { method: "POST", body: JSON.stringify({ approveNote }) }),
  rejectSeal: (id: string, approveNote?: string) =>
    req<{ status: string }>(`/seals/${id}/reject`, { method: "POST", body: JSON.stringify({ approveNote }) }),
  stampSeal: (id: string, stampedDocId: string) =>
    req<{ status: string }>(`/seals/${id}/stamp`, { method: "POST", body: JSON.stringify({ stampedDocId }) }),
  cancelSeal: (id: string) => req<{ status: string }>(`/seals/${id}/cancel`, { method: "POST" }),
  ingestSms: (rawText: string) =>
    req<{ id: string; smsType: string; matchedMatterId: string | null; parsed: ParsedSms }>("/sms", {
      method: "POST",
      body: JSON.stringify({ rawText }),
    }),
  listSms: (processed?: boolean) =>
    req<SmsRow[]>(`/sms${processed === undefined ? "" : `?processed=${processed}`}`),
  getSms: (id: string) => req<SmsRow>(`/sms/${id}`),
  assignSms: (id: string, matterId: string) =>
    req<{ matchedBy: string }>(`/sms/${id}/assign`, { method: "POST", body: JSON.stringify({ matterId }) }),
  genHearingFromSms: (id: string) =>
    req<{ hearingId: string }>(`/sms/${id}/gen-hearing`, { method: "POST" }),
  genDeadlineFromSms: (id: string) =>
    req<{ deadlineId: string }>(`/sms/${id}/gen-deadline`, { method: "POST" }),
  markSmsProcessed: (id: string, processed = true) =>
    req<{ processed: boolean }>(`/sms/${id}/processed`, { method: "POST", body: JSON.stringify({ processed }) }),
  listNotifications: (unread = false) =>
    req<NotificationRow[]>(`/notifications${unread ? "?unread=true" : ""}`),
  unreadCount: () => req<{ unread: number }>("/notifications/unread-count"),
  markNotificationRead: (id: string) =>
    req<{ read: boolean }>(`/notifications/${id}/read`, { method: "POST" }),
  markAllNotificationsRead: () =>
    req<{ marked: number }>("/notifications/read-all", { method: "POST" }),
  getReport: (params: { preset?: string; start?: string; end?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.preset) q.set("preset", params.preset);
    if (params.start) q.set("start", params.start);
    if (params.end) q.set("end", params.end);
    const qs = q.toString();
    return req<ReportData>(`/reports${qs ? `?${qs}` : ""}`);
  },
  listUsers: (activeOnly = false) => req<UserRow[]>(`/users${activeOnly ? "?activeOnly=true" : ""}`),
  listSettings: () => req<SettingRow[]>("/settings"),
  setSetting: (key: string, value: unknown) =>
    req<{ key: string }>("/settings", { method: "POST", body: JSON.stringify({ key, value }) }),
  getArchiveChecklist: (matterId: string) =>
    req<{ required: string[]; status: string }>(`/matters/${matterId}/archive-checklist`),
  archiveMatter: (matterId: string, body: Record<string, unknown>) =>
    req<{ status: string; missingItems: string[]; forced: boolean }>(`/matters/${matterId}/archive`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
