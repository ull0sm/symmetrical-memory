/**
 * Category discipline. Stored in `categories.event_type`; the name is only a
 * fallback for rows created before the column was filled in.
 */
import { EVENT_TYPES, type EventType } from "@/lib/statuses";

export { EVENT_TYPES };
export type { EventType };

export function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && (EVENT_TYPES as readonly string[]).includes(value);
}

/** Best guess from a category name, e.g. "U14 Boys Kata" → kata. */
export function inferEventType(name: string | null | undefined): EventType {
  const n = (name || "").toLowerCase();
  if (n.includes("team") && n.includes("kata")) return "team_kata";
  if (n.includes("team") && n.includes("kumite")) return "team_kumite";
  if (n.includes("kata")) return "kata";
  return "kumite";
}

/** True for individual and team kata. Accepts a category in camel or snake case. */
export function isKataCategory(
  category:
    | { eventType?: string | null; event_type?: string | null; name?: string | null }
    | null
    | undefined
): boolean {
  if (!category) return false;
  const type = category.eventType ?? category.event_type;
  // "kumite" is also the column default, so a legacy row named "... Kata" still counts.
  if (type === "kata" || type === "team_kata") return true;
  if (type && type !== "kumite") return false;
  return inferEventType(category.name) === "kata" || inferEventType(category.name) === "team_kata";
}
