/**
 * Client (客户) use cases — firm-level party master data (DOMAIN-SPEC §M5).
 *
 * Implements ID-number masking (§9.4, a gap in the original): only management
 * (ADMIN / PRINCIPAL_LAWYER) sees the full idNumber; everyone else gets a
 * masked value. Masking happens in core, so every shell (API/CLI) is consistent.
 */
import { z } from "zod";
import { asc, eq, isNull, and } from "drizzle-orm";
import { clients, contacts } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps } from "../types.js";
import { isManagement, requireRole } from "../permissions.js";

/** Mask all but the first 3 and last 2 chars unless the caller is management. */
export function maskIdNumber(idNumber: string | null, auth: AuthContext): string | null {
  if (!idNumber) return null;
  if (isManagement(auth)) return idNumber;
  if (idNumber.length <= 5) return "*".repeat(idNumber.length);
  return idNumber.slice(0, 3) + "*".repeat(idNumber.length - 5) + idNumber.slice(-2);
}

export const CreateClientInput = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(["INDIVIDUAL", "COMPANY", "ORGANIZATION"]).default("INDIVIDUAL"),
  idNumber: z.string().min(1).max(64).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().email().max(120).optional(),
  address: z.string().max(300).optional(),
  source: z.string().max(120).optional(),
  notes: z.string().max(1000).optional(),
});

export async function createClient(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER");
  const input = CreateClientInput.parse(rawInput);
  const now = deps.clock.now();
  const id = deps.ids.newId();
  await deps.db.insert(clients).values({
    id,
    name: input.name,
    type: input.type,
    idNumber: input.idNumber ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    address: input.address ?? null,
    source: input.source ?? null,
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return { id, name: input.name, type: input.type };
}

export async function listClients(deps: Deps, auth: AuthContext) {
  const rows = await deps.db
    .select()
    .from(clients)
    .where(isNull(clients.deletedAt))
    .orderBy(asc(clients.name))
    .limit(200);
  return rows.map((r) => ({ ...r, idNumber: maskIdNumber(r.idNumber, auth) }));
}

export async function getClient(deps: Deps, auth: AuthContext, rawInput: { clientId: string }) {
  const [client] = await deps.db
    .select()
    .from(clients)
    .where(and(eq(clients.id, rawInput.clientId), isNull(clients.deletedAt)))
    .limit(1);
  if (!client) throw new DomainError("NOT_FOUND", "客户不存在");

  const clientContacts = await deps.db
    .select()
    .from(contacts)
    .where(eq(contacts.clientId, client.id))
    .orderBy(asc(contacts.createdAt));

  return { ...client, idNumber: maskIdNumber(client.idNumber, auth), contacts: clientContacts };
}

export const UpdateClientInput = z.object({
  clientId: z.string().min(1),
  phone: z.string().max(40).optional(),
  email: z.string().email().max(120).optional(),
  address: z.string().max(300).optional(),
  notes: z.string().max(1000).optional(),
});

export async function updateClient(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER");
  const input = UpdateClientInput.parse(rawInput);
  const [existing] = await deps.db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, input.clientId), isNull(clients.deletedAt)))
    .limit(1);
  if (!existing) throw new DomainError("NOT_FOUND", "客户不存在");

  await deps.db
    .update(clients)
    .set({
      phone: input.phone ?? null,
      email: input.email ?? null,
      address: input.address ?? null,
      notes: input.notes ?? null,
      updatedAt: deps.clock.now(),
    })
    .where(eq(clients.id, input.clientId));
  return { id: input.clientId, updated: true };
}

export const AddContactInput = z.object({
  clientId: z.string().min(1),
  name: z.string().min(1).max(120),
  title: z.string().max(80).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().email().max(120).optional(),
  isPrimary: z.coerce.boolean().default(false),
});

export async function addContact(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER");
  const input = AddContactInput.parse(rawInput);
  const [client] = await deps.db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, input.clientId), isNull(clients.deletedAt)))
    .limit(1);
  if (!client) throw new DomainError("NOT_FOUND", "客户不存在");

  const id = deps.ids.newId();
  await deps.db.insert(contacts).values({
    id,
    clientId: input.clientId,
    name: input.name,
    title: input.title ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    isPrimary: input.isPrimary,
    notes: null,
    createdAt: deps.clock.now(),
  });
  return { id, name: input.name };
}
