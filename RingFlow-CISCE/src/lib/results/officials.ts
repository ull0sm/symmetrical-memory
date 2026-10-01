import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, categories, matchEvents, matches } from "@/db/schema";

export type BoutOfficial = {
  /** Who confirmed the result as it stands now. */
  confirmedBy: string | null;
  /** How many times the confirmed result was changed afterwards. */
  corrections: number;
  /** Reason given for the most recent correction. */
  lastCorrectionReason: string | null;
};

/**
 * Per bout: which official confirmed it and whether it was corrected. Read
 * from the audit log, falling back to the match events written before the
 * audit log existed.
 */
export async function getBoutOfficials(tournamentId: string): Promise<Map<string, BoutOfficial>> {
  const out = new Map<string, BoutOfficial>();

  const entries = await db
    .select({ matchId: auditLog.matchId, action: auditLog.action, actorName: auditLog.actorName, reason: auditLog.reason })
    .from(auditLog)
    .where(and(eq(auditLog.tournamentId, tournamentId), inArray(auditLog.action, ["BOUT_CONFIRMED", "BOUT_CORRECTED"])))
    .orderBy(asc(auditLog.createdAt));

  for (const e of entries) {
    if (!e.matchId) continue;
    const cur = out.get(e.matchId) ?? { confirmedBy: null, corrections: 0, lastCorrectionReason: null };
    cur.confirmedBy = e.actorName ?? cur.confirmedBy;
    if (e.action === "BOUT_CORRECTED") {
      cur.corrections += 1;
      cur.lastCorrectionReason = e.reason ?? cur.lastCorrectionReason;
    }
    out.set(e.matchId, cur);
  }

  // Older bouts: the match event's actor is "role:name".
  const legacy = await db
    .select({ matchId: matchEvents.matchId, actor: matchEvents.actor, type: matchEvents.type })
    .from(matchEvents)
    .innerJoin(matches, eq(matches.id, matchEvents.matchId))
    .innerJoin(categories, eq(categories.id, matches.categoryId))
    .where(and(eq(categories.tournamentId, tournamentId), inArray(matchEvents.type, ["RESULT_CONFIRMED", "RESULT_CORRECTED"])))
    .orderBy(asc(matchEvents.ts));
  for (const e of legacy) {
    if (out.has(e.matchId) && out.get(e.matchId)!.confirmedBy) continue;
    const name = e.actor ? e.actor.split(":").slice(1).join(":") || e.actor : null;
    const cur = out.get(e.matchId) ?? { confirmedBy: null, corrections: 0, lastCorrectionReason: null };
    cur.confirmedBy = name ?? cur.confirmedBy;
    if (e.type === "RESULT_CORRECTED") cur.corrections += 1;
    out.set(e.matchId, cur);
  }

  return out;
}
