"use client";

import React, { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import {
  addLocalAthlete,
  assignAthleteDivision,
  deleteLocalAthlete,
  importLocalRoster,
  setAthleteParticipationAdmin,
} from "@/actions/localAthletes";
import type { LocalAthleteView } from "@/lib/local/setupView";
import type { LocalImportReport } from "@/lib/local/localRoster";

/**
 * A Local tournament's roster: every athlete with their one category and whether
 * they do kumite, kata or both. Imported from a sheet or added by hand; athletes
 * are matched to a category by age, belt and sex.
 */

interface Props {
  tournamentId: string;
  athletes: LocalAthleteView[];
  divisions: { id: string; name: string }[];
  beltLevels: string[];
  initialFilter: string;
  /** The organiser's view: the roster without any way to change it. */
  readOnly?: boolean;
}

const btn = "px-3 py-2 border border-outline-variant rounded text-sm hover:bg-surface-container-low disabled:opacity-50 flex items-center gap-1.5";
const primaryBtn = "px-4 py-2 rounded text-sm bg-primary text-on-primary hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5";
const input = "h-10 px-3 border border-outline-variant rounded bg-surface-container-lowest text-sm focus:outline-none focus:ring-2 focus:ring-secondary/40";

/** Sheet header to field, ignoring case, spaces and punctuation. */
const HEADERS: Record<string, keyof RowShape> = {
  name: "name", athletename: "name", athlete: "name", fullname: "name",
  chest: "chestNumber", chestno: "chestNumber", chestnumber: "chestNumber", no: "chestNumber", number: "chestNumber", bib: "chestNumber",
  club: "club", dojo: "club", school: "club", team: "club",
  age: "age",
  belt: "belt", rank: "belt", beltrank: "belt",
  sex: "sex", gender: "sex",
  kumite: "kumite",
  kata: "kata",
};
type RowShape = { name?: string; chestNumber?: string; club?: string; age?: string; belt?: string; sex?: string; kumite?: string; kata?: string };

function toRows(sheet: Record<string, unknown>[]): RowShape[] {
  return sheet.map((raw) => {
    const row: RowShape = {};
    for (const [header, value] of Object.entries(raw)) {
      const field = HEADERS[header.toLowerCase().replace(/[^a-z]/g, "")];
      if (field && value !== null && value !== undefined) row[field] = String(value);
    }
    return row;
  });
}

export default function LocalAthletesClient({ tournamentId, athletes, divisions, beltLevels, initialFilter, readOnly = false }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(initialFilter);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<LocalImportReport | null>(null);

  const divisionName = useMemo(() => new Map(divisions.map((d) => [d.id, d.name])), [divisions]);
  const unassigned = athletes.filter((a) => !a.divisionId).length;
  const toReview = athletes.filter((a) => a.needsReview).length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return athletes.filter((a) => {
      if (filter === "none" && a.divisionId) return false;
      if (filter !== "all" && filter !== "none" && a.divisionId !== filter) return false;
      if (!q) return true;
      return [a.name, a.chestNumber, a.club].some((v) => v?.toLowerCase().includes(q));
    });
  }, [athletes, filter, query]);

  const run = async (key: string, fn: () => Promise<{ success: boolean; error?: string }>) => {
    setBusy(key);
    try {
      const res = await fn();
      if (!res.success) alert(res.error ?? "That didn't work.");
      router.refresh();
      return res;
    } catch (err) {
      alert(err instanceof Error ? err.message : "That didn't work.");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const book = XLSX.read(await file.arrayBuffer());
      const sheet = book.Sheets[book.SheetNames[0] as string];
      const rows = toRows(XLSX.utils.sheet_to_json(sheet as XLSX.WorkSheet) as Record<string, unknown>[]).filter((r) => r.name?.trim());
      if (rows.length === 0) {
        alert("No athletes found. The sheet needs a Name column; Chest, Club, Age, Belt, Sex, Kumite and Kata are optional.");
        return;
      }
      if (!confirm(`Import ${rows.length} athletes from ${file.name}?`)) return;
      setBusy("import");
      const res = await importLocalRoster(tournamentId, rows);
      if (res.success) setReport(res.report);
      else alert(res.error);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not read that file.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-4 sm:p-6 md:p-margin-desktop space-y-6 bg-surface pb-24 w-full">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <h2 className="font-headline-sm text-headline-sm text-primary">Athletes</h2>
          <p className="text-body-sm text-on-surface-variant">
            {athletes.length} athletes · {unassigned} without a category{toReview > 0 && ` · ${toReview} walk-ins to review`}
          </p>
        </div>
        {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />
          <button className={btn} onClick={() => fileRef.current?.click()} disabled={busy === "import"}>
            <span className="material-symbols-outlined text-[18px]">upload</span> {busy === "import" ? "Importing…" : "Import sheet"}
          </button>
          <button className={primaryBtn} onClick={() => setAdding(true)}>
            <span className="material-symbols-outlined text-[18px]">person_add</span> Add athlete
          </button>
        </div>
        )}
      </div>

      {report && <ImportReport report={report} onClose={() => setReport(null)} />}

      <div className="flex flex-wrap gap-2">
        <input className={`${input} w-full sm:w-72`} placeholder="Search name, chest number or club" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className={input} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by category">
          <option value="all">All categories</option>
          <option value="none">Without a category ({unassigned})</option>
          {divisions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto border border-outline-variant rounded-xl bg-surface-container-lowest">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-on-surface-variant border-b border-outline-variant">
            <tr>
              <th className="px-3 py-2">Chest</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Club</th>
              <th className="px-3 py-2">Age</th>
              <th className="px-3 py-2">Belt</th>
              <th className="px-3 py-2">Sex</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2 text-center">Kumite</th>
              <th className="px-3 py-2 text-center">Kata</th>
              <th className="px-3 py-2">Groups</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant">
            {visible.map((a) => (
              <tr key={a.id} className={a.divisionId ? "" : "bg-error-container/30"}>
                <td className="px-3 py-2 tabular-nums">{a.chestNumber}</td>
                <td className="px-3 py-2 font-medium">
                  {a.name}
                  {a.walkIn && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-surface-container">Walk-in</span>}
                </td>
                <td className="px-3 py-2">{a.club}</td>
                <td className="px-3 py-2">{a.age}</td>
                <td className="px-3 py-2">{a.belt}</td>
                <td className="px-3 py-2">{a.sex}</td>
                <td className="px-3 py-2">
                  {readOnly ? (
                    (a.divisionId && divisionName.get(a.divisionId)) ?? "None"
                  ) : (
                  <select
                    className={`${input} h-8 max-w-[220px]`}
                    value={a.divisionId ?? ""}
                    disabled={busy === `div:${a.id}`}
                    aria-label={`Category for ${a.name}`}
                    onChange={(e) => void run(`div:${a.id}`, () => assignAthleteDivision(tournamentId, a.id, e.target.value || null))}
                  >
                    <option value="">None</option>
                    {divisions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                  )}
                </td>
                {(["kumite", "kata"] as const).map((ev) => (
                  <td key={ev} className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={a[ev]}
                      disabled={readOnly || busy === `${ev}:${a.id}`}
                      aria-label={`${a.name} does ${ev}`}
                      onChange={(e) => void run(`${ev}:${a.id}`, () => setAthleteParticipationAdmin(tournamentId, a.id, ev, e.target.checked))}
                    />
                  </td>
                ))}
                <td className="px-3 py-2 text-xs text-on-surface-variant">
                  {a.groups.map((g) => `${g.eventType === "kata" ? "Kata" : "Kumite"} G${g.groupNo ?? ""}`).join(", ")}
                </td>
                <td className="px-3 py-2 text-right">
                  {!readOnly && (
                  <button
                    className="material-symbols-outlined text-on-surface-variant hover:text-error"
                    aria-label={`Delete ${a.name}`}
                    onClick={() => {
                      if (confirm(`Delete ${a.name}?`)) void run(`del:${a.id}`, () => deleteLocalAthlete(tournamentId, a.id));
                    }}
                  >
                    delete
                  </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && (
          <p className="p-6 text-sm text-on-surface-variant text-center">
            {athletes.length === 0 ? "No athletes yet. Import a sheet or add them one at a time." : "Nobody matches."}
          </p>
        )}
      </div>

      {adding && (
        <AddAthleteModal
          divisions={divisions}
          beltLevels={beltLevels}
          divisionName={divisionName}
          onClose={() => setAdding(false)}
          onSubmit={async (input) => {
            const res = await run("add", () => addLocalAthlete(tournamentId, input));
            if (res?.success) setAdding(false);
          }}
        />
      )}
    </div>
  );
}

function ImportReport({ report, onClose }: { report: LocalImportReport; onClose: () => void }) {
  const lists: [string, string[]][] = [
    ["Without a category", report.unassigned.map((u) => `${u.name} (${u.reason})`)],
    ["Fit more than one category (put in the first)", report.ambiguous.map((a) => `${a.name} → ${a.category}`)],
    ["Kept in their category (already in a group)", report.keptCategory.map((k) => `${k.name} → ${k.category}`)],
    ["Possible duplicates (same name and club, no chest number)", report.possibleDuplicates.map((d) => `${d.name}${d.club ? `, ${d.club}` : ""}`)],
  ];
  return (
    <div className="border border-outline-variant rounded-xl p-4 bg-surface-container-lowest space-y-2">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm">
          <span className="font-semibold">Imported {report.total} athletes:</span> {report.created} new, {report.updated} updated, {report.assigned} in a category.
        </p>
        <button onClick={onClose} aria-label="Close the import report" className="material-symbols-outlined text-on-surface-variant">
          close
        </button>
      </div>
      {lists
        .filter(([, items]) => items.length > 0)
        .map(([title, items]) => (
          <details key={title} className="text-sm">
            <summary className="cursor-pointer text-on-surface-variant">
              {title}: {items.length}
            </summary>
            <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">{items.join(", ")}</p>
          </details>
        ))}
    </div>
  );
}

function AddAthleteModal({
  divisions,
  beltLevels,
  divisionName,
  onClose,
  onSubmit,
}: {
  divisions: { id: string; name: string }[];
  beltLevels: string[];
  divisionName: Map<string, string>;
  onClose: () => void;
  onSubmit: (input: {
    name: string;
    chestNumber: string | null;
    club: string | null;
    age: string | null;
    belt: string | null;
    sex: string | null;
    divisionId: string | null;
    kumite: boolean;
    kata: boolean;
  }) => Promise<void>;
}) {
  const [form, setForm] = useState({ name: "", chestNumber: "", club: "", age: "", belt: "", sex: "", divisionId: "auto", kumite: true, kata: true });
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const field = (label: string, el: React.ReactNode) => (
    <label className="block space-y-1">
      <span className="text-xs text-on-surface-variant">{label}</span>
      {el}
    </label>
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label="Add athlete">
      <div className="bg-surface-container-lowest rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-outline-variant">
          <h3 className="font-semibold text-primary">Add athlete</h3>
          <button onClick={onClose} aria-label="Close" className="material-symbols-outlined text-on-surface-variant">
            close
          </button>
        </div>
        <div className="p-5 space-y-3">
          {field("Name", <input className={`${input} w-full`} value={form.name} onChange={(e) => set({ name: e.target.value })} autoFocus />)}
          <div className="grid grid-cols-2 gap-3">
            {field("Chest number (empty to assign the next)", <input className={`${input} w-full`} value={form.chestNumber} onChange={(e) => set({ chestNumber: e.target.value })} />)}
            {field("Club", <input className={`${input} w-full`} value={form.club} onChange={(e) => set({ club: e.target.value })} />)}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {field("Age", <input className={`${input} w-full`} inputMode="numeric" value={form.age} onChange={(e) => set({ age: e.target.value.replace(/\D/g, "") })} />)}
            {field(
              "Belt",
              <select className={`${input} w-full`} value={form.belt} onChange={(e) => set({ belt: e.target.value })}>
                <option value="">Unknown</option>
                {beltLevels.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            )}
            {field(
              "Sex",
              <select className={`${input} w-full`} value={form.sex} onChange={(e) => set({ sex: e.target.value })}>
                <option value="">Unknown</option>
                <option value="M">Male</option>
                <option value="F">Female</option>
              </select>
            )}
          </div>
          {field(
            "Category",
            <select className={`${input} w-full`} value={form.divisionId} onChange={(e) => set({ divisionId: e.target.value })}>
              <option value="auto">Match by age, belt and sex</option>
              <option value="">None for now</option>
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>
                  {divisionName.get(d.id)}
                </option>
              ))}
            </select>
          )}
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.kumite} onChange={(e) => set({ kumite: e.target.checked })} /> Kumite
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.kata} onChange={(e) => set({ kata: e.target.checked })} /> Kata
            </label>
          </div>
        </div>
        <div className="p-4 border-t border-outline-variant flex justify-end gap-2">
          <button className={btn} onClick={onClose}>
            Cancel
          </button>
          <button
            className={primaryBtn}
            disabled={saving || !form.name.trim()}
            onClick={async () => {
              setSaving(true);
              const empty = (v: string) => (v.trim() === "" ? null : v.trim());
              await onSubmit({
                name: form.name.trim(),
                chestNumber: empty(form.chestNumber),
                club: empty(form.club),
                age: empty(form.age),
                belt: empty(form.belt),
                sex: empty(form.sex),
                divisionId: form.divisionId === "" ? null : form.divisionId,
                kumite: form.kumite,
                kata: form.kata,
              });
              setSaving(false);
            }}
          >
            Add athlete
          </button>
        </div>
      </div>
    </div>
  );
}
