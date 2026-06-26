/**
 * 通知中心 — per-user in-app notification feed (DOMAIN-SPEC §M-notifications).
 *
 * Generation is BEST-EFFORT: enqueue() swallows its own errors so a failed
 * notification never breaks the business op that triggered it (same contract as
 * the audit sink). Reads are strictly own-user (a notification belongs to one
 * user and only that user can see/clear it).
 */
import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { notifications } from "@lawlink/db";
import {
  DomainError,
  type AuthContext,
  type Deps,
  type NotificationPriority,
  type NotificationType,
} from "../types.js";

export interface NotificationInput {
  userId: string;
  type: NotificationType;
  priority?: NotificationPriority;
  title: string;
  content?: string;
  href?: string;
  refType?: string;
  refId?: string;
}

/** Enqueue one notification (best-effort). Never throws. */
export async function enqueueNotification(deps: Deps, input: NotificationInput): Promise<void> {
  try {
    await deps.db.insert(notifications).values({
      id: deps.ids.newId(),
      userId: input.userId,
      type: input.type,
      priority: input.priority ?? "NORMAL",
      title: input.title,
      content: input.content ?? null,
      href: input.href ?? null,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      read: false,
      readAt: null,
      createdAt: deps.clock.now(),
    });
  } catch (err) {
    // Best-effort: a notification failure must not break the triggering op.
    console.error(
      JSON.stringify({
        level: "error",
        event: "notification.enqueue.failed",
        type: input.type,
        userId: input.userId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/** Fan a notification out to several recipients, de-duplicated. */
export async function enqueueMany(
  deps: Deps,
  userIds: string[],
  input: Omit<NotificationInput, "userId">,
): Promise<void> {
  for (const userId of [...new Set(userIds)]) {
    await enqueueNotification(deps, { ...input, userId });
  }
}

// ── reads (own user only) ─────────────────────────────────────────────────────
export const ListNotificationsInput = z.object({
  unreadOnly: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).catch(50),
});

export async function listNotifications(deps: Deps, auth: AuthContext, rawInput?: unknown) {
  const input = ListNotificationsInput.parse(rawInput ?? {});
  const where = input.unreadOnly
    ? and(eq(notifications.userId, auth.userId), eq(notifications.read, false))
    : eq(notifications.userId, auth.userId);
  return await deps.db
    .select()
    .from(notifications)
    .where(where)
    .orderBy(desc(notifications.createdAt))
    .limit(input.limit);
}

export async function unreadNotificationCount(deps: Deps, auth: AuthContext) {
  const [{ count }] = await deps.db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.userId, auth.userId), eq(notifications.read, false)));
  return { unread: Number(count) };
}

export const MarkReadInput = z.object({ notificationId: z.string().min(1) });

/** Mark one notification read. Guarded on userId so a caller can only clear
 * their own (the id alone is not enough). */
export async function markNotificationRead(deps: Deps, auth: AuthContext, rawInput: unknown) {
  const { notificationId } = MarkReadInput.parse(rawInput);
  const updated = await deps.db
    .update(notifications)
    .set({ read: true, readAt: deps.clock.now() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, auth.userId)))
    .returning({ id: notifications.id });
  if (updated.length === 0) throw new DomainError("NOT_FOUND", "通知不存在");
  return { id: notificationId, read: true };
}

/** Mark all of the caller's unread notifications read. */
export async function markAllNotificationsRead(deps: Deps, auth: AuthContext) {
  const updated = await deps.db
    .update(notifications)
    .set({ read: true, readAt: deps.clock.now() })
    .where(and(eq(notifications.userId, auth.userId), eq(notifications.read, false)))
    .returning({ id: notifications.id });
  return { marked: updated.length };
}

/** Optionally mark a batch read (e.g. the ones currently shown). Own-user only. */
export const MarkBatchInput = z.object({ ids: z.array(z.string().min(1)).max(100) });
export async function markNotificationsRead(deps: Deps, auth: AuthContext, rawInput: unknown) {
  const { ids } = MarkBatchInput.parse(rawInput);
  if (ids.length === 0) return { marked: 0 };
  const updated = await deps.db
    .update(notifications)
    .set({ read: true, readAt: deps.clock.now() })
    .where(and(inArray(notifications.id, ids), eq(notifications.userId, auth.userId)))
    .returning({ id: notifications.id });
  return { marked: updated.length };
}
