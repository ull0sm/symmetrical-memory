"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { takeDivision } from "@/actions/staging";
import type { DeskItem } from "@/lib/local/stagingView";
import { EVENT_LABEL, statusPill, tatamiLine } from "./format";

/**
 * A category another stager holds, or nobody does: its status only. Its draft
 * groups belong to whoever holds it, so they aren't shown here.
 */
export default function CategoryNotHeld({ item, deskHref, canTake }: { item: DeskItem; deskHref: string; canTake: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const pill = statusPill(item);

  const take = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await takeDivision(item.divisionId);
      if (!res.success) setProblem(res.error);
      router.refresh();
    } catch (err) {
      console.error("Take failed:", err);
      setProblem("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-xl space-y-3 px-4 pt-4">
      <section className="rounded-xl border border-[var(--line)] bg-white p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-[20px] font-extrabold leading-tight text-[var(--ink-900)]">{item.name}</h1>
            <p className="text-[13px] text-[var(--ink-500)]">{tatamiLine(item.tatami)}</p>
          </div>
          <span className={`shrink-0 rounded-[999px] border px-2.5 py-1 text-[11px] font-bold ${pill.tone}`}>{pill.label}</span>
        </div>
        <ul className="mt-3 space-y-1 text-[13px] text-[var(--ink-700)]">
          {item.events.map((e) => (
            <li key={e.eventType}>
              {EVENT_LABEL[e.eventType]}: {e.participants} taking part · {e.locked} of {e.groups} group{e.groups === 1 ? "" : "s"} sent
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12.5px] text-[var(--ink-500)]">
          {item.status === "held"
            ? `${item.holderName ?? "Another stager"} is preparing it. Its groups show here once they're sent.`
            : item.status === "sent" || item.status === "done"
              ? "Every group is sent. Only the admin can change them now."
              : "Take it to prepare its groups."}
        </p>
        {problem && <p className="mt-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-[12.5px] text-red-800">{problem}</p>}
        {canTake && (item.status === "waiting" || item.status === "partly") && (
          <button
            type="button"
            onClick={() => void take()}
            disabled={busy}
            className="mt-3 h-12 w-full rounded-xl bg-[var(--ink-900)] text-[15px] font-bold text-white disabled:opacity-50"
          >
            {busy ? "Taking…" : "Take this category"}
          </button>
        )}
      </section>
      <Link href={deskHref} className="flex h-11 items-center justify-center rounded-xl text-[14px] font-bold text-[var(--ink-700)]">
        Back to the desk
      </Link>
    </main>
  );
}
