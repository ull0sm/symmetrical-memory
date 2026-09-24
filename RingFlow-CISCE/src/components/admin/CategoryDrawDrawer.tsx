"use client";

import React, { useState, useEffect } from "react";
import { setCategoryDrawOption, toggleCategoryDrawLock, generateCategoryDraw } from "@/actions/draws";
import { downloadCategoryDrawPdf } from "@/actions/drawPdfs";
import { updateCategoryKataSettings } from "@/actions/categories";

export type CategoryDrawInfo = {
  id: string;
  name: string;
  age_bracket: string | null;
  weight_class: string | null;
  athletes_count: number;
  expected_matches: number;
  doc_url?: string | null;
  bronze_medals?: number | null;
  draw_state?: string | null;
  is_locked?: boolean;
  confirmed_matches?: number;
  live_matches?: number;
  total_matches?: number;
  has_draw?: boolean;
  event_type?: string | null;
  eventType?: string | null;
  discipline?: string | null;
  kata_format?: string | null;
  kataFormat?: string | null;
  kata_scoring_mode?: string | null;
  kataScoringMode?: string | null;
  pool_size?: number | null;
  poolSize?: number | null;
  advance_per_pool?: number | null;
  advancePerPool?: number | null;
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  category: CategoryDrawInfo | null;
  tournamentId: string;
  onViewBracket: (cat: CategoryDrawInfo) => void;
  onRefresh: () => void;
}

