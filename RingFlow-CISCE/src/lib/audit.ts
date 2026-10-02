import { headers } from "next/headers";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import type { Principal } from "@/lib/auth/principal";

/**
 * The official record. Every action that changes something an official is
 * accountable for — approvals, scores, results, corrections, draws, queue,
 * settings — writes one row here through `audit()`.
 *
 * Writing the audit row never makes the action itself fail: if the insert
 * errors, the error is logged loudly and the action's result stands.
 */

export type AuditActor =
  | Principal
  | { role: "judge"; id: string; name: string }
  | { role: "system"; id?: string; name: string };

export type AuditEntry = {
  tournamentId: string;
  action: string;
  actor: AuditActor;
  ringId?: string | null;
  categoryId?: string | null;
  matchId?: string | null;
  targetType?: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
};

function actorFields(actor: AuditActor) {
  switch (actor.role) {
    case "admin":
      return { actorRole: "admin", actorId: actor.adminId, actorName: actor.name };
    case "organiser":
    case "stager":
    case "moderator":
      return { actorRole: actor.role, actorId: actor.requestId, actorName: actor.name };
    default:
      return { actorRole: actor.role, actorId: actor.id ?? null, actorName: actor.name };
  }
}

/** JSON-safe copy (Dates → ISO, Buffers dropped) so jsonb never chokes. */
function snapshot(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(
    JSON.stringify(value, (_key, v) => {
      if (v && typeof v === "object" && (v as { type?: string }).type === "Buffer") return "[binary]";
      return v;
    })
  );
}

export async function audit(entry: AuditEntry): Promise<void> {
  let ip: string | null = null;
  let userAgent: string | null = null;
  try {
    const h = await headers();
    ip = (h.get("x-forwarded-for") || h.get("x-real-ip") || "").split(",")[0].trim().slice(0, 64) || null;
    userAgent = (h.get("user-agent") || "").slice(0, 300) || null;
  } catch {
    // Outside a request (scripts): no address to record.
  }

  try {
    await db.insert(auditLog).values({
      tournamentId: entry.tournamentId,
      ringId: entry.ringId ?? null,
      categoryId: entry.categoryId ?? null,
      matchId: entry.matchId ?? null,
      ...actorFields(entry.actor),
      ip,
      userAgent,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      before: snapshot(entry.before),
      after: snapshot(entry.after),
      reason: entry.reason ? entry.reason.slice(0, 1000) : null,
    });
  } catch (err) {
    console.error(`[audit] FAILED to record ${entry.action} for tournament ${entry.tournamentId}:`, err);
  }
}

/** Human labels for the audit viewer and the official PDF. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  MODERATOR_APPROVED: "Moderator approved",
  MODERATOR_REJECTED: "Moderator rejected",
  MODERATOR_REVOKED: "Moderator revoked",
  ORGANISER_APPROVED: "Organiser approved",
  ORGANISER_REJECTED: "Organiser rejected",
  ORGANISER_REVOKED: "Organiser revoked",
  STAGER_APPROVED: "Stager approved",
  STAGER_REJECTED: "Stager rejected",
  STAGER_REVOKED: "Stager revoked",
  JUDGE_APPROVED: "Judge approved",
  JUDGE_REJECTED: "Judge request rejected",
  JUDGE_KICKED: "Judge removed from panel",
  JUDGE_LEFT: "Judge left the panel",
  JUDGE_PANEL_ENDED: "Judge panel ended",
  ORGANISER_CODE_REGENERATED: "Organiser code changed",
  STAGER_CODES_GENERATED: "Stager codes added",
  STAGER_CODE_REMOVED: "Stager code removed",
  RING_CODE_REGENERATED: "Tatami code changed",
  JUDGE_PIN_CHANGED: "Judge QR/PIN rotated",
  RING_ADDED: "Tatami added",
  RING_DELETED: "Tatami deleted",
  SETTINGS_UPDATED: "Event settings changed",
  CATEGORY_ADDED: "Category added",
  CATEGORIES_BULK_ADDED: "Categories added",
  CATEGORY_UPDATED: "Category changed",
  CATEGORY_DELETED: "Category deleted",
  CATEGORY_KATA_SETTINGS: "Kata settings changed",
  CATEGORY_DEFINITIONS_SAVED: "Category definitions saved",
  CATEGORY_PDF_UPLOADED: "Category PDF uploaded",
  CATEGORY_PDF_REMOVED: "Category PDF removed",
  ATHLETE_ADDED: "Athlete added",
  ATHLETE_DELETED: "Athlete deleted",
  ATHLETE_MOVED: "Athlete moved",
  ATHLETES_IMPORTED: "Athletes imported",
  DRAW_GENERATED: "Draw generated",
  DRAWS_GENERATED: "Draws generated",
  DRAW_LOCKED: "Draw locked",
  DRAW_UNLOCKED: "Draw unlocked",
  DRAW_FLUSHED: "Draw deleted",
  DRAW_OPTION_CHANGED: "Draw option changed",
  ASSIGNMENTS_SAVED: "Tatami assignments saved",
  CATEGORY_STARTED: "Category started",
  CATEGORY_FINISHED: "Category finished",
  CATEGORY_PAUSED: "Category paused",
  CATEGORY_RESUMED: "Category resumed",
  CATEGORY_RETURNED: "Category returned to queue",
  QUEUE_REORDERED: "Queue reordered",
  MATCH_COUNT_ADJUSTED: "Match count adjusted",
  RING_ALERT: "Emergency / assistance",
  STAGER_STATUS: "Call area status",
  BOUT_STARTED: "Bout put on the mat",
  BOUT_SCORE: "Score changed",
  BOUT_CONFIRMED: "Result confirmed",
  BOUT_CORRECTED: "Result corrected",
  KATA_MARKS_SAVED: "Kata marks saved",
  KATA_VOTE: "Judge vote",
  KATA_VOTE_VOIDED: "Judge vote voided",
  KATA_VOTE_OVERRIDDEN: "Judge vote entered by desk",
  KATA_VOTING_OPENED: "Kata voting opened",
  KATA_VOTING_CLOSED: "Kata voting closed",
  RESULTS_EXPORTED: "Results exported",
  ADMIN_PAUSE_ALL: "All tatamis paused/resumed",
  ADMIN_RING_STATUS: "Tatami paused/resumed by admin",
};
