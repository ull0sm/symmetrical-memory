"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { updateLocalSettings } from "@/actions/divisions";
import type { LocalSettings } from "@/lib/local/divisions";

/** A Local tournament's settings: the belt list and the defaults every category's events start from. */
export default function LocalSettingsSection({ tournamentId, settings }: { tournamentId: string; settings: LocalSettings }) {
  const router = useRouter();
  const [belts, setBelts] = useState(settings.beltLevels.join("\n"));
  const [bronze, setBronze] = useState<1 | 2>(settings.localBronzeMedals);
  const [kumiteSize, setKumiteSize] = useState(String(settings.localKumiteGroupSize));
  const [kataSize, setKataSize] = useState(String(settings.localKataGroupSize));
  const [duration, setDuration] = useState(settings.localBoutDurationMs === null ? "" : String(settings.localBoutDurationMs));
  const [order, setOrder] = useState(settings.localEventOrder);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const input = "h-10 px-3 border border-outline-variant rounded bg-surface-container-lowest text-sm focus:outline-none focus:ring-2 focus:ring-secondary/40";

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await updateLocalSettings(tournamentId, {
        beltLevels: belts.split("\n").map((b) => b.trim()).filter(Boolean),
        localBronzeMedals: bronze,
        localKumiteGroupSize: Number(kumiteSize),
        localKataGroupSize: Number(kataSize),
        localBoutDurationMs: duration === "" ? null : Number(duration),
        localEventOrder: order,
      });
      setMessage(res.success ? { ok: true, text: "Saved" } : { ok: false, text: res.error });
      if (res.success) router.refresh();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Could not save." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-8 shadow-sm space-y-6">
      <div>
        <h3 className="font-label-caps text-label-caps text-secondary">Local Categories And Groups</h3>
        <p className="text-body-xs text-on-surface-variant mt-1 max-w-xl">
          Every category starts from these. Each category&apos;s kumite and kata can change them on the Categories page.
        </p>
      </div>

      <label className="block space-y-1">
        <span className="font-label-caps text-[10px] text-on-surface-variant">BELTS, LOWEST FIRST, ONE PER LINE</span>
        <textarea className={`${input} w-full h-40 py-2`} value={belts} onChange={(e) => setBelts(e.target.value)} />
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <span className="font-label-caps text-[10px] text-on-surface-variant">BRONZES IN EACH GROUP</span>
          <div className="grid grid-cols-2 gap-2">
            {([2, 1] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={bronze === value}
                onClick={() => setBronze(value)}
                className={`rounded-lg border p-2.5 text-left text-xs ${bronze === value ? "border-secondary bg-secondary-fixed" : "border-outline-variant"}`}
              >
                <span className="block font-bold text-primary">{value} bronze{value > 1 ? "s" : ""}</span>
                <span className="block text-on-surface-variant mt-0.5">
                  {value === 2 ? "Both semi-final losers, no extra bout" : "Semi-final losers fight one bronze bout"}
                </span>
              </button>
            ))}
          </div>
        </div>
        <label className="space-y-1">
          <span className="font-label-caps text-[10px] text-on-surface-variant">ORDER ON THE TATAMI</span>
          <select className={`${input} w-full`} value={order} onChange={(e) => setOrder(e.target.value as typeof order)}>
            <option value="KUMITE_FIRST">Kumite groups, then kata</option>
            <option value="KATA_FIRST">Kata groups, then kumite</option>
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <label className="space-y-1">
          <span className="font-label-caps text-[10px] text-on-surface-variant">KUMITE GROUP SIZE</span>
          <input className={`${input} w-full`} inputMode="numeric" value={kumiteSize} onChange={(e) => setKumiteSize(e.target.value.replace(/\D/g, ""))} />
        </label>
        <label className="space-y-1">
          <span className="font-label-caps text-[10px] text-on-surface-variant">KATA GROUP SIZE</span>
          <input className={`${input} w-full`} inputMode="numeric" value={kataSize} onChange={(e) => setKataSize(e.target.value.replace(/\D/g, ""))} />
        </label>
        <label className="space-y-1">
          <span className="font-label-caps text-[10px] text-on-surface-variant">KUMITE BOUT LENGTH</span>
          <select className={`${input} w-full`} value={duration} onChange={(e) => setDuration(e.target.value)}>
            <option value="">The tatami&apos;s setting</option>
            {[60, 90, 120, 150, 180].map((s) => (
              <option key={s} value={s * 1000}>
                {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="px-6 h-11 bg-primary text-on-primary font-label-caps text-label-caps rounded hover:opacity-90 disabled:opacity-50">
          {saving ? "SAVING..." : "SAVE LOCAL SETTINGS"}
        </button>
        {message && <span className={`text-sm ${message.ok ? "text-on-surface-variant" : "text-error"}`}>{message.text}</span>}
      </div>
    </section>
  );
}