export function CategoryDrawDrawer({
  isOpen,
  onClose,
  category,
  tournamentId,
  onViewBracket,
  onRefresh,
}: Props) {
  const [isSavingBronze, setIsSavingBronze] = useState(false);
  const [isTogglingLock, setIsTogglingLock] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [showEmergencyReset, setShowEmergencyReset] = useState(false);
  const [resetConfirmInput, setResetConfirmInput] = useState("");

  // Kata Settings State
  const [kataFormat, setKataFormat] = useState<string>("GROUP_POOLS");
  const [kataScoringMode, setKataScoringMode] = useState<string>("FLAG");
  const [poolSize, setPoolSize] = useState<number>(8);
  const [advancePerPool, setAdvancePerPool] = useState<number>(2);
  const [isSavingKata, setIsSavingKata] = useState(false);
  const [kataSaveNotice, setKataSaveNotice] = useState<string | null>(null);

  useEffect(() => {
    if (category) {
      setKataFormat(category.kata_format || category.kataFormat || "GROUP_POOLS");
      setKataScoringMode(category.kata_scoring_mode || category.kataScoringMode || "FLAG");
      setPoolSize(category.pool_size || category.poolSize || 8);
      setAdvancePerPool(category.advance_per_pool || category.advancePerPool || 2);
      setKataSaveNotice(null);
    }
  }, [category]);

  if (!isOpen || !category) return null;

  const confirmed = category.confirmed_matches ?? 0;
  const live = category.live_matches ?? 0;
  const total = category.total_matches ?? category.expected_matches ?? 0;
  const hasDraw = Boolean(category.has_draw || category.draw_state);
  const isLocked = Boolean(category.is_locked || category.draw_state === "LOCKED");

  let lifecycle: "NO_DRAW" | "DRAFT" | "LOCKED" | "IN_PROGRESS" | "COMPLETED" = "NO_DRAW";
  if (hasDraw) {
    if (total > 0 && confirmed >= total) {
      lifecycle = "COMPLETED";
    } else if (confirmed > 0 || live > 0) {
      lifecycle = "IN_PROGRESS";
    } else if (isLocked) {
      lifecycle = "LOCKED";
    } else {
      lifecycle = "DRAFT";
    }
  }

  const handleBronzeChange = async (val: 0 | 1 | 2 | 3 | null) => {
    if (lifecycle === "IN_PROGRESS" || lifecycle === "COMPLETED") {
      alert("Cannot change bronze format while matches are in progress or completed.");
      return;
    }
    setIsSavingBronze(true);
    try {
      const res = await setCategoryDrawOption(category.id, val);
      if (res.success) {
        onRefresh();
      } else {
        alert(res.error || "Failed to save bronze medal setting.");
      }
    } catch (err: any) {
      alert(err?.message || "Failed to update bronze setting.");
    } finally {
      setIsSavingBronze(false);
    }
  };

  const handleToggleLock = async () => {
    if (!hasDraw) {
      alert("Generate a draw first before locking.");
      return;
    }
    setIsTogglingLock(true);
    try {
      const res = await toggleCategoryDrawLock(category.id);
      if (res.success) {
        onRefresh();
      } else {
        alert(res.error || "Failed to toggle draw lock state.");
      }
    } catch (err: any) {
      alert(err?.message || "Failed to update lock.");
    } finally {
      setIsTogglingLock(false);
    }
  };

  const handleRegenerate = async (force: boolean = false) => {
    if (lifecycle === "IN_PROGRESS" || lifecycle === "COMPLETED") {
      if (!force) {
        alert("Matches are already live or completed in this category. Complete redrawing is forbidden to protect scores.");
        return;
      }
    }
    setIsRegenerating(true);
    try {
      const res = await generateCategoryDraw(category.id, { forceRegenerate: force });
      if (res.success) {
        setShowEmergencyReset(false);
        setResetConfirmInput("");
        onRefresh();
      } else {
        alert(res.error || "Failed to generate draw.");
      }
    } catch (err: any) {
      alert(err?.message || "Failed to generate draw.");
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleDownloadPdf = async () => {
    setIsDownloadingPdf(true);
    try {
      const res = await downloadCategoryDrawPdf(category.id);
      if (res.success && res.base64) {
        const byteCharacters = atob(res.base64);
        const byteNumbers = new Uint8Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const blob = new Blob([byteNumbers], { type: "application/pdf" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = res.filename;
        link.click();
      } else {
        const errorMsg = ("error" in res && res.error) || "Failed to download draw PDF.";
        alert(errorMsg);
      }
    } catch (err: any) {
      alert(err?.message || "Download failed.");
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const handleSaveKataSettings = async () => {
    if (lifecycle === "IN_PROGRESS" || lifecycle === "COMPLETED") {
      alert("Cannot change competition format while bouts are in progress or completed.");
      return;
    }
    setIsSavingKata(true);
    setKataSaveNotice(null);
    try {
      const res = await updateCategoryKataSettings(category.id, tournamentId, {
        kataFormat,
        kataScoringMode,
        poolSize,
        advancePerPool,
      });
      if (res.success) {
        setKataSaveNotice("Saved! Changes apply next time this category's draw is generated.");
        onRefresh();
      } else {
        alert("Failed to update Kata settings.");
      }
    } catch (err: any) {
      alert(err?.message || "Failed to update Kata settings.");
    } finally {
      setIsSavingKata(false);
    }
  };

  const isKataCategory =
    category.discipline === "KATA" ||
    category.event_type === "kata" ||
    category.eventType === "kata" ||
    category.name?.toLowerCase().includes("kata");
  const bronzeValue = category.bronze_medals === null || category.bronze_medals === undefined ? "inherit" : String(category.bronze_medals);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/50 backdrop-blur-xs animate-in fade-in flex justify-end">
      <div
        className="w-full max-w-lg bg-[#FAF9F5] h-full shadow-2xl flex flex-col border-l border-[#E1DDCF] animate-in slide-in-from-right duration-200"
        role="dialog"
        aria-modal="true"
      >
        {/* Drawer Header */}
        <div className="px-6 py-5 bg-white border-b border-[#E1DDCF] flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold font-data-mono tracking-wider text-[#0E9C7C] uppercase">
              Tournament Draw Management
            </span>
            <h2 className="text-lg font-bold text-[#1B1815] mt-0.5">{category.name}</h2>
            <div className="flex items-center gap-2 text-xs text-[#68645A] mt-1 font-data-mono">
              <span>{category.age_bracket || "All Ages"}</span>
              <span>•</span>
              <span>{category.weight_class || "Open Weight"}</span>
              <span>•</span>
              <span className="font-bold text-[#1B1815]">{category.athletes_count} Athletes</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-[#68645A] hover:text-[#1B1815] rounded-lg hover:bg-[#F5F3EC] transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[22px]">close</span>
          </button>
        </div>

        {/* Drawer Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Lifecycle Status Banner */}
          <div className="rounded-xl p-4 border bg-white shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#8C877C] uppercase tracking-wider">
                Current Draw Lifecycle State
              </span>
              {lifecycle === "NO_DRAW" && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold font-data-mono bg-slate-100 text-slate-700 border border-slate-200">
                  <span className="w-2 h-2 rounded-full bg-slate-400" />
                  NO DRAW
                </span>
              )}
              {lifecycle === "DRAFT" && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold font-data-mono bg-amber-50 text-amber-900 border border-amber-200">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  DRAFT (EDITABLE)
                </span>
              )}
              {lifecycle === "LOCKED" && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold font-data-mono bg-indigo-50 text-indigo-900 border border-indigo-200">
                  <span className="material-symbols-outlined text-[13px]">lock</span>
                  OFFICIAL & LOCKED
                </span>
              )}
              {lifecycle === "IN_PROGRESS" && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold font-data-mono bg-emerald-50 text-emerald-900 border border-emerald-300">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                  LIVE IN PROGRESS
                </span>
              )}
              {lifecycle === "COMPLETED" && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold font-data-mono bg-emerald-100 text-emerald-950 border border-emerald-300">
                  <span className="material-symbols-outlined text-[14px] text-amber-600">workspace_premium</span>
                  COMPLETED
                </span>
              )}
            </div>

            <p className="text-xs text-[#504C42] mt-3 leading-relaxed">
              {lifecycle === "NO_DRAW" && "This category does not have a generated bracket yet. Athletes are registered and ready for seed computation."}
              {lifecycle === "DRAFT" && "Draft bracket generated. Seeding and byes are positioned. You can review the bracket, adjust bronze formats, or rebuild before publishing."}
              {lifecycle === "LOCKED" && "Draw is officially locked and published. It is protected from bulk regeneration and ready for mat dispatch."}
              {lifecycle === "IN_PROGRESS" && `Tournament matches are actively being conducted on the tatami (${confirmed} scored, ${live} live). Bracket structure is protected.`}
              {lifecycle === "COMPLETED" && "All category bouts are complete. Podiums and final standings are awarded and locked."}
            </p>

            {hasDraw && (
              <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-[#F0ECE1] text-center font-data-mono">
                <div className="p-2 rounded-lg bg-[#FAF9F5]">
                  <span className="block text-[11px] text-[#8C877C]">Confirmed</span>
                  <span className="text-sm font-bold text-[#1B1815]">{confirmed}</span>
                </div>
                <div className="p-2 rounded-lg bg-[#FAF9F5]">
                  <span className="block text-[11px] text-[#8C877C]">Live Now</span>
                  <span className="text-sm font-bold text-[#0E9C7C]">{live}</span>
                </div>
                <div className="p-2 rounded-lg bg-[#FAF9F5]">
                  <span className="block text-[11px] text-[#8C877C]">Total Matches</span>
                  <span className="text-sm font-bold text-[#1B1815]">{total}</span>
                </div>
              </div>
            )}
          </div>

          {/* Conditional: Kata Settings vs Kumite Bronze Settings */}
          {isKataCategory ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-[#1B1815] uppercase tracking-wider flex items-center gap-1.5 font-data-mono">
                  <span className="material-symbols-outlined text-[16px] text-[#0E9C7C]">sports_martial_arts</span>
                  Kata Competition Settings (PRD)
                </label>
                {(lifecycle === "IN_PROGRESS" || lifecycle === "COMPLETED") && (
                  <span className="text-[10px] font-bold font-data-mono text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                    LOCKED BY LIVE MATCHES
                  </span>
                )}
              </div>

              {/* Competition Format Cards */}
              <div className="space-y-2">
                <span className="text-[11px] font-bold text-[#504C42] uppercase tracking-wider block">
                  1. Competition Format
                </span>
                <div className="grid grid-cols-1 gap-2">
                  {[
                    {
                      id: "BRACKET",
                      title: "Single Elimination with Repechage",
                      desc: "Official WKF knockout bracket with repechage ladders.",
                    },
                    {
                      id: "GROUP_POOLS",
                      title: "Groups then Elimination",
                      desc: "Balanced preliminary flight tables, top qualifiers advance to championship flight.",
                    },
                    {
                      id: "ROUND_ROBIN",
                      title: "Pure Round-Robin",
                      desc: "Full round-robin group where standings directly decide the final medals.",
                    },
                  ].map((fmt) => {
                    const isSelected = kataFormat === fmt.id;
                    const isDisabled = lifecycle === "IN_PROGRESS" || lifecycle === "COMPLETED" || isSavingKata;
                    return (
                      <button
                        key={fmt.id}
                        type="button"
                        disabled={isDisabled}
                        onClick={() => setKataFormat(fmt.id)}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          isSelected
                            ? "border-[#0E9C7C] bg-emerald-50/50 shadow-xs"
                            : "border-[#E1DDCF] bg-white hover:border-[#C0BAA8]"
                        } ${isDisabled ? "opacity-60 cursor-not-allowed" : ""}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-bold ${isSelected ? "text-[#0E9C7C]" : "text-[#1B1815]"}`}>
                            {fmt.title}
                          </span>
                          {isSelected && (
                            <span className="material-symbols-outlined text-[16px] text-[#0E9C7C]">check_circle</span>
                          )}
                        </div>
                        <p className="text-[11px] text-[#68645A] mt-0.5">{fmt.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Ranking Method Cards */}
              <div className="space-y-2">
                <span className="text-[11px] font-bold text-[#504C42] uppercase tracking-wider block">
                  2. Ranking Method
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    {
                      id: "FLAG",
                      title: "WKF Victory Points",
                      desc: "Wins = 3 VP. Tie-breaks: Head-to-Head & Votes.",
                    },
                    {
                      id: "POINTS",
                      title: "Total Score",
                      desc: "Ranks athletes by accumulated performance score.",
                    },
                  ].map((m) => {
                    const isSelected = kataScoringMode === m.id;
                    const isDisabled = lifecycle === "IN_PROGRESS" || lifecycle === "COMPLETED" || isSavingKata;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        disabled={isDisabled}
                        onClick={() => setKataScoringMode(m.id)}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          isSelected
                            ? "border-[#0E9C7C] bg-emerald-50/50 shadow-xs"
                            : "border-[#E1DDCF] bg-white hover:border-[#C0BAA8]"
                        } ${isDisabled ? "opacity-60 cursor-not-allowed" : ""}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-bold ${isSelected ? "text-[#0E9C7C]" : "text-[#1B1815]"}`}>
                            {m.title}
                          </span>
                          {isSelected && (
                            <span className="material-symbols-outlined text-[16px] text-[#0E9C7C]">check_circle</span>
                          )}
                        </div>
                        <p className="text-[10px] text-[#68645A] mt-1">{m.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Pool Size & Advancers */}
              {kataFormat !== "BRACKET" && (
                <div className="bg-white border border-[#E1DDCF] rounded-xl p-3.5 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-bold text-[#1B1815] block mb-1">
                        Group Pool Size
                      </label>
                      <input
                        type="number"
                        min={2}
                        max={32}
                        disabled={lifecycle === "IN_PROGRESS" || lifecycle === "COMPLETED" || isSavingKata}
                        value={poolSize}
                        onChange={(e) => setPoolSize(parseInt(e.target.value, 10) || 8)}
                        className="w-full bg-[#FAF9F5] border border-[#E1DDCF] rounded-lg px-2.5 py-1.5 text-xs font-data-mono font-bold focus:border-[#0E9C7C] outline-none"
                      />
                      <span className="text-[10px] text-[#8C877C] block mt-0.5">
                        WKF recommendation: 6-8 per pool
                      </span>
                    </div>

                    <div>
                      <label className="text-[11px] font-bold text-[#1B1815] block mb-1">
                        Advancers per Group
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={16}
                        disabled={lifecycle === "IN_PROGRESS" || lifecycle === "COMPLETED" || isSavingKata}
                        value={advancePerPool}
                        onChange={(e) => setAdvancePerPool(parseInt(e.target.value, 10) || 2)}
                        className="w-full bg-[#FAF9F5] border border-[#E1DDCF] rounded-lg px-2.5 py-1.5 text-xs font-data-mono font-bold focus:border-[#0E9C7C] outline-none"
                      />
                      <span className="text-[10px] text-[#8C877C] block mt-0.5">
                        Default: Top 2 advance (Q)
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Save Kata Settings Action */}
              <div className="space-y-1.5">
                <button
                  type="button"
                  disabled={lifecycle === "IN_PROGRESS" || lifecycle === "COMPLETED" || isSavingKata}
                  onClick={handleSaveKataSettings}
                  className="w-full py-2.5 px-4 rounded-xl bg-[#0E9C7C] hover:bg-[#0c8569] text-white font-bold text-xs font-data-mono transition-all cursor-pointer shadow-xs disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-[16px]">save</span>
                  <span>{isSavingKata ? "Saving Kata Settings..." : "Save Kata Settings"}</span>
                </button>
                {kataSaveNotice && (
                  <p className="text-[11px] text-[#0E9C7C] font-semibold text-center">
                    {kataSaveNotice}
                  </p>
                )}
                <p className="text-[10px] text-[#8C877C] text-center">
                  Saved settings will be applied when you generate or regenerate this category&apos;s draw.
                </p>
              </div>
            </div>
          ) : (
            /* Kumite Bronze Medal Format Cards */
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-[#1B1815] uppercase tracking-wider flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-[#C08A5A]">workspace_premium</span>
                  Bronze Medal & Repechage Format
                </label>
                {(lifecycle === "IN_PROGRESS" || lifecycle === "COMPLETED") && (
                  <span className="text-[10px] font-bold font-data-mono text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                    LOCKED BY LIVE MATCHES
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 gap-2">
                {[
                  {
                    value: "inherit",
                    title: "Default (Inherit Event Setting)",
                    desc: "Follows the tournament-wide bronze policy configured in Settings.",
                  },
                  {
                    value: "2",
                    title: "Official WKF (2 Bronzes · Full)",
                    desc: "Full repechage ladders for everyone beaten by finalists. Standard WKF format.",
                  },
                  {
                    value: "1",
                    title: "Local Official (1 Bronze Playoff)",
                    desc: "Early losers eliminated; losing semi-finalists face off in a single bronze match.",
                  },
                  {
                    value: "3",
                    title: "Local Official (Joint 3rd · 2 Bronzes)",
                    desc: "Both semi-final losers awarded bronze directly without any extra bouts.",
                  },
                  {
                    value: "0",
                    title: "No Bronze",
                    desc: "Pure single elimination stopping at the final. No bronze bouts.",
                  },
                ].map((opt) => {
                  const isSelected = bronzeValue === opt.value;
                  const isDisabled = lifecycle === "IN_PROGRESS" || lifecycle === "COMPLETED" || isSavingBronze;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={isDisabled}
                      onClick={() => {
                        const numVal = opt.value === "inherit" ? null : (Number(opt.value) as 0 | 1 | 2 | 3);
                        handleBronzeChange(numVal);
                      }}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                        isSelected
                          ? "border-[#0E9C7C] bg-emerald-50/50 shadow-xs"
                          : "border-[#E1DDCF] bg-white hover:border-[#C0BAA8]"
                      } ${isDisabled ? "opacity-60 cursor-not-allowed" : ""}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-bold ${isSelected ? "text-[#0E9C7C]" : "text-[#1B1815]"}`}>
                          {opt.title}
                        </span>
                        {isSelected && (
                          <span className="material-symbols-outlined text-[16px] text-[#0E9C7C]">check_circle</span>
                        )}
                      </div>
                      <p className="text-[11px] text-[#68645A] mt-1">{opt.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Primary Bracket Actions */}
          <div className="space-y-2.5 pt-2">
            <span className="text-xs font-bold text-[#1B1815] uppercase tracking-wider block">
              Operational Actions
            </span>

            {/* View Interactive Digital Bracket */}
            <button
              type="button"
              onClick={() => {
                onViewBracket(category);
                onClose();
              }}
              className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-white border border-[#E1DDCF] hover:border-[#0E9C7C] hover:bg-emerald-50/30 transition-all cursor-pointer group shadow-xs"
            >
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-lg bg-emerald-50 text-[#0E9C7C] flex items-center justify-center">
                  <span className="material-symbols-outlined text-[18px]">account_tree</span>
                </span>
                <div className="text-left">
                  <span className="text-xs font-bold text-[#1B1815] group-hover:text-[#0E9C7C] transition-colors block">
                    View Interactive Bracket
                  </span>
                  <span className="text-[11px] text-[#68645A]">Explore rounds, match scores, and live tree</span>
                </div>
              </div>
              <span className="material-symbols-outlined text-[18px] text-[#8C877C] group-hover:text-[#0E9C7C] transition-colors">
                chevron_right
              </span>
            </button>

            {/* Download Official Draw Sheet PDF */}
            <button
              type="button"
              disabled={isDownloadingPdf || !hasDraw}
              onClick={handleDownloadPdf}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl bg-white border border-[#E1DDCF] hover:border-[#3D3A33] transition-all cursor-pointer group shadow-xs ${
                !hasDraw ? "opacity-50 cursor-not-allowed" : ""
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-lg bg-slate-100 text-[#3D3A33] flex items-center justify-center">
                  <span className="material-symbols-outlined text-[18px]">
                    {isDownloadingPdf ? "sync" : "picture_as_pdf"}
                  </span>
                </span>
                <div className="text-left">
                  <span className="text-xs font-bold text-[#1B1815] block">
                    {isDownloadingPdf ? "Generating PDF..." : "Download Official Draw Sheet PDF"}
                  </span>
                  <span className="text-[11px] text-[#68645A]">High-resolution print-ready bracket sheet</span>
                </div>
              </div>
              <span className="material-symbols-outlined text-[18px] text-[#8C877C]">download</span>
            </button>

            {/* Lock / Unlock Toggle */}
            {hasDraw && (
              <button
                type="button"
                disabled={isTogglingLock || lifecycle === "IN_PROGRESS" || lifecycle === "COMPLETED"}
                onClick={handleToggleLock}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all cursor-pointer shadow-xs ${
                  isLocked
                    ? "bg-amber-50/50 border-amber-200 hover:bg-amber-100/50 text-amber-900"
                    : "bg-indigo-50/50 border-indigo-200 hover:bg-indigo-100/50 text-indigo-900"
                } ${isTogglingLock ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                <div className="flex items-center gap-3">
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${isLocked ? "bg-amber-100 text-amber-800" : "bg-indigo-100 text-indigo-800"}`}>
                    <span className="material-symbols-outlined text-[18px]">
                      {isLocked ? "lock_open" : "lock"}
                    </span>
                  </span>
                  <div className="text-left">
                    <span className="text-xs font-bold block">
                      {isLocked ? "Unlock Draw (Back to Draft)" : "Publish & Lock Draw"}
                    </span>
                    <span className="text-[11px] opacity-80">
                      {isLocked
                        ? "Unlocks bracket for seed adjustments or re-generation"
                        : "Locks bracket against bulk regeneration and makes it official"}
                    </span>
                  </div>
                </div>
              </button>
            )}

            {/* Rebuild Draw (for Draft or Empty) */}
            {(lifecycle === "NO_DRAW" || lifecycle === "DRAFT") && (
              <button
                type="button"
                disabled={isRegenerating}
                onClick={() => handleRegenerate(false)}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#0E9C7C] hover:bg-[#0B7C63] text-white font-bold text-xs font-data-mono tracking-wider transition-all cursor-pointer shadow-sm"
              >
                <span className={`material-symbols-outlined text-[18px] ${isRegenerating ? "animate-spin" : ""}`}>
                  autorenew
                </span>
                <span>{hasDraw ? "REGENERATE DRAFT BRACKET" : "GENERATE DIGITAL BRACKET"}</span>
              </button>
            )}
          </div>

          {/* Emergency Administrative Override Accordion (For in-progress emergencies) */}
          {(lifecycle === "IN_PROGRESS" || lifecycle === "COMPLETED" || isLocked) && (
            <div className="border border-red-200 rounded-xl bg-red-50/40 p-4 space-y-3">
              <button
                type="button"
                onClick={() => setShowEmergencyReset(!showEmergencyReset)}
                className="w-full flex items-center justify-between text-left cursor-pointer"
              >
                <div className="flex items-center gap-2 text-red-800 font-bold text-xs uppercase tracking-wider">
                  <span className="material-symbols-outlined text-[16px]">warning</span>
                  Emergency Administrative Override
                </div>
                <span className="material-symbols-outlined text-[18px] text-red-600">
                  {showEmergencyReset ? "expand_less" : "expand_more"}
                </span>
              </button>

              {showEmergencyReset && (
                <div className="pt-2 border-t border-red-200 space-y-3 text-xs text-red-900">
                  <p className="leading-relaxed">
                    <strong>CAUTION:</strong> WKF rules prohibit redrawing once competition starts. Forcing a redraw will <strong>PERMANENTLY ERASE</strong> all {confirmed} confirmed match results, scores, and podiums in this category.
                  </p>
                  <p>To authorize this emergency action, type <strong>RESET</strong> below:</p>
                  <input
                    type="text"
                    value={resetConfirmInput}
                    onChange={(e) => setResetConfirmInput(e.target.value)}
                    placeholder="Type RESET to confirm"
                    className="w-full px-3 py-2 border border-red-300 rounded-lg bg-white font-data-mono text-xs text-red-950 focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                  <button
                    type="button"
                    disabled={resetConfirmInput.trim() !== "RESET" || isRegenerating}
                    onClick={() => handleRegenerate(true)}
                    className="w-full py-2.5 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold font-data-mono text-xs transition-colors cursor-pointer"
                  >
                    {isRegenerating ? "PURGING AND REBUILDING..." : "CONFIRM EMERGENCY REDRAW"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
