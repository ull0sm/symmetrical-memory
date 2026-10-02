"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { getCategoryAttendance, setAthleteAttendance, type AttendanceStatus } from "@/actions/attendance";
import { useLiveEvents } from "@/hooks/useLiveEvents";

type Row = Awaited<ReturnType<typeof getCategoryAttendance>>[number];

interface Props {
  categoryId: string;
  categoryName: string;
  tournamentId: string;
  onClose: () => void;
}

const OPTIONS: { value: AttendanceStatus; label: string; on: string }[] = [
  { value: "present", label: "Present", on: "border-emerald-600 bg-emerald-600 text-white" },
  { value: "absent", label: "Absent", on: "border-amber-500 bg-amber-500 text-white" },
  { value: "withdrawn", label: "Withdrawn", on: "border-red-600 bg-red-600 text-white" },
];

/**
 * Call-area attendance for one category: one tap per athlete,
 * tap again to clear. Optional; nothing waits on it.
 */
export function AttendanceModal({ categoryId, categoryName, tournamentId, onClose }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await getCategoryAttendance(categoryId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the athletes.");
    }
  }, [categoryId]);

  useEffect(() => {
    load();
  }, [load]);

  useLiveEvents({ tournamentId }, (event) => {
    if (event?.table === "category_attendance" && event.categoryId === categoryId) load();
  }, { feed: "staff" });

  const mark = async (athleteId: string, current: string, next: AttendanceStatus) => {
    const status = current === next ? "unknown" : next;
    setSaving(athleteId);
    setError(null);
    // Optimistic: the call area is busy and taps should feel instant.
    setRows((prev) => prev?.map((r) => (r.athleteId === athleteId ? { ...r, status } : r)) ?? prev);
    try {
      const res = await setAthleteAttendance({ categoryId, athleteId, status });
      if (!res.success) {
        setError(res.error);
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Not saved.");
      await load();
    } finally {
      setSaving(null);
    }
  };

  const counts = { present: 0, absent: 0, withdrawn: 0, unknown: 0 };
  for (const r of rows ?? []) counts[r.status] += 1;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-2xl border border-[var(--line)] bg-white shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
          <div>
            <h3 className="text-base font-bold text-[var(--ink-900)]">Attendance: {categoryName}</h3>
            <p className="text-xs text-[var(--ink-500)]">
              {counts.present} present · {counts.absent} absent · {counts.withdrawn} withdrawn · {counts.unknown} not marked
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-lg p-1.5 text-[var(--ink-500)] hover:bg-[var(--canvas)] hover:text-[var(--ink-900)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2">
          {rows === null && !error && <p className="px-2 py-6 text-center text-sm text-[var(--ink-500)]">Loading…</p>}
          {rows?.length === 0 && <p className="px-2 py-6 text-center text-sm text-[var(--ink-500)]">No athletes in this category.</p>}
          <ul className="divide-y divide-[var(--line)]">
            {rows?.map((r) => (
              <li key={r.athleteId} className="flex flex-wrap items-center justify-between gap-2 px-2 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--ink-900)]">
                    {r.chestNumber ? <span className="mr-1.5 font-data-mono text-xs text-[var(--ink-400)]">#{r.chestNumber}</span> : null}
                    {r.name}
                  </p>
                  {r.school && <p className="truncate text-xs text-[var(--ink-500)]">{r.school}</p>}
                </div>
                <div className="flex gap-1.5">
                  {OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      disabled={saving === r.athleteId}
                      aria-pressed={r.status === o.value}
                      onClick={() => mark(r.athleteId, r.status, o.value)}
                      className={`min-h-[36px] cursor-pointer rounded-lg border px-2.5 text-xs font-bold transition-colors disabled:opacity-60 ${
                        r.status === o.value ? o.on : "border-[var(--line)] bg-white text-[var(--ink-700)] hover:bg-[var(--canvas)]"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {error && <p className="border-t border-[var(--line)] px-5 py-2 text-sm font-semibold text-red-700">{error}</p>}
        <p className="border-t border-[var(--line)] px-5 py-3 text-[11px] text-[var(--ink-400)]">
          Optional. The tatami desk sees a hint for absent or withdrawn athletes; nothing is blocked.
        </p>
      </div>
    </div>
  );
}
