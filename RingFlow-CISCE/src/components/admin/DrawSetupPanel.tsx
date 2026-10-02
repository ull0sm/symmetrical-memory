"use client";

import React, { useCallback, useEffect, useState } from "react";
import { getCategoryDrawSetup, setCategoryDrawProfile, setCategorySeeds } from "@/actions/draws";

type Setup = NonNullable<Awaited<ReturnType<typeof getCategoryDrawSetup>>>;

interface Props {
  categoryId: string;
  /** Kata pool draws do not use seeds yet. */
  seedable: boolean;
  /** Profile and seeds only shape the next draw, so they stay editable until bouts are fought. */
  locked: boolean;
  /** Bump to reload after the draw changed. */
  reloadKey: string | number;
  onChanged: () => void;
}

const PROFILE_LABEL = { OFFICIAL: "Official (WKF)", LOCAL: "Local" } as const;

/**
 * How a category will be (or was) drawn: its profile, the seed behind the
 * current bracket, and the seeds an organiser may set before drawing.
 */
export function DrawSetupPanel({ categoryId, seedable, locked, reloadKey, onChanged }: Props) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [seedInputs, setSeedInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showSeeds, setShowSeeds] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getCategoryDrawSetup(categoryId);
      setSetup(data);
      setSeedInputs(
        Object.fromEntries((data?.roster ?? []).map((a) => [a.athleteId, a.seed === null ? "" : String(a.seed)]))
      );
    } catch {
      setSetup(null);
    }
  }, [categoryId]);

  useEffect(() => {
    setMessage(null);
    void load();
  }, [load, reloadKey]);

  if (!setup) return null;

  const { rules, draw, roster } = setup;
  const canTweak = !locked;

  const changeProfile = async (value: string) => {
    setBusy(true);
    try {
      const res = await setCategoryDrawProfile(categoryId, value === "inherit" ? null : (value as "OFFICIAL" | "LOCAL"));
      if (!res.success) alert(res.error || "Could not change the draw profile.");
      await load();
      onChanged();
      setMessage(draw ? "Saved. Regenerate the draw for the new profile to take effect." : "Saved.");
    } finally {
      setBusy(false);
    }
  };

  const saveSeeds = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const seeds = roster.map((a) => {
        const raw = (seedInputs[a.athleteId] ?? "").trim();
        return { athleteId: a.athleteId, seed: raw === "" ? null : Number(raw) };
      });
      const res = await setCategorySeeds(categoryId, seeds);
      if (!res.success) {
        alert(res.error || "Could not save the seeds.");
        return;
      }
      await load();
      setMessage(
        draw
          ? `${res.seeded} seed(s) saved. Regenerate the draw to use them.`
          : `${res.seeded} seed(s) saved.`
      );
    } finally {
      setBusy(false);
    }
  };

  const seededCount = roster.filter((a) => a.seed !== null).length;

  return (
    <div className="border border-outline-variant rounded-xl bg-white p-4 space-y-3 text-xs">
      <div className="flex items-center justify-between gap-3">
        <div className="font-bold uppercase tracking-wider text-primary">Draw setup</div>
        <span
          className={`px-2 py-0.5 rounded-md font-data-mono text-[10px] font-bold ${
            rules.profile === "OFFICIAL" ? "bg-[#E3F6F0] text-[#0B7C63]" : "bg-amber-50 text-amber-800"
          }`}
        >
          {PROFILE_LABEL[rules.profile]}
        </span>
      </div>

      <label className="flex items-center justify-between gap-3">
        <span className="text-on-surface-variant">Profile for this category</span>
        <select
          disabled={busy || !canTweak}
          value={setup.categoryProfile ?? "inherit"}
          onChange={(e) => changeProfile(e.target.value)}
          className="px-2 py-1.5 border border-outline-variant rounded-lg bg-white"
        >
          <option value="inherit">Inherit event ({PROFILE_LABEL[setup.tournamentProfile]})</option>
          <option value="OFFICIAL">Official (WKF)</option>
          <option value="LOCAL">Local</option>
        </select>
      </label>

      <p className="text-on-surface-variant leading-snug">
        {rules.profile === "OFFICIAL"
          ? "WKF procedure: repechage with two bronzes, club-mates kept apart. Local tweaks are ignored."
          : `Local: ${rules.bronzeMedals} bronze format, club separation ${rules.separation === "CLUB" ? "on" : "off"}.`}
      </p>

      {draw ? (
        <div className="rounded-lg bg-surface-container-low p-2.5 font-data-mono text-[11px] leading-relaxed text-on-surface-variant">
          Draw v{draw.version} · {draw.state}
          <br />
          Seed {draw.seed ?? "n/a"} · checksum {draw.checksum.slice(0, 10)}
          {draw.note ? (
            <>
              <br />
              {draw.note}
            </>
          ) : null}
        </div>
      ) : (
        <div className="text-on-surface-variant">No draw generated yet.</div>
      )}

      {seedable && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowSeeds((v) => !v)}
            className="w-full flex items-center justify-between text-left font-bold text-primary cursor-pointer"
          >
            <span>
              Seeds ({seededCount} of {roster.length} set)
            </span>
            <span className="material-symbols-outlined text-[18px]">{showSeeds ? "expand_less" : "expand_more"}</span>
          </button>

          {showSeeds && (
            <>
              <p className="text-on-surface-variant leading-snug">
                1 is the strongest. Seeded athletes take their place in the bracket; everyone else is drawn at
                random around them, with club-mates kept apart.
              </p>
              <ul className="max-h-56 overflow-y-auto divide-y divide-outline-variant/50 border border-outline-variant/60 rounded-lg">
                {roster.map((a) => (
                  <li key={a.athleteId} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                    <span className="truncate">
                      {a.name}
                      {a.club ? <span className="text-on-surface-variant"> · {a.club}</span> : null}
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={roster.length}
                      disabled={busy || !canTweak}
                      value={seedInputs[a.athleteId] ?? ""}
                      onChange={(e) => setSeedInputs((prev) => ({ ...prev, [a.athleteId]: e.target.value }))}
                      aria-label={`Seed for ${a.name}`}
                      placeholder="-"
                      className="w-14 px-1.5 py-1 border border-outline-variant rounded-md text-center font-data-mono"
                    />
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={busy || !canTweak}
                onClick={saveSeeds}
                className="w-full py-2 rounded-lg bg-primary text-white font-bold disabled:opacity-40 cursor-pointer"
              >
                Save seeds
              </button>
            </>
          )}
        </div>
      )}

      {!canTweak && <p className="text-on-surface-variant">Unlock the draw to change its setup.</p>}
      {message && <p className="text-[#0B7C63] font-bold">{message}</p>}
    </div>
  );
}
