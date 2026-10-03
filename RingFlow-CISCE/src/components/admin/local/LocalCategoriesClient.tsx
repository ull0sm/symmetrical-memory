"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  assignDivisionToRing,
  buildAllStartingGroups,
  buildDivisionStartingGroups,
  createDivision,
  deleteDivision,
  generateDivisions,
  getStartingGroupsPreflight,
  setDivisionEvent,
  updateDivision,
} from "@/actions/divisions";
import type { DivisionView, EventView, LocalSetupView } from "@/lib/local/setupView";
import type { StartingGroupsPreflightItem } from "@/lib/local/startingGroups";
import { divisionName, generateDivisionShapes } from "@/lib/local/rules";
import type { DivisionSex } from "@/lib/statuses";

/**
 * The Local tournament's categories (divisions): each with its kumite and kata
 * plan, who takes part and its starting groups, and the tatami it runs on.
 * Stagers change the groups at the venue; this is the admin's starting point.
 */

type Modal =
  | { kind: "generate" }
  | { kind: "division"; division?: DivisionView }
  | { kind: "plan"; division: DivisionView; event: EventView }
  | { kind: "buildAll" }
  | null;

const EVENT_LABEL = { kumite: "Kumite", kata: "Kata" } as const;
const SEX_OPTIONS: { value: DivisionSex; label: string }[] = [
  { value: "M", label: "Male" },
  { value: "F", label: "Female" },
  { value: "any", label: "Mixed" },
];

