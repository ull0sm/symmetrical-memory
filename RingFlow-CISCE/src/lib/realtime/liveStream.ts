import { eq } from "drizzle-orm";
import { db } from "@/db";
import { categories, rings } from "@/db/schema";
import { getRingModerator, getTournamentStaff } from "@/lib/auth/guards";
import { subscribeToLiveEvents, type LiveEvent } from "@/lib/realtime/bus";
import { isValidUuid } from "@/lib/utils";

/**
 * Server-Sent Events feeds of database changes (PLAN 5.4). Two endpoints:
 *
 * - `/api/live` (public): spectators, TV screens, judge phones and waiting
 *   rooms. Only the tables a public screen renders, ids and status only. The
 *   only feed reachable through a tunnel / judge host.
 * - `/api/live/staff`: refused (401) unless the caller is staff of the scope's
 *   tournament or the moderator of the scoped tatami. Adds the operational
 *   tables (event log, access requests).
 *
 * Screens refetch through their own guarded server actions when an event
 * lands. Events never carry tokens, and a connection without a scope gets nothing.
 */

export type LiveFeed = "public" | "staff";

const HEARTBEAT_MS = 20_000;

const PUBLIC_TABLES = new Set([
  "rings",
  "categories",
  "category_assignments",
  "matches",
  "match_slots",
  "draws",
  "kata_scores",
  "tournaments",
  "judge_sessions",
]);

const REQUEST_TABLES = new Set(["moderator_requests", "stager_requests", "organiser_requests"]);

// Rings and categories never move between tournaments, so their owner can be cached.
const ringTournament = new Map<string, string>();
const categoryTournament = new Map<string, string>();

async function tournamentOf(event: LiveEvent): Promise<string | undefined> {
  if (event.tournamentId) return event.tournamentId;
  try {
    if (event.ringId && isValidUuid(event.ringId)) {
      if (!ringTournament.has(event.ringId)) {
        const [row] = await db.select({ t: rings.tournamentId }).from(rings).where(eq(rings.id, event.ringId));
        if (row) ringTournament.set(event.ringId, row.t);
      }
      return ringTournament.get(event.ringId);
    }
    if (event.categoryId && isValidUuid(event.categoryId)) {
      if (!categoryTournament.has(event.categoryId)) {
        const [row] = await db
          .select({ t: categories.tournamentId })
          .from(categories)
          .where(eq(categories.id, event.categoryId));
        if (row) categoryTournament.set(event.categoryId, row.t);
      }
      return categoryTournament.get(event.categoryId);
    }
  } catch (err) {
    console.error("[live] could not resolve tournament for event:", err);
  }
  return undefined;
}

/** The fields any subscriber may see. Everything else on an event is dropped. */
function sanitize(event: LiveEvent, feed: LiveFeed): Record<string, unknown> {
  const out: Record<string, unknown> = {
    table: event.table,
    op: event.op,
    id: event.id,
    ringId: event.ringId,
    tournamentId: event.tournamentId,
    categoryId: event.categoryId,
    matchId: event.matchId,
    status: event.status,
  };
  if (event.table === "matches") {
    out.akaScore = event.akaScore;
    out.aoScore = event.aoScore;
    out.akaPenalties = event.akaPenalties;
    out.aoPenalties = event.aoPenalties;
    out.senshu = event.senshu;
  }
  if (event.table === "rings" && event.data && "sidesSwapped" in event.data) {
    out.data = { sidesSwapped: event.data.sidesSwapped };
  }
  if (feed === "staff" && event.table === "event_log" && event.data) {
    out.data = event.data;
  }
  return out;
}

type Scope = {
  ringId: string | null;
  tournamentId: string | null;
  categoryId: string | null;
  requestId: string | null;
};

function readScope(request: Request): Scope {
  const url = new URL(request.url);
  const param = (name: string) => {
    const v = url.searchParams.get(name);
    return v && isValidUuid(v) ? v : null;
  };
  return {
    ringId: param("ringId"),
    tournamentId: param("tournamentId"),
    categoryId: param("categoryId"),
    requestId: param("requestId"),
  };
}

/** True when the caller may hold the staff feed for this scope. */
async function isStaffForScope(scope: Scope): Promise<boolean> {
  let tournamentId = scope.tournamentId;
  if (scope.ringId) {
    if (await getRingModerator(scope.ringId)) return true;
    const [row] = await db.select({ t: rings.tournamentId }).from(rings).where(eq(rings.id, scope.ringId));
    tournamentId = row?.t ?? null;
  } else if (scope.categoryId) {
    const [row] = await db.select({ t: categories.tournamentId }).from(categories).where(eq(categories.id, scope.categoryId));
    tournamentId = row?.t ?? null;
  }
  return Boolean(tournamentId && (await getTournamentStaff(tournamentId)));
}

export async function liveStreamResponse(request: Request, feed: LiveFeed): Promise<Response> {
  const scope = readScope(request);
  const hasScope = Boolean(scope.ringId || scope.tournamentId || scope.categoryId || scope.requestId);

  if (feed === "staff") {
    // Waiting rooms use the public feed; the staff feed needs a real scope and a session.
    let allowed = false;
    try {
      allowed = !scope.requestId && hasScope && (await isStaffForScope(scope));
    } catch (err) {
      console.error("[live] could not resolve subscriber scope:", err);
    }
    if (!allowed) {
      return new Response("Staff session required", { status: 401, headers: { "Cache-Control": "no-store" } });
    }
  }

  const matches = async (event: LiveEvent): Promise<boolean> => {
    if (scope.requestId) {
      // A waiting room only learns its own request's status.
      return REQUEST_TABLES.has(event.table) && event.id === scope.requestId;
    }
    if (feed === "public" && !PUBLIC_TABLES.has(event.table)) return false;

    if (scope.ringId) return event.ringId === scope.ringId;
    if (scope.categoryId) {
      return event.categoryId === scope.categoryId || (event.table === "categories" && event.id === scope.categoryId);
    }
    if (scope.tournamentId) {
      return (await tournamentOf(event)) === scope.tournamentId;
    }
    return false;
  };

  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const write = (chunk: string) => {
        if (closed || request.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      write(`retry: 3000\n\n`);
      write(`event: ready\ndata: {}\n\n`);

      const unsubscribe = hasScope
        ? subscribeToLiveEvents((event: LiveEvent) => {
            if (closed || request.signal.aborted) return;
            void matches(event).then((ok) => {
              if (!ok) return;
              const payload = scope.requestId
                ? { table: event.table, op: event.op, id: event.id, status: event.status }
                : sanitize(event, feed);
              write(`event: change\ndata: ${JSON.stringify(payload)}\n\n`);
            });
          })
        : () => {};

      const heartbeat = setInterval(() => {
        if (closed || request.signal.aborted) return;
        write(`: ping\n\n`);
      }, HEARTBEAT_MS);

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          if (!request.signal.aborted) controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };

      request.signal.addEventListener("abort", () => cleanup?.());
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
