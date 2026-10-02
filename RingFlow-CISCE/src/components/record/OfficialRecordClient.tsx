"use client";

import React, { useCallback, useEffect, useState } from "react";
import { getAuditLog, type AuditFilters, type AuditRow } from "@/actions/audit";
import { exportTournamentResultsCsv, exportTournamentResultsPdf } from "@/actions/resultsExport";

type Options = {
  rings: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  roles: string[];
  actions: { value: string; label: string }[];
};

interface Props {
  tournamentId: string;
  options: Options;
  initialRows: AuditRow[];
  initialHasMore: boolean;
}

const ROLE_STYLE: Record<string, string> = {
  admin: "bg-[#1B1815] text-white",
  moderator: "bg-emerald-50 text-emerald-900 border border-emerald-200",
  stager: "bg-amber-50 text-amber-900 border border-amber-200",
  organiser: "bg-sky-50 text-sky-900 border border-sky-200",
  judge: "bg-violet-50 text-violet-900 border border-violet-200",
  system: "bg-[#F0ECE1] text-[#68645A]",
};

const IMPORTANT = new Set(["BOUT_CORRECTED", "DRAW_FLUSHED", "DRAW_UNLOCKED", "MODERATOR_REVOKED", "RING_ALERT"]);

function formatTime(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { day: "2-digit", month: "short" })} ${d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })}`;
}

/** One-line summary of what changed; the full before/after is one click away. */
function summarize(row: AuditRow): string {
  const after = (row.after ?? {}) as Record<string, unknown>;
  const before = (row.before ?? {}) as Record<string, unknown>;
  switch (row.action) {
    case "BOUT_SCORE":
      return `AKA ${before.akaScore ?? "–"}→${after.akaScore ?? "–"} · AO ${before.aoScore ?? "–"}→${after.aoScore ?? "–"}`;
    case "BOUT_CONFIRMED":
    case "BOUT_CORRECTED":
      return `Winner ${after.winnerSide ?? "?"}${after.akaScore !== undefined ? ` (${after.akaScore}–${after.aoScore})` : ""}${
        after.decisionMethod ? ` · ${after.decisionMethod}` : ""
      }`;
    case "MODERATOR_APPROVED":
      return String(after.moderator ?? "");
    case "STAGER_STATUS":
      return `Status: ${after.stagerStatus ?? "cleared"}`;
    case "RING_ALERT":
      return String(after.message ?? after.alert ?? "");
    case "ATHLETES_IMPORTED":
      return `${after.count ?? after.athletes ?? 0} athletes (${after.source ?? "import"})`;
    default:
      return "";
  }
}

export default function OfficialRecordClient({ tournamentId, options, initialRows, initialHasMore }: Props) {
  const [rows, setRows] = useState<AuditRow[]>(initialRows);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [filters, setFilters] = useState<AuditFilters>({});
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"csv" | "pdf" | null>(null);

  const load = useCallback(
    async (next: AuditFilters, append: boolean) => {
      setLoading(true);
      try {
        const res = await getAuditLog(tournamentId, next);
        setRows((prev) => (append ? [...prev, ...res.rows] : res.rows));
        setHasMore(res.hasMore);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Could not load the record.");
      } finally {
        setLoading(false);
      }
    },
    [tournamentId]
  );

  // Refetch whenever a filter changes (skip the first render: server data is already here).
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (touched) void load(filters, false);
  }, [filters, touched, load]);

  const setFilter = (key: keyof AuditFilters, value: string) => {
    setTouched(true);
    setFilters((f) => ({ ...f, [key]: value || null, before: null }));
  };

  const handleExport = async (format: "csv" | "pdf") => {
    setExporting(format);
    try {
      const res = format === "csv" ? await exportTournamentResultsCsv(tournamentId) : await exportTournamentResultsPdf(tournamentId);
      if (!res.success || !res.base64) {
        alert(("error" in res && res.error) || "Could not build the results record.");
        return;
      }
      const bytes = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: format === "csv" ? "text/csv;charset=utf-8" : "application/pdf" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = res.filename;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      alert(`Export failed: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setExporting(null);
    }
  };

  const selectClass =
    "h-9 rounded-lg border border-[#E1DDCF] bg-white px-2.5 text-xs font-semibold text-[#1B1815] focus:outline-none focus:ring-2 focus:ring-[#0E9C7C]/30";

  return (
    <div className="p-4 md:p-margin-desktop space-y-5 max-w-[1600px] mx-auto w-full">
      {/* Export */}
      <section className="bg-white border border-[#E1DDCF] rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4 shadow-xs">
        <div>
          <h2 className="text-base font-bold text-[#1B1815]">Official results</h2>
          <p className="text-xs text-[#68645A] mt-0.5">
            Every bout with its athletes, scores, decision and winner, for submission to the governing body.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => handleExport("pdf")}
            disabled={exporting !== null}
            className="px-4 py-2 rounded-xl bg-[#1B1815] text-white text-xs font-bold disabled:opacity-50 cursor-pointer"
          >
            {exporting === "pdf" ? "Building PDF…" : "Download PDF"}
          </button>
          <button
            type="button"
            onClick={() => handleExport("csv")}
            disabled={exporting !== null}
            className="px-4 py-2 rounded-xl bg-[#FAF9F5] border border-[#E1DDCF] text-[#1B1815] text-xs font-bold disabled:opacity-50 cursor-pointer"
          >
            {exporting === "csv" ? "Building CSV…" : "Download CSV"}
          </button>
        </div>
      </section>

      {/* Audit log */}
      <section className="bg-white border border-[#E1DDCF] rounded-2xl shadow-xs overflow-hidden">
        <div className="px-5 pt-5 pb-4 border-b border-[#F1EFE9]">
          <h2 className="text-base font-bold text-[#1B1815]">Audit log</h2>
          <p className="text-xs text-[#68645A] mt-0.5">
            Who did what, and when. Entries cannot be edited or removed.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <select aria-label="Tatami" className={selectClass} value={filters.ringId ?? ""} onChange={(e) => setFilter("ringId", e.target.value)}>
              <option value="">All tatamis</option>
              {options.rings.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <select aria-label="Category" className={selectClass} value={filters.categoryId ?? ""} onChange={(e) => setFilter("categoryId", e.target.value)}>
              <option value="">All categories</option>
              {options.categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select aria-label="Role" className={selectClass} value={filters.actorRole ?? ""} onChange={(e) => setFilter("actorRole", e.target.value)}>
              <option value="">Everyone</option>
              {options.roles.map((r) => (
                <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>
              ))}
            </select>
            <select aria-label="Action" className={selectClass} value={filters.action ?? ""} onChange={(e) => setFilter("action", e.target.value)}>
              <option value="">All actions</option>
              {options.actions.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#FAF9F5] text-[#68645A] uppercase tracking-wider text-[10.5px]">
              <tr>
                <th className="px-4 py-2.5 font-bold whitespace-nowrap">Time</th>
                <th className="px-4 py-2.5 font-bold">Who</th>
                <th className="px-4 py-2.5 font-bold">Action</th>
                <th className="px-4 py-2.5 font-bold">Where</th>
                <th className="px-4 py-2.5 font-bold">Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-[#68645A] italic">
                    {loading ? "Loading…" : "Nothing recorded yet for this selection."}
                  </td>
                </tr>
              )}
              {rows.map((row) => {
                const isOpen = expanded === row.id;
                return (
                  <React.Fragment key={row.id}>
                    <tr
                      className={`border-t border-[#F1EFE9] hover:bg-[#FAF9F5] cursor-pointer ${IMPORTANT.has(row.action) ? "bg-amber-50/40" : ""}`}
                      onClick={() => setExpanded(isOpen ? null : row.id)}
                    >
                      <td className="px-4 py-2.5 font-data-mono text-[#68645A] whitespace-nowrap">{formatTime(row.createdAt)}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold mr-1.5 ${ROLE_STYLE[row.actorRole] ?? ROLE_STYLE.system}`}>
                          {row.actorRole}
                        </span>
                        <span className="font-semibold text-[#1B1815]">{row.actorName ?? "—"}</span>
                      </td>
                      <td className="px-4 py-2.5 font-semibold text-[#1B1815] whitespace-nowrap">{row.actionLabel}</td>
                      <td className="px-4 py-2.5 text-[#68645A]">
                        {[row.ringName, row.categoryName].filter(Boolean).join(" · ") || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-[#1B1815]">
                        {summarize(row)}
                        {row.reason && <span className="block text-amber-800 font-semibold mt-0.5">Reason: {row.reason}</span>}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-[#FAF9F5]">
                        <td colSpan={5} className="px-4 py-3">
                          <div className="grid md:grid-cols-2 gap-3 font-data-mono text-[11px]">
                            <div>
                              <div className="font-bold text-[#68645A] mb-1">Before</div>
                              <pre className="whitespace-pre-wrap break-all bg-white border border-[#E1DDCF] rounded-lg p-2">
                                {JSON.stringify(row.before, null, 2) ?? "—"}
                              </pre>
                            </div>
                            <div>
                              <div className="font-bold text-[#68645A] mb-1">After</div>
                              <pre className="whitespace-pre-wrap break-all bg-white border border-[#E1DDCF] rounded-lg p-2">
                                {JSON.stringify(row.after, null, 2) ?? "—"}
                              </pre>
                            </div>
                          </div>
                          {row.matchId && <div className="mt-2 text-[11px] text-[#68645A]">Bout: {row.matchId}</div>}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {hasMore && (
          <div className="p-4 border-t border-[#F1EFE9] text-center">
            <button
              type="button"
              disabled={loading}
              onClick={() => void load({ ...filters, before: rows[rows.length - 1]?.createdAt ?? null }, true)}
              className="px-4 py-2 rounded-xl bg-[#FAF9F5] border border-[#E1DDCF] text-xs font-bold text-[#1B1815] disabled:opacity-50 cursor-pointer"
            >
              {loading ? "Loading…" : "Load older entries"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
