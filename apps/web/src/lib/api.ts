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
};
