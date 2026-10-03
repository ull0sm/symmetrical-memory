"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getStagerDesk, searchDeskAthletes, takeDivision } from "@/actions/staging";
import { useLiveEvents } from "@/hooks/useLiveEvents";
import { useFallbackPoll } from "@/hooks/useFallbackPoll";
import type { DeskItem } from "@/lib/local/stagingView";
import { EVENT_LABEL, statusPill, tatamiLine } from "./format";

/**
 * The Local stager desk: every category of the tournament, soonest first, and
 * the one in your hands at the top. A stager takes one category at a time,
 * builds and locks its groups in the workspace, and the category leaves their
 * hands once every group is sent.
 */

export type DeskData = Awaited<ReturnType<typeof getStagerDesk>>;
type SearchHit = Awaited<ReturnType<typeof searchDeskAthletes>>[number];

export default function StagerDeskClient({
  tournamentId,
  initialDesk,
  notice,
}: {
  tournamentId: string;
  initialDesk: DeskData;
  /** A one-off message from the workspace: everything sent, or the category left your hands. */
  notice?: { text: string; tone: "ok" | "warn" } | null;
}) {
  const router = useRouter();
  const [desk, setDesk] = useState(initialDesk);
  const [ring, setRing] = useState<string>("all");
  const [showFinished, setShowFinished] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ divisionId: string; text: string } | null>(null);
  const [banner, setBanner] = useState(notice ?? null);
  const [highlight, setHighlight] = useState<string | null>(null);

  // The message is shown once: a reload shouldn't bring it back.
  useEffect(() => {
    if (notice) window.history.replaceState(null, "", window.location.pathname);
  }, [notice]);

  const seq = useRef(0);
  const refresh = useCallback(async () => {
    const n = ++seq.current;
    try {
      const next = await getStagerDesk(tournamentId);
      if (n === seq.current) setDesk(next);
    } catch (err) {
      console.error("Couldn't refresh the desk:", err);
    }
  }, [tournamentId]);
  const { connected } = useLiveEvents({ tournamentId }, () => void refresh(), { feed: "staff", debounceMs: 400 });
  useFallbackPoll(refresh, connected);

  const workspaceHref = (divisionId: string) => `/stager/event/${tournamentId}/category/${divisionId}`;
  const mine = desk.items.find((i) => i.isMine) ?? null;

  const ringsInUse = useMemo(() => {
    const used = new Set(desk.items.map((i) => i.tatami?.ringId ?? "none"));
    return { rings: desk.rings.filter((r) => used.has(r.id)), none: used.has("none") };
  }, [desk]);

  const visible = desk.items.filter((i) => !i.isMine && (ring === "all" || (i.tatami?.ringId ?? "none") === ring));
  // What still needs a stager first (soonest first, as the server sorts), then what is sent, then
  // categories nobody entered.
  const stage = (i: DeskItem) => (i.athletes === 0 ? 2 : i.status === "sent" ? 1 : 0);
  const open = visible.filter((i) => i.status !== "done").sort((a, b) => stage(a) - stage(b));
  const finished = visible.filter((i) => i.status === "done");

  async function take(item: DeskItem) {
    setBusy(item.divisionId);
    setProblem(null);
    try {
      const res = await takeDivision(item.divisionId);
      if (!res.success) {
        setProblem({ divisionId: item.divisionId, text: res.error });
        await refresh();
        return;
      }
      router.push(workspaceHref(item.divisionId));
    } catch (err) {
      console.error("Take failed:", err);
      setProblem({ divisionId: item.divisionId, text: "Couldn't reach the server. Try again." });
      setBusy(null);
    }
  }

  const findCategory = (divisionId: string) => {
    setRing("all");
    setHighlight(divisionId);
    if (desk.items.find((i) => i.divisionId === divisionId)?.status === "done") setShowFinished(true);
    requestAnimationFrame(() => document.getElementById(`desk-${divisionId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 px-4 pb-24 pt-4 sm:px-6">
      {banner && (
        <div
          role="status"
          className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[13px] ${
            banner.tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"
          }`}
        >
          <span className="material-symbols-outlined text-[20px]">{banner.tone === "warn" ? "info" : "check_circle"}</span>
          <p className="flex-1">{banner.text}</p>
          <button type="button" onClick={() => setBanner(null)} aria-label="Dismiss" className="-m-1 flex h-8 w-8 items-center justify-center rounded-lg hover:bg-black/5">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}

      <AthleteSearch tournamentId={tournamentId} onPick={findCategory} />

      {mine ? (
        <section aria-label="In your hands" className="rounded-xl border-2 border-[var(--accent)] bg-[var(--accent-tint)] p-4">
          <p className="text-[11px] font-black uppercase tracking-wider text-[var(--accent-dark)]">In your hands</p>
          <p className="mt-1 text-[20px] font-extrabold leading-tight text-[var(--ink-900)]">{mine.name}</p>
          <p className="mt-0.5 text-[13px] text-[var(--ink-700)]">{tatamiLine(mine.tatami)}</p>
          <EventCounts item={mine} />
          <Link
            href={workspaceHref(mine.divisionId)}
            className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] text-[15px] font-bold text-white hover:bg-[var(--accent-dark)]"
          >
            Continue <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
          </Link>
        </section>
      ) : null}

      {(ringsInUse.rings.length > 1 || (ringsInUse.rings.length > 0 && ringsInUse.none)) && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:px-0" role="tablist" aria-label="Tatami">
          <Chip active={ring === "all"} onClick={() => setRing("all")}>All</Chip>
          {ringsInUse.rings.map((r) => (
            <Chip key={r.id} active={ring === r.id} onClick={() => setRing(r.id)}>{r.name}</Chip>
          ))}
          {ringsInUse.none && <Chip active={ring === "none"} onClick={() => setRing("none")}>No tatami</Chip>}
        </div>
      )}

      {desk.items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--line-strong)] p-6 text-center text-[14px] text-[var(--ink-500)]">
          No categories yet. The admin sets them up before the event.
        </p>
      ) : (
        <ul className="space-y-2">
          {open.map((item) => (
            <DeskRow
              key={item.divisionId}
              item={item}
              canTake={!mine && item.athletes > 0 && (item.status === "waiting" || item.status === "partly")}
              busy={busy === item.divisionId}
              highlighted={highlight === item.divisionId}
              problem={problem?.divisionId === item.divisionId ? problem.text : null}
              onTake={() => void take(item)}
            />
          ))}
          {open.length === 0 && (
            <li className="rounded-xl border border-dashed border-[var(--line-strong)] p-5 text-center text-[13px] text-[var(--ink-500)]">
              Nothing left to prepare here.
            </li>
          )}
        </ul>
      )}

      {mine && open.some((i) => i.status === "waiting" || i.status === "partly") && (
        <p className="text-center text-[12px] text-[var(--ink-500)]">You hold {mine.name}. Send it or hand it back to take another category.</p>
      )}

      {finished.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setShowFinished((v) => !v)}
            aria-expanded={showFinished}
            className="flex h-11 w-full items-center justify-between rounded-xl px-1 text-[13px] font-bold text-[var(--ink-500)]"
          >
            Finished ({finished.length})
            <span className="material-symbols-outlined text-[20px]">{showFinished ? "expand_less" : "expand_more"}</span>
          </button>
          {showFinished && (
            <ul className="space-y-2">
              {finished.map((item) => (
                <DeskRow key={item.divisionId} item={item} canTake={false} busy={false} highlighted={highlight === item.divisionId} problem={null} onTake={() => undefined} />
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`h-10 shrink-0 rounded-[999px] border px-4 text-[13px] font-bold ${
        active ? "border-[var(--ink-900)] bg-[var(--ink-900)] text-white" : "border-[var(--line)] bg-white text-[var(--ink-700)] hover:bg-[var(--canvas)]"
      }`}
    >
      {children}
    </button>
  );
}

function EventCounts({ item }: { item: DeskItem }) {
  if (item.events.length === 0) return <p className="mt-1 text-[12px] text-[var(--ink-500)]">No events switched on.</p>;
  return (
    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-[var(--ink-500)]">
      {item.events.map((e) => (
        <span key={e.eventType}>
          <span className="font-semibold text-[var(--ink-700)]">{EVENT_LABEL[e.eventType]}</span> {e.participants}
          {e.groups > 0 ? ` · ${e.locked}/${e.groups} sent` : ""}
        </span>
      ))}
    </p>
  );
}

function DeskRow({
  item,
  canTake,
  busy,
  highlighted,
  problem,
  onTake,
}: {
  item: DeskItem;
  canTake: boolean;
  busy: boolean;
  highlighted: boolean;
  problem: string | null;
  onTake: () => void;
}) {
  const pill = statusPill(item);
  return (
    <li
      id={`desk-${item.divisionId}`}
      className={`rounded-xl border bg-white p-3 transition-shadow ${highlighted ? "border-[var(--accent)] ring-2 ring-[var(--accent)]/30" : "border-[var(--line)]"} ${
        item.status === "done" ? "opacity-70" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-bold leading-snug text-[var(--ink-900)]">{item.name}</p>
          <p className={`text-[12.5px] ${item.tatami?.onMat ? "font-semibold text-red-700" : "text-[var(--ink-500)]"}`}>{tatamiLine(item.tatami)}</p>
          <EventCounts item={item} />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className={`rounded-[999px] border px-2.5 py-1 text-[11px] font-bold ${pill.tone}`}>{pill.label}</span>
          {canTake && (
            <button
              type="button"
              onClick={onTake}
              disabled={busy}
              className="flex h-11 min-w-[88px] items-center justify-center gap-1 rounded-xl bg-[var(--ink-900)] px-4 text-[14px] font-bold text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Taking…" : "Take"}
            </button>
          )}
        </div>
      </div>
      {problem && <p className="mt-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-[12.5px] text-red-800">{problem}</p>}
    </li>
  );
}

/** Finds an athlete of the tournament and points at their category. */
function AthleteSearch({ tournamentId, onPick }: { tournamentId: string; onPick: (divisionId: string) => void }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits(null);
      return;
    }
    const n = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const found = await searchDeskAthletes(tournamentId, q);
        if (n === seq.current) setHits(found);
      } catch (err) {
        console.error("Athlete search failed:", err);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, tournamentId]);

  return (
    <div className="relative">
      <label className="flex h-12 items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3 focus-within:border-[var(--accent)]">
        <span className="material-symbols-outlined text-[20px] text-[var(--ink-400)]">search</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find an athlete: name, chest number or club"
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--ink-400)]"
          aria-label="Find an athlete"
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-[var(--canvas)]">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        )}
      </label>
      {hits && (
        <ul className="absolute left-0 right-0 top-[52px] z-30 max-h-[60vh] overflow-y-auto rounded-xl border border-[var(--line)] bg-white shadow-lg">
          {hits.length === 0 && <li className="px-3 py-3 text-[13px] text-[var(--ink-500)]">Nobody found.</li>}
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                disabled={!h.divisionId}
                onClick={() => {
                  if (!h.divisionId) return;
                  setQuery("");
                  onPick(h.divisionId);
                }}
                className="flex min-h-[52px] w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--canvas)] disabled:cursor-default"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-[var(--ink-900)]">{h.name}</span>
                  <span className="block truncate text-[12px] text-[var(--ink-500)]">
                    {[h.chestNumber ? `#${h.chestNumber}` : null, h.club].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="shrink-0 text-[12px] font-semibold text-[var(--ink-700)]">{h.divisionName ?? "No category"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
