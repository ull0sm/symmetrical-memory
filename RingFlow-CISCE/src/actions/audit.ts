"use server";

import { and, desc, eq, inArray, lt, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, categories, rings } from "@/db/schema";
import { requireTournamentStaff } from "@/lib/auth/guards";
import { AUDIT_ACTION_LABELS } from "@/lib/audit";
import { isValidUuid } from "@/lib/utils";

export type AuditFilters = {
  ringId?: string | null;
  categoryId?: string | null;
  actorRole?: string | null;
  action?: string | null;
  matchId?: string | null;
  /** ISO timestamp: return entries older than this (for "load more"). */
  before?: string | null;
};

export type AuditRow = {
  id: string;
  createdAt: string;
  action: string;
  actionLabel: string;
  actorRole: string;
  actorName: string | null;
  ringName: string | null;
  categoryName: string | null;
  matchId: string | null;
  targetType: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  ip: string | null;
};

const ROLES = ["admin", "organiser", "stager", "moderator", "judge", "system"];
const PAGE_SIZE = 100;

/** The event's official record, newest first. Admin and organisers only. */
export async function getAuditLog(tournamentId: string, filters: AuditFilters = {}) {
  await requireTournamentStaff(tournamentId, ["admin", "organiser"]);

  const where: SQL[] = [eq(auditLog.tournamentId, tournamentId)];
  if (filters.ringId && isValidUuid(filters.ringId)) where.push(eq(auditLog.ringId, filters.ringId));
  if (filters.categoryId && isValidUuid(filters.categoryId)) where.push(eq(auditLog.categoryId, filters.categoryId));
  if (filters.actorRole && ROLES.includes(filters.actorRole)) where.push(eq(auditLog.actorRole, filters.actorRole));
  if (filters.action && filters.action in AUDIT_ACTION_LABELS) where.push(eq(auditLog.action, filters.action));
  if (filters.matchId && filters.matchId.length <= 200) where.push(eq(auditLog.matchId, filters.matchId));
  if (filters.before) {
    const d = new Date(filters.before);
    if (!Number.isNaN(d.getTime())) where.push(lt(auditLog.createdAt, d));
  }

  const rows = await db
    .select()
    .from(auditLog)
    .where(and(...where))
    .orderBy(desc(auditLog.createdAt))
    .limit(PAGE_SIZE + 1);

  const ringIds = Array.from(new Set(rows.map((r) => r.ringId).filter((x): x is string => Boolean(x))));
  const catIds = Array.from(new Set(rows.map((r) => r.categoryId).filter((x): x is string => Boolean(x))));
  const [ringRows, catRows] = await Promise.all([
    ringIds.length ? db.select({ id: rings.id, name: rings.name }).from(rings).where(inArray(rings.id, ringIds)) : [],
    catIds.length
      ? db.select({ id: categories.id, name: categories.name }).from(categories).where(inArray(categories.id, catIds))
      : [],
  ]);
  const ringName = new Map(ringRows.map((r) => [r.id, r.name]));
  const catName = new Map(catRows.map((c) => [c.id, c.name]));

  const page = rows.slice(0, PAGE_SIZE);
  return {
    hasMore: rows.length > PAGE_SIZE,
    rows: page.map(
      (r): AuditRow => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        action: r.action,
        actionLabel: AUDIT_ACTION_LABELS[r.action] ?? r.action,
        actorRole: r.actorRole,
        actorName: r.actorName,
        ringName: r.ringId ? ringName.get(r.ringId) ?? "Deleted tatami" : null,
        categoryName: r.categoryId ? catName.get(r.categoryId) ?? "Deleted category" : null,
        matchId: r.matchId,
        targetType: r.targetType,
        before: r.before,
        after: r.after,
        reason: r.reason,
        ip: r.ip,
      })
    ),
  };
}

/** Filter options for the record screen. */
export async function getAuditFilterOptions(tournamentId: string) {
  await requireTournamentStaff(tournamentId, ["admin", "organiser"]);
  const [ringRows, catRows] = await Promise.all([
    db.select({ id: rings.id, name: rings.name }).from(rings).where(eq(rings.tournamentId, tournamentId)).orderBy(rings.ringOrder),
    db.select({ id: categories.id, name: categories.name }).from(categories).where(eq(categories.tournamentId, tournamentId)).orderBy(categories.name),
  ]);
  return {
    rings: ringRows,
    categories: catRows,
    roles: ROLES,
    actions: Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => ({ value, label })),
  };
}
