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

export const api = {
  login: (email: string, password: string) =>
    req<{ token: string; user: { role: string } }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
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
};
