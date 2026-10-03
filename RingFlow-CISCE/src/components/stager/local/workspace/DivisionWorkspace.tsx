"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { handBackDivision, takeDivision } from "@/actions/staging";
import type { DivisionEventType } from "@/lib/statuses";
import { EVENT_LABEL, tatamiLine } from "../format";
import AthletesTab from "./AthletesTab";
import EventTab from "./EventTab";
import { useWorkspace, type Leaving, type WorkspaceData } from "./useWorkspace";

/**
 * A category's workspace: its athletes, and its kumite and kata groups, built and
 * locked by whoever holds it. The stager reaches it from the desk; the admin
 * from the staging overview, where it is read only until the admin takes it.
 */

type Tab = "athletes" | DivisionEventType;
const TAB_BAR_HEIGHT = 49;

export default function DivisionWorkspace({
  initial,
  homeHref,
  viewer,
  headerHeight,
  showName = true,
}: {
  initial: WorkspaceData;
  /** The desk (stager) or the staging overview (admin). */
  homeHref: string;
  viewer: "stager" | "admin";
  /** The page's sticky header, in px: the tabs and group chips stick right under it. */
  headerHeight: number;
  /** False when the page header already names the category. */
  showName?: boolean;
}) {
  const router = useRouter();
  const divisionId = initial.division.id;
  const leave = (why: Leaving) => {
    if (viewer === "admin" && why !== "lost") return;
    router.replace(`${homeHref}?notice=${why}&category=${divisionId}`);
  };
  const api = useWorkspace(divisionId, initial, leave);
  const { ws, pending, notice, setNotice, run, undo, canUndo, undoLabel, expectLeaving } = api;
  const editable = ws.youHold;

  const storageKey = `ringflow:workspace-tab:${divisionId}`;
  const [tab, setTab] = useState<Tab>("athletes");
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved === "athletes" || saved === "kumite" || saved === "kata") setTab(saved);
    } catch (err) {
      console.warn("Couldn't read the last tab:", err);
    }
  }, [storageKey]);
  const choose = (next: Tab) => {
    setTab(next);
    try {
      sessionStorage.setItem(storageKey, next);
    } catch (err) {
      console.warn("Couldn't remember the tab:", err);
    }
  };

  const athletes = useMemo(() => new Map(ws.athletes.map((a) => [a.id, a])), [ws.athletes]);
  const event = tab === "athletes" ? null : (ws.events.find((e) => e.eventType === tab) ?? null);
  useEffect(() => {
    if (tab !== "athletes" && !ws.events.some((e) => e.eventType === tab)) setTab("athletes");
  }, [tab, ws.events]);

  const [confirmHandBack, setConfirmHandBack] = useState(false);
  const handBack = async () => {
    setConfirmHandBack(false);
    expectLeaving("handed-back");
    const res = await run("Hand back", () => handBackDivision(divisionId));
    if (!res?.success) expectLeaving(null);
    else if (viewer === "admin") router.replace(homeHref);
  };
  const take = () => void run("Take this category", () => takeDivision(divisionId));

  const notHere = ws.athletes.filter((a) => a.attendance === "absent" || a.attendance === "withdrawn").length;
  const tabs: { key: Tab; label: string; count: string }[] = [
    { key: "athletes", label: "Athletes", count: `${ws.athletes.length - notHere}/${ws.athletes.length}` },
    ...ws.events.map((e) => ({ key: e.eventType as Tab, label: EVENT_LABEL[e.eventType], count: `${e.groups.filter((g) => g.locked).length}/${e.groups.length}` })),
  ];

  return (
    <div className="mx-auto w-full max-w-6xl">
      {/* The category, who holds it, and the one-tap actions */}
      <div className="px-4 pt-3 sm:px-6">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {showName && <h1 className="text-[22px] font-extrabold leading-tight text-[var(--ink-900)]">{ws.division.name}</h1>}
            <p className={`text-[12.5px] text-[var(--ink-500)] ${showName ? "" : "pt-1"}`}>
              {tatamiLine(ws.tatami)} ·{" "}
              {editable ? (
                <span className="font-semibold text-[var(--accent-dark)]">held by you</span>
              ) : ws.holder ? (
                `held by ${ws.holder.name}${ws.holder.label ? ` (${ws.holder.label})` : ""}`
              ) : (
                "nobody holds it"
              )}
            </p>
          </div>
          {editable && (
            <button
              type="button"
              onClick={() => void undo()}
              disabled={!canUndo || !!pending}
              title={undoLabel ? `Undo: ${undoLabel}` : "Nothing to undo"}
              className="flex h-11 items-center gap-1 rounded-xl border border-[var(--line)] bg-white px-3 text-[13px] font-bold text-[var(--ink-700)] disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-[20px]">undo</span>
              <span className="hidden sm:inline">Undo</span>
            </button>
          )}
          {editable &&
            (confirmHandBack ? (
              <span className="flex items-center gap-1">
                <button type="button" onClick={() => void handBack()} className="h-11 rounded-xl bg-[var(--ink-900)] px-3 text-[13px] font-bold text-white">
                  Hand back
                </button>
                <button type="button" onClick={() => setConfirmHandBack(false)} className="h-11 rounded-xl px-2 text-[13px] font-bold text-[var(--ink-700)]">
                  Keep
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmHandBack(true)}
                disabled={!!pending}
                className="h-11 rounded-xl border border-[var(--line)] bg-white px-3 text-[13px] font-bold text-[var(--ink-700)]"
              >
                Hand back
              </button>
            ))}
        </div>

        {!editable && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-[13px] text-sky-900">
            <span className="material-symbols-outlined text-[18px]">visibility</span>
            <span className="flex-1">
              {ws.holder
                ? `You're looking at it. ${ws.holder.name} holds it: release or hand it on from Staging to change it.`
                : "You're looking at it. Take it to change its groups."}
            </span>
            {!ws.holder && viewer === "admin" && (
              <button type="button" onClick={take} disabled={!!pending} className="h-10 rounded-lg bg-sky-700 px-3 font-bold text-white">
                Take it
              </button>
            )}
          </div>
        )}

        {notice && (
          <div
            role="status"
            className={`mt-2 flex items-start gap-2 rounded-xl px-3 py-2 text-[13px] ${notice.tone === "error" ? "bg-red-50 text-red-900" : "bg-emerald-50 text-emerald-900"}`}
          >
            <span className="material-symbols-outlined text-[18px]">{notice.tone === "error" ? "error" : "check_circle"}</span>
            <p className="flex-1">{notice.text}</p>
            {notice.retry && (
              <button type="button" onClick={notice.retry} className="h-8 rounded-lg bg-red-600 px-3 text-[12.5px] font-bold text-white">
                Retry
              </button>
            )}
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="-m-1 flex h-8 w-8 items-center justify-center rounded-lg">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="sticky z-30 mt-2 border-b border-[var(--line)] bg-[var(--canvas)] px-4 sm:px-6" style={{ top: headerHeight }}>
        <div className="flex gap-1" role="tablist" aria-label="Workspace">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => choose(t.key)}
              className={`-mb-px flex h-12 flex-1 items-center justify-center gap-1.5 border-b-[3px] px-2 text-[14px] font-bold sm:flex-none sm:px-4 ${
                tab === t.key ? "border-[var(--accent)] text-[var(--ink-900)]" : "border-transparent text-[var(--ink-500)]"
              }`}
            >
              {t.label}
              <span className="rounded-[999px] bg-white px-1.5 text-[11px] font-bold text-[var(--ink-500)]">{t.count}</span>
            </button>
          ))}
        </div>
        {pending && <div className="absolute inset-x-0 bottom-0 h-0.5 animate-pulse bg-[var(--accent)]" aria-label={`Saving: ${pending}`} />}
      </div>

      <div className="px-4 pt-3 sm:px-6">
        {tab === "athletes" ? (
          <AthletesTab api={api} editable={editable} />
        ) : event ? (
          <EventTab
            key={event.id}
            api={api}
            event={event}
            athletes={athletes}
            editable={editable}
            stickyTop={headerHeight + TAB_BAR_HEIGHT}
            onLocked={(released) => {
              if (released && viewer === "admin") router.replace(homeHref);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