function formatDuration(ms: number | null): string | null {
  if (ms === null) return null;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const btn = "px-3 py-2 border border-outline-variant rounded text-sm hover:bg-surface-container-low disabled:opacity-50 flex items-center gap-1.5";
const primaryBtn = "px-4 py-2 rounded text-sm bg-primary text-on-primary hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5";
const input = "h-10 px-3 border border-outline-variant rounded bg-surface-container-lowest text-sm focus:outline-none focus:ring-2 focus:ring-secondary/40";

export default function LocalCategoriesClient({
  tournamentId,
  setup,
  readOnly = false,
}: {
  tournamentId: string;
  setup: LocalSetupView;
  /** The organiser's view: everything visible, nothing changeable. */
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? setup.divisions.filter((d) => d.name.toLowerCase().includes(q)) : setup.divisions;
  }, [query, setup.divisions]);

  /** Runs an action, shows its refusal if any, and reloads the page's data. */
  const run = async (key: string, fn: () => Promise<{ success: boolean; error?: string } & Record<string, unknown>>) => {
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

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="p-4 sm:p-6 md:p-margin-desktop space-y-6 bg-surface pb-24 w-full">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <h2 className="font-headline-sm text-headline-sm text-primary">Categories</h2>
          <p className="text-body-sm text-on-surface-variant">
            {setup.divisions.length} categories · {setup.totalAthletes} athletes
            {setup.unassignedAthletes > 0 && !readOnly && (
              <>
                {" · "}
                <a href={`/admin/event/${tournamentId}/athletes?category=none`} className="text-secondary underline">
                  {setup.unassignedAthletes} without a category
                </a>
              </>
            )}
          </p>
        </div>
        {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <button className={btn} onClick={() => setModal({ kind: "generate" })}>
            <span className="material-symbols-outlined text-[18px]">auto_awesome</span> Generate categories
          </button>
          <button className={btn} onClick={() => setModal({ kind: "division" })}>
            <span className="material-symbols-outlined text-[18px]">add</span> Add category
          </button>
          <button className={primaryBtn} onClick={() => setModal({ kind: "buildAll" })} disabled={setup.divisions.length === 0}>
            <span className="material-symbols-outlined text-[18px]">group_work</span> Build starting groups
          </button>
        </div>
        )}
      </div>

      {setup.divisions.length > 0 && (
        <input className={`${input} w-full max-w-sm`} placeholder="Search categories" value={query} onChange={(e) => setQuery(e.target.value)} />
      )}

      {setup.divisions.length === 0 ? (
        <div className="border border-dashed border-outline-variant rounded-xl p-10 text-center space-y-2">
          <p className="font-semibold text-primary">Set up your categories</p>
          <p className="text-sm text-on-surface-variant max-w-md mx-auto">
            Generate a category for every age, belt and sex you run, or add them one at a time. Then import athletes and build the starting groups.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((d) => (
            <DivisionRow
              key={d.id}
              division={d}
              rings={setup.rings}
              readOnly={readOnly}
              open={expanded.has(d.id)}
              busy={busy}
              onToggle={() => toggle(d.id)}
              onEdit={() => setModal({ kind: "division", division: d })}
              onPlan={(event) => setModal({ kind: "plan", division: d, event })}
              onDelete={() => {
                if (confirm(`Delete "${d.name}"? Its athletes stay in the roster without a category.`)) {
                  void run(`del:${d.id}`, () => deleteDivision(d.id));
                }
              }}
              onBuild={() => {
                const hasGroups = d.events.some((e) => e.groups.length > 0);
                if (!hasGroups || confirm(`Rebuild "${d.name}"'s starting groups? The current groups are replaced.`)) {
                  void run(`build:${d.id}`, () => buildDivisionStartingGroups(d.id));
                }
              }}
              onAssign={(ringId) => void run(`ring:${d.id}`, () => assignDivisionToRing(d.id, ringId))}
              onToggleEvent={(event) => void run(`ev:${event.id}`, () => setDivisionEvent(event.id, { enabled: !event.enabled }))}
            />
          ))}
          {visible.length === 0 && <p className="text-sm text-on-surface-variant">No category matches “{query}”.</p>}
        </div>
      )}

      {modal?.kind === "generate" && (
        <GenerateModal
          beltLevels={setup.settings.beltLevels}
          onClose={() => setModal(null)}
          onSubmit={async (spec) => {
            const res = await run("generate", () => generateDivisions(tournamentId, spec));
            if (res?.success) {
              const created = (res as { created?: string[] }).created?.length ?? 0;
              const skipped = (res as { skipped?: string[] }).skipped?.length ?? 0;
              alert(`${created} categories created${skipped ? `, ${skipped} already existed` : ""}.`);
              setModal(null);
            }
          }}
        />
      )}
      {modal?.kind === "division" && (
        <DivisionModal
          division={modal.division}
          beltLevels={setup.settings.beltLevels}
          onClose={() => setModal(null)}
          onSubmit={async (input) => {
            const res = modal.division
              ? await run("division", () => updateDivision(modal.division!.id, input))
              : await run("division", () => createDivision(tournamentId, input));
            if (res?.success) setModal(null);
          }}
        />
      )}
      {modal?.kind === "plan" && (
        <PlanModal
          division={modal.division}
          event={modal.event}
          onClose={() => setModal(null)}
          onSubmit={async (plan) => {
            const res = await run("plan", () => setDivisionEvent(modal.event.id, plan));
            if (res?.success) setModal(null);
          }}
        />
      )}
      {modal?.kind === "buildAll" && (
        <BuildAllModal
          tournamentId={tournamentId}
          onClose={() => setModal(null)}
          onBuilt={() => router.refresh()}
        />
      )}
    </div>
  );
}

