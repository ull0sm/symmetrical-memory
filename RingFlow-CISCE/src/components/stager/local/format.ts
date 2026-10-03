import type { DeskItem, DeskStatus } from "@/lib/local/stagingView";

/** Words and labels shared by the Local stager desk, workspace and the admin's staging overview. */

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

/** "Tatami 1 · 3rd in line", "Tatami 2 · on the mat now", or "No tatami yet". */
export function tatamiLine(tatami: DeskItem["tatami"]): string {
  if (!tatami) return "No tatami yet";
  if (tatami.onMat) return `${tatami.ringName} · on the mat now`;
  if (tatami.ahead === 0) return `${tatami.ringName} · next in line`;
  return `${tatami.ringName} · ${ordinal(tatami.ahead + 1)} in line`;
}

export const EVENT_LABEL = { kumite: "Kumite", kata: "Kata" } as const;

/** The status pill of a category on the desk. */
export function statusPill(item: Pick<DeskItem, "status" | "isMine" | "holderName" | "events" | "athletes">): { label: string; tone: string } {
  const groups = item.events.reduce((n, e) => n + e.groups, 0);
  const locked = item.events.reduce((n, e) => n + e.locked, 0);
  const tones: Record<DeskStatus, string> = {
    waiting: "border-[var(--line-strong)] bg-[var(--canvas)] text-[var(--ink-700)]",
    held: "border-sky-200 bg-sky-50 text-sky-800",
    partly: "border-amber-200 bg-amber-50 text-amber-800",
    sent: "border-emerald-200 bg-emerald-50 text-emerald-800",
    done: "border-[var(--line)] bg-[var(--surface)] text-[var(--ink-400)]",
  };
  if (item.status === "held" && item.isMine) return { label: "With you", tone: "border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent-dark)]" };
  if (item.status === "held") return { label: `With ${item.holderName ?? "a stager"}`, tone: tones.held };
  if (item.status === "partly") return { label: `Partly sent · ${locked}/${groups}`, tone: tones.partly };
  if (item.status === "sent") return { label: "Sent", tone: tones.sent };
  if (item.status === "done") return { label: "Finished", tone: tones.done };
  if (item.athletes === 0) return { label: "No athletes", tone: tones.done };
  return { label: "Waiting", tone: tones.waiting };
}

/** "3 min ago", for how long a hold has been quiet. */
export function sinceLabel(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min ago`;
}
