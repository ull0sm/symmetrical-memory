"use client";

import { AlertTriangle } from "lucide-react";

type Mark = { status: string; setBy: string; setAt: string };
type Side = { id?: string | null; name?: string | null } | null | undefined;

interface Props {
  aka: Side;
  ao: Side;
  /** athleteId → absent/withdrawn mark from the call area. */
  attendance?: Record<string, Mark> | null;
}

/**
 * Call-area hint for the desk. Only informs: the moderator decides
 * whether to call Kiken. Nothing is blocked.
 */
export function AttendanceHint({ aka, ao, attendance }: Props) {
  if (!attendance) return null;
  const notes = (["AKA", "AO"] as const)
    .map((side) => {
      const who = side === "AKA" ? aka : ao;
      const mark = who?.id ? attendance[who.id] : undefined;
      return mark ? { side, name: who?.name || side, mark } : null;
    })
    .filter((n): n is { side: "AKA" | "AO"; name: string; mark: Mark } => n !== null);
  if (notes.length === 0) return null;

  return (
    <div role="status" className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div className="space-y-0.5">
        {notes.map(({ side, name, mark }) => (
          <p key={side}>
            <strong>
              {side} {name}
            </strong>{" "}
            was marked <strong>{mark.status}</strong> by the call area
            {mark.setAt ? ` at ${new Date(mark.setAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}.
          </p>
        ))}
        <p className="text-xs text-amber-800">If they don&apos;t come to the mat, consider Kiken. This is a hint only.</p>
      </div>
    </div>
  );
}