function DivisionRow(props: {
  division: DivisionView;
  readOnly: boolean;
  rings: { id: string; name: string }[];
  open: boolean;
  busy: string | null;
  onToggle: () => void;
  onEdit: () => void;
  onPlan: (event: EventView) => void;
  onDelete: () => void;
  onBuild: () => void;
  onAssign: (ringId: string | null) => void;
  onToggleEvent: (event: EventView) => void;
}) {
  const { division: d } = props;
  const groupCount = d.events.reduce((n, e) => n + e.groups.length, 0);
  const ringValue = d.ringIds.length === 1 ? d.ringIds[0] : d.ringIds.length > 1 ? "__several" : "";
  const eventSummary = d.events
    .filter((e) => e.enabled)
    .map((e) => `${EVENT_LABEL[e.eventType]} ${e.participants}`)
    .join(" · ");

  return (
    <div className="border border-outline-variant rounded-xl bg-surface-container-lowest">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <button onClick={props.onToggle} className="flex items-center gap-2 flex-1 min-w-[220px] text-left" aria-expanded={props.open}>
          <span className="material-symbols-outlined text-on-surface-variant">{props.open ? "expand_less" : "expand_more"}</span>
          <span>
            <span className="block font-semibold text-primary">{d.name}</span>
            <span className="block text-xs text-on-surface-variant">
              {d.athletes} athletes{eventSummary && ` · ${eventSummary}`} · {groupCount ? `${groupCount} groups` : "no groups yet"}
              {d.holder && <span className="ml-2 px-1.5 py-0.5 rounded bg-secondary-fixed text-on-secondary-fixed">With {d.holder}</span>}
            </span>
          </span>
        </button>
        {props.readOnly ? (
          <span className="text-xs text-on-surface-variant">
            {d.ringIds.length === 0 ? "No tatami" : d.ringIds.map((id) => props.rings.find((r) => r.id === id)?.name).join(", ")}
          </span>
        ) : (
        <>
        <label className="flex items-center gap-2 text-xs text-on-surface-variant">
          Tatami
          <select
            className={`${input} h-9`}
            value={ringValue}
            disabled={props.busy === `ring:${d.id}`}
            onChange={(e) => props.onAssign(e.target.value === "" ? null : e.target.value)}
          >
            <option value="">None</option>
            {d.ringIds.length > 1 && (
              <option value="__several" disabled>
                Several tatamis
              </option>
            )}
            {props.rings.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <button className={btn} onClick={props.onBuild} disabled={props.busy === `build:${d.id}`} title="Build or rebuild the starting groups">
          <span className="material-symbols-outlined text-[18px]">group_work</span>
          {props.busy === `build:${d.id}` ? "Building…" : groupCount ? "Rebuild groups" : "Build groups"}
        </button>
        <button className={btn} onClick={props.onEdit} aria-label={`Edit ${d.name}`}>
          <span className="material-symbols-outlined text-[18px]">edit</span>
        </button>
        <button className={btn} onClick={props.onDelete} aria-label={`Delete ${d.name}`}>
          <span className="material-symbols-outlined text-[18px]">delete</span>
        </button>
        </>
        )}
      </div>

      {props.open && (
        <div className="grid md:grid-cols-2 gap-4 p-4 border-t border-outline-variant">
          {d.events.map((e) => (
            <EventPanel
              key={e.id}
              event={e}
              readOnly={props.readOnly}
              busy={props.busy === `ev:${e.id}`}
              onPlan={() => props.onPlan(e)}
              onToggle={() => props.onToggleEvent(e)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EventPanel({
  event: e,
  readOnly,
  busy,
  onPlan,
  onToggle,
}: {
  event: EventView;
  readOnly: boolean;
  busy: boolean;
  onPlan: () => void;
  onToggle: () => void;
}) {
  const duration = e.eventType === "kumite" ? formatDuration(e.effective.boutDurationMs) : null;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-label-caps text-label-caps text-secondary">{EVENT_LABEL[e.eventType]}</span>
        <label className="flex items-center gap-2 text-xs text-on-surface-variant cursor-pointer">
          <input type="checkbox" checked={e.enabled} disabled={busy || readOnly} onChange={onToggle} />
          Held in this category
        </label>
      </div>
      {!e.enabled ? (
        <p className="text-sm text-on-surface-variant">Not held.</p>
      ) : (
        <>
          <p className="text-sm">
            {e.participants} taking part{e.away > 0 && ` · ${e.away} away`}
            <span className="text-on-surface-variant">
              {" "}
              · groups of {e.effective.groupSize} · {e.effective.bronzeMedals} bronze{e.effective.bronzeMedals > 1 ? "s" : ""}
              {duration && ` · ${duration} bouts`}
            </span>{" "}
            {!readOnly && (
              <button className="text-secondary underline text-xs" onClick={onPlan}>
                Change plan
              </button>
            )}
          </p>
          {e.groups.length === 0 ? (
            <p className="text-xs text-on-surface-variant">
              No groups yet{e.plannedSizes.length > 0 && ` · the plan makes ${e.plannedSizes.join(" + ")}`}
            </p>
          ) : (
            <ul className="space-y-2">
              {e.groups.map((g) => (
                <li key={g.id} className="rounded border border-outline-variant p-2.5">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-semibold">Group {g.groupNo}</span>
                    <span className="text-on-surface-variant">{g.size} athletes</span>
                    {g.locked && <span className="text-xs px-1.5 py-0.5 rounded bg-surface-container">Locked</span>}
                    <span className="ml-auto text-xs text-on-surface-variant">{g.ringName ?? "No tatami"}</span>
                  </div>
                  {g.members.length > 0 && (
                    <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">{g.members.map((m) => m.name).join(", ")}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function ModalShell({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="bg-surface-container-lowest rounded-xl w-full max-w-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-outline-variant">
          <h3 className="font-semibold text-primary">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="material-symbols-outlined text-on-surface-variant">
            close
          </button>
        </div>
        <div className="p-5 overflow-y-auto space-y-4">{children}</div>
        <div className="p-4 border-t border-outline-variant flex justify-end gap-2">{footer}</div>
      </div>
    </div>
  );
}

function BeltPicker({ beltLevels, value, onChange }: { beltLevels: string[]; value: string[]; onChange: (belts: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {beltLevels.map((b) => {
        const on = value.includes(b);
        return (
          <button
            key={b}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== b) : beltLevels.filter((x) => x === b || value.includes(x)))}
            className={`px-3 py-1.5 rounded-full border text-sm ${on ? "border-secondary bg-secondary-fixed text-on-secondary-fixed" : "border-outline-variant"}`}
          >
            {b}
          </button>
        );
      })}
    </div>
  );
}

const numberOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

function DivisionModal({
  division,
  beltLevels,
  onClose,
  onSubmit,
}: {
  division?: DivisionView;
  beltLevels: string[];
  onClose: () => void;
  onSubmit: (input: { name: string | null; sex: DivisionSex; ageMin: number | null; ageMax: number | null; belts: string[]; kumite?: boolean; kata?: boolean }) => Promise<void>;
}) {
  const [name, setName] = useState(division?.name ?? "");
  const [sex, setSex] = useState<DivisionSex>((division?.sex as DivisionSex) ?? "M");
  const [ageMin, setAgeMin] = useState(division?.ageMin?.toString() ?? "");
  const [ageMax, setAgeMax] = useState(division?.ageMax?.toString() ?? "");
  const [belts, setBelts] = useState<string[]>(division?.belts ?? []);
  const [kumite, setKumite] = useState(true);
  const [kata, setKata] = useState(true);
  const [saving, setSaving] = useState(false);
  const auto = divisionName({ sex, ageMin: numberOrNull(ageMin), ageMax: numberOrNull(ageMax), belts });

  return (
    <ModalShell
      title={division ? "Edit category" : "Add category"}
      onClose={onClose}
      footer={
        <>
          <button className={btn} onClick={onClose}>
            Cancel
          </button>
          <button
            className={primaryBtn}
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              await onSubmit({ name: name.trim() || null, sex, ageMin: numberOrNull(ageMin), ageMax: numberOrNull(ageMax), belts, ...(division ? {} : { kumite, kata }) });
              setSaving(false);
            }}
          >
            {division ? "Save" : "Add category"}
          </button>
        </>
      }
    >
      <label className="block space-y-1">
        <span className="text-xs text-on-surface-variant">Name (leave empty for “{auto}”)</span>
        <input className={`${input} w-full`} value={name} placeholder={auto} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="grid grid-cols-3 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-on-surface-variant">Sex</span>
          <select className={`${input} w-full`} value={sex} onChange={(e) => setSex(e.target.value as DivisionSex)}>
            {SEX_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs text-on-surface-variant">Youngest age</span>
          <input className={`${input} w-full`} inputMode="numeric" value={ageMin} onChange={(e) => setAgeMin(e.target.value.replace(/\D/g, ""))} />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-on-surface-variant">Oldest age</span>
          <input className={`${input} w-full`} inputMode="numeric" value={ageMax} onChange={(e) => setAgeMax(e.target.value.replace(/\D/g, ""))} />
        </label>
      </div>
      <div className="space-y-1">
        <span className="text-xs text-on-surface-variant">Belts (none chosen means any belt)</span>
        <BeltPicker beltLevels={beltLevels} value={belts} onChange={setBelts} />
      </div>
      {!division && (
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={kumite} onChange={(e) => setKumite(e.target.checked)} /> Kumite
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={kata} onChange={(e) => setKata(e.target.checked)} /> Kata
          </label>
        </div>
      )}
      {division && <p className="text-xs text-on-surface-variant">Changing ages or belts doesn&apos;t move athletes. Move them on the Athletes page.</p>}
    </ModalShell>
  );
}

function GenerateModal({
  beltLevels,
  onClose,
  onSubmit,
}: {
  beltLevels: string[];
  onClose: () => void;
  onSubmit: (spec: { ages: { min: number | null; max: number | null }[]; beltBands: string[][]; sexes: DivisionSex[] }) => Promise<void>;
}) {
  const [from, setFrom] = useState("6");
  const [to, setTo] = useState("14");
  const [band, setBand] = useState(1);
  const [belts, setBelts] = useState<string[]>(beltLevels);
  const [together, setTogether] = useState(false);
  const [sexes, setSexes] = useState<DivisionSex[]>(["M", "F"]);
  const [saving, setSaving] = useState(false);

  const spec = useMemo(() => {
    const lo = Number(from);
    const hi = Number(to);
    const ages: { min: number; max: number }[] = [];
    if (Number.isInteger(lo) && Number.isInteger(hi) && lo <= hi && hi - lo < 60) {
      for (let a = lo; a <= hi; a += band) ages.push({ min: a, max: Math.min(hi, a + band - 1) });
    }
    const beltBands = belts.length === 0 ? [[]] : together ? [belts] : belts.map((b) => [b]);
    return { ages, beltBands, sexes };
  }, [from, to, band, belts, together, sexes]);
  const shapes = generateDivisionShapes(spec);

  return (
    <ModalShell
      title="Generate categories"
      onClose={onClose}
      footer={
        <>
          <button className={btn} onClick={onClose}>
            Cancel
          </button>
          <button
            className={primaryBtn}
            disabled={saving || shapes.length === 0 || shapes.length > 500}
            onClick={async () => {
              setSaving(true);
              await onSubmit(spec);
              setSaving(false);
            }}
          >
            Create {shapes.length} categories
          </button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-on-surface-variant">Ages from</span>
          <input className={`${input} w-full`} inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value.replace(/\D/g, ""))} />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-on-surface-variant">to</span>
          <input className={`${input} w-full`} inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value.replace(/\D/g, ""))} />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-on-surface-variant">Each category covers</span>
          <select className={`${input} w-full`} value={band} onChange={(e) => setBand(Number(e.target.value))}>
            <option value={1}>1 year</option>
            <option value={2}>2 years</option>
            <option value={3}>3 years</option>
          </select>
        </label>
      </div>
      <div className="space-y-2">
        <span className="text-xs text-on-surface-variant">Belts</span>
        <BeltPicker beltLevels={beltLevels} value={belts} onChange={setBelts} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={together} onChange={(e) => setTogether(e.target.checked)} /> Put the chosen belts together in one category
        </label>
      </div>
      <div className="flex gap-4 text-sm">
        {SEX_OPTIONS.map((o) => (
          <label key={o.value} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={sexes.includes(o.value)}
              onChange={(e) => setSexes(e.target.checked ? [...sexes, o.value] : sexes.filter((s) => s !== o.value))}
            />
            {o.label}
          </label>
        ))}
      </div>
      <div className="rounded bg-surface-container-low p-3 text-sm">
        <p className="font-semibold">{shapes.length} categories</p>
        <p className="text-xs text-on-surface-variant mt-1">
          {shapes.slice(0, 6).map((s) => divisionName(s)).join(", ")}
          {shapes.length > 6 && `, and ${shapes.length - 6} more`}
        </p>
        <p className="text-xs text-on-surface-variant mt-1">Categories that already exist are skipped. Delete the empty ones after importing athletes.</p>
      </div>
    </ModalShell>
  );
}

function PlanModal({
  division,
  event,
  onClose,
  onSubmit,
}: {
  division: DivisionView;
  event: EventView;
  onClose: () => void;
  onSubmit: (plan: { groupSize: number | null; bronzeMedals: 1 | 2 | null; boutDurationMs: number | null }) => Promise<void>;
}) {
  const [groupSize, setGroupSize] = useState(event.plan.groupSize?.toString() ?? "");
  const [bronze, setBronze] = useState(event.plan.bronzeMedals?.toString() ?? "");
  const [duration, setDuration] = useState(event.plan.boutDurationMs?.toString() ?? "");
  const [saving, setSaving] = useState(false);

  return (
    <ModalShell
      title={`${division.name} · ${EVENT_LABEL[event.eventType]} plan`}
      onClose={onClose}
      footer={
        <>
          <button className={btn} onClick={onClose}>
            Cancel
          </button>
          <button
            className={primaryBtn}
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              await onSubmit({
                groupSize: numberOrNull(groupSize),
                bronzeMedals: bronze === "" ? null : (Number(bronze) as 1 | 2),
                boutDurationMs: numberOrNull(duration),
              });
              setSaving(false);
            }}
          >
            Save plan
          </button>
        </>
      }
    >
      <label className="block space-y-1">
        <span className="text-xs text-on-surface-variant">Athletes per group (empty uses the tournament default)</span>
        <input className={`${input} w-full`} inputMode="numeric" value={groupSize} onChange={(e) => setGroupSize(e.target.value.replace(/\D/g, ""))} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-on-surface-variant">Bronzes</span>
        <select className={`${input} w-full`} value={bronze} onChange={(e) => setBronze(e.target.value)}>
          <option value="">Tournament default</option>
          <option value="2">2 bronzes</option>
          <option value="1">1 bronze</option>
        </select>
      </label>
      {event.eventType === "kumite" && (
        <label className="block space-y-1">
          <span className="text-xs text-on-surface-variant">Bout length</span>
          <select className={`${input} w-full`} value={duration} onChange={(e) => setDuration(e.target.value)}>
            <option value="">Tournament default</option>
            {[60, 90, 120, 150, 180].map((s) => (
              <option key={s} value={s * 1000}>
                {formatDuration(s * 1000)}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="text-xs text-on-surface-variant">A new plan shapes the next build of the starting groups. Existing groups stay as they are.</p>
    </ModalShell>
  );
}

function BuildAllModal({ tournamentId, onClose, onBuilt }: { tournamentId: string; onClose: () => void; onBuilt: () => void }) {
  const [items, setItems] = useState<StartingGroupsPreflightItem[] | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);

  React.useEffect(() => {
    getStartingGroupsPreflight(tournamentId)
      .then(setItems)
      .catch((err: unknown) => setResult(err instanceof Error ? err.message : "Could not check the categories."));
  }, [tournamentId]);

  const toBuild = items?.filter((i) => i.action === "BUILD") ?? [];
  const held = items?.filter((i) => i.action === "PROTECT") ?? [];
  const skipped = items?.filter((i) => i.action === "SKIP") ?? [];

  return (
    <ModalShell
      title="Build starting groups"
      onClose={onClose}
      footer={
        <>
          <button className={btn} onClick={onClose}>
            {result ? "Close" : "Cancel"}
          </button>
          {!result && (
            <button
              className={primaryBtn}
              disabled={building || toBuild.length === 0}
              onClick={async () => {
                setBuilding(true);
                try {
                  const res = await buildAllStartingGroups(tournamentId);
                  setResult(
                    res.success
                      ? `${res.built} events built.${res.errors.length ? ` Not built: ${res.errors.join("; ")}` : ""}`
                      : res.error
                  );
                  onBuilt();
                } finally {
                  setBuilding(false);
                }
              }}
            >
              {building ? "Building…" : `Build ${toBuild.length} events`}
            </button>
          )}
        </>
      }
    >
      {result ? (
        <p className="text-sm">{result}</p>
      ) : items === null ? (
        <p className="text-sm text-on-surface-variant">Checking categories…</p>
      ) : (
        <>
          <p className="text-sm text-on-surface-variant">
            Each event is split into groups by its plan, with clubs spread across the groups. Absent athletes are left out. Stagers can change everything at the venue.
          </p>
          <PreflightList title="Will be built" items={toBuild} />
          <PreflightList title="Left as they are" items={held} />
          <PreflightList title="Skipped" items={skipped} />
        </>
      )}
    </ModalShell>
  );
}

function PreflightList({ title, items }: { title: string; items: StartingGroupsPreflightItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-on-surface-variant">
        {title} ({items.length})
      </p>
      <ul className="text-sm divide-y divide-outline-variant border border-outline-variant rounded">
        {items.map((i) => (
          <li key={i.divisionEventId} className="px-3 py-2 flex flex-wrap gap-x-2">
            <span className="font-medium">
              {i.name} · {EVENT_LABEL[i.eventType]}
            </span>
            <span className="text-on-surface-variant">
              {i.action === "BUILD" ? `${i.participants} athletes → ${i.plannedSizes.join(" + ")}` : i.reason}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
