import { EventEmitter } from "node:events";
import postgres from "postgres";

/**
 * One LISTEN connection per server process, fanning Postgres NOTIFY payloads
 * out to every SSE subscriber.
 *
 * Row changes reach the browser through `migration8_realtime_notify.sql`, which
 * raises `ringflow_events` on the tables live screens read. A single connection
 * carries all of them, so ten open screens cost one database connection rather
 * than ten pollers.
 */

export interface LiveEvent {
  table: string;
  op: "INSERT" | "UPDATE" | "DELETE";
  id?: string;
  ringId?: string;
  tournamentId?: string;
  categoryId?: string;
  matchId?: string;
  akaScore?: number;
  aoScore?: number;
  akaPenalties?: number;
  aoPenalties?: number;
  senshu?: string | null;
  status?: string;
  data?: Record<string, any>;
}

const CHANNEL = "ringflow_events";

type Bus = {
  emitter: EventEmitter;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  subscribers: number;
};

const globalForBus = globalThis as unknown as { ringflowLiveBus?: Bus };

function createBus(): Bus {
  const emitter = new EventEmitter();
  // A screen can hold several subscriptions (a mat page watches rings and
  // assignments); 100 listeners is well past anything real and still warns if
  // something leaks.
  emitter.setMaxListeners(100);

  let sql: ReturnType<typeof postgres> | null = null;
  let listenPromise: Promise<void> | null = null;

  const start = async () => {
    if (sql) return;
    if (listenPromise) return listenPromise;

    const connectionString =
      process.env.DATABASE_URL || "postgres://event_suite:event_suite@127.0.0.1:5432/ringflow";

    listenPromise = (async () => {
      try {
        const conn = postgres(connectionString, { max: 1, idle_timeout: 0 });
        await conn.listen(CHANNEL, (raw: string) => {
          try {
            const event = JSON.parse(raw) as LiveEvent;
            if (event && typeof event.table === "string") emitter.emit("event", event);
          } catch (err) {
            console.error("[live] could not parse a notification payload:", err, raw);
          }
        });
        sql = conn;
      } catch (err) {
        // The stream simply never announces anything; every screen still has its
        // polling fallback, so this is a degradation, not an outage.
        console.error("[live] LISTEN failed, falling back to polling:", err);
      } finally {
        listenPromise = null;
      }
    })();

    return listenPromise;
  };

  const stop = async () => {
    const conn = sql;
    sql = null;
    if (!conn) return;
    try {
      await conn.end({ timeout: 5 });
    } catch (err) {
      console.error("[live] could not close the LISTEN connection:", err);
    }
  };

  return { emitter, start, stop, subscribers: 0 };
}

export const bus: Bus = globalForBus.ringflowLiveBus ?? createBus();
if (process.env.NODE_ENV !== "production") globalForBus.ringflowLiveBus = bus;

/**
 * Subscribe to change events. Returns an unsubscribe function; the LISTEN
 * connection is opened on the first subscriber and closed with the last.
 */
export function subscribeToLiveEvents(listener: (event: LiveEvent) => void): () => void {
  bus.subscribers += 1;
  void bus.start();

  bus.emitter.on("event", listener);

  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    bus.emitter.off("event", listener);
    bus.subscribers = Math.max(0, bus.subscribers - 1);
    if (bus.subscribers === 0) void bus.stop();
  };
}

/**
 * Instantly broadcast an event in-memory to all active SSE connections
 * without waiting for database roundtrip.
 */
export function broadcastLiveEvent(event: LiveEvent): void {
  try {
    bus.emitter.emit("event", event);
  } catch (err) {
    console.error("[live] broadcast error:", err);
  }
}
