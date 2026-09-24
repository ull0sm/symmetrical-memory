"use client";

import React, { useEffect, useState } from "react";
import { getAthleteDraw, getCategoryDraw, toggleCategoryDrawLock } from "@/actions/draws";
import { downloadCategoryDrawPdf } from "@/actions/drawPdfs";
import { DrawBracket } from "./DrawBracket";
import { KataPoolTableDraw } from "./KataPoolTableDraw";
import { useRouter } from "next/navigation";

interface Props {
  categoryId: string;
  categoryName: string;
  isOpen: boolean;
  onClose: () => void;
  onSelectMatch?: (match: any) => void;
  activeMatchId?: string | null;
  /** Load the draw through one athlete's search result instead of as a whole tree. */
  athleteId?: string | null;
  /** Extra line under the title, e.g. "Showing <name>'s path". */
  subtitle?: string;
  /** Draw sheets are an official artifact; the public side does not get them. */
  allowPdf?: boolean;
}

export function DrawBracketModal({
  categoryId,
  categoryName,
  isOpen,
  onClose,
  onSelectMatch,
  activeMatchId,
  athleteId,
  subtitle,
  allowPdf = true,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [drawData, setDrawData] = useState<any>(null);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [isTogglingLock, setIsTogglingLock] = useState(false);
  const isKata =
    categoryName?.toLowerCase().includes("kata") ||
    drawData?.categoryName?.toLowerCase()?.includes("kata") ||
    drawData?.draw?.format === "KATA_GROUP_POOLS";
  const [viewMode, setViewMode] = useState<"tree" | "tables">(
    categoryName?.toLowerCase().includes("kata") ? "tables" : "tree"
  );

  useEffect(() => {
    if (!isOpen) return;

    let mounted = true;
    setLoading(true);

    const request = athleteId ? getAthleteDraw(athleteId) : getCategoryDraw(categoryId);

    request
      .then((data) => {
        if (mounted) {
          setDrawData(data);
          const isCategoryKata =
            categoryName?.toLowerCase().includes("kata") ||
            (data && "categoryName" in data && typeof data.categoryName === "string" && data.categoryName.toLowerCase().includes("kata")) ||
            (data && "draw" in data && data.draw?.format === "KATA_GROUP_POOLS");
          if (isCategoryKata) {
            setViewMode("tables");
          }
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error("Failed to load category draw:", err);
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [categoryId, isOpen, athleteId]);

  const handleDownloadPdf = async () => {
    try {
      setIsDownloadingPdf(true);
      const res = await downloadCategoryDrawPdf(categoryId);
      if (res.success && res.base64) {
        // Download base64 as PDF
        const byteCharacters = atob(res.base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: "application/pdf" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = res.filename;
        link.click();
      }
    } catch (err: any) {
      alert(`Download failed: ${err.message}`);
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const handleToggleLock = async () => {
    if (!categoryId) return;
    setIsTogglingLock(true);
    try {
      const res = await toggleCategoryDrawLock(categoryId);
      if (res.success) {
        const isLocked = res.state === "LOCKED";
        setDrawData((prev: any) =>
          prev
            ? {
                ...prev,
                isDrawLocked: isLocked,
                drawState: res.state,
                draw: prev.draw ? { ...prev.draw, state: res.state } : prev.draw,
              }
            : prev
        );
        router.refresh();
      } else {
        alert(res.error || "Failed to update draw lock state.");
      }
    } catch (err: any) {
      alert(err?.message || "Failed to toggle lock.");
    } finally {
      setIsTogglingLock(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-xs animate-in fade-in">
      <div className="bg-[#FAF9F5] w-full max-w-6xl h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-[#E1DDCF]">
        {/* Modal Top Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-[#E1DDCF]">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg bg-emerald-50 text-[#0E9C7C] flex items-center justify-center">
              <span className="material-symbols-outlined text-[20px]">account_tree</span>
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-base text-[#1B1815]">
                  {categoryName || drawData?.categoryName || "Draw bracket"}
                </h2>
                {drawData?.isDrawLocked && (
                  <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-bold font-data-mono bg-amber-50 text-amber-800 border border-amber-200">
                    <span className="material-symbols-outlined text-[12px]">lock</span>
                    LOCKED
                  </span>
                )}
              </div>
              <p className="text-xs text-[#68645A]">
                {subtitle ||
                  (athleteId
                    ? "Showing this athlete's path, highlighted in the bracket"
                    : "Live bracket with bout results")}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* View Mode Switcher for Kata / Pools */}
            {(isKata || drawData?.draw?.format === "KATA_GROUP_POOLS") && (
              <div className="flex items-center bg-[#F5F3EC] border border-[#E1DDCF] p-0.5 rounded-lg text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setViewMode("tables")}
                  className={`px-2 py-1 rounded-md transition-colors ${
                    viewMode === "tables"
                      ? "bg-white text-[#1B1815] shadow-xs font-bold"
                      : "text-[#68645A] hover:text-[#1B1815]"
                  }`}
                >
                  Pool Tables
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("tree")}
                  className={`px-2 py-1 rounded-md transition-colors ${
                    viewMode === "tree"
                      ? "bg-white text-[#1B1815] shadow-xs font-bold"
                      : "text-[#68645A] hover:text-[#1B1815]"
                  }`}
                >
                  Bracket Tree
                </button>
              </div>
            )}

            {allowPdf && drawData?.draw && (
              <button
                type="button"
                onClick={handleToggleLock}
                disabled={isTogglingLock}
                title={
                  drawData.isDrawLocked
                    ? "Draw is LOCKED (Protected from bulk regeneration). Click to unlock."
                    : "Draw is in DRAFT. Click to lock and protect this bracket."
                }
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold font-data-mono transition-colors cursor-pointer border ${
                  drawData.isDrawLocked
                    ? "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100"
                    : "bg-[#F5F3EC] text-[#504C42] border-[#E1DDCF] hover:bg-[#ECE8DD]"
                } ${isTogglingLock ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                <span className="material-symbols-outlined text-[16px]">
                  {drawData.isDrawLocked ? "lock" : "lock_open"}
                </span>
                <span>{drawData.isDrawLocked ? "Locked" : "Lock Draw"}</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="p-2 text-[#68645A] hover:text-[#1B1815] rounded-lg hover:bg-[#F5F3EC] transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[22px]">close</span>
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 p-4 overflow-hidden">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center gap-3">
              <span className="w-8 h-8 border-3 border-[#0E9C7C] border-t-transparent rounded-full animate-spin" />
              <p className="text-sm font-medium text-[#68645A]">Loading bracket tree...</p>
            </div>
          ) : drawData?.locked ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6">
              <span className="material-symbols-outlined text-4xl text-[#8C877C] mb-2">
                lock
              </span>
              <h3 className="font-bold text-base text-[#1B1815] mb-1">Bracket not published</h3>
              <p className="text-xs text-[#68645A] max-w-sm mb-4">
                The organiser has not opened the live bracket for spectators. Search for an
                athlete to see their own path through this draw.
              </p>
            </div>
          ) : !drawData || !drawData.matches || drawData.matches.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6">
              <span className="material-symbols-outlined text-4xl text-[#8C877C] mb-2">
                schema
              </span>
              <h3 className="font-bold text-base text-[#1B1815] mb-1">No Draw Generated Yet</h3>
              <p className="text-xs text-[#68645A] max-w-sm mb-4">
                This category doesn&apos;t have an active digital draw. Click &ldquo;Generate Digital Draw&rdquo; in category options to create one.
              </p>
            </div>
          ) : viewMode === "tables" ? (
            <div className="h-full overflow-y-auto p-2">
              <KataPoolTableDraw
                drawData={drawData?.flightDraw}
                categoryName={categoryName || drawData.categoryName || "Draw"}
                matches={drawData.matches}
                allAthletes={drawData.athletes || []}
              />
            </div>
          ) : (
            <DrawBracket
              matches={drawData.matches}
              categoryName={categoryName || drawData.categoryName || "Draw"}
              tournamentSize={drawData.draw?.tournamentSize}
              bronzeMedals={drawData.bronzeMedals ?? 2}
              podium={drawData.podium ?? null}
              highlightAthleteId={drawData.highlightAthleteId ?? athleteId ?? null}
              activeMatchId={activeMatchId}
              onDownloadPdf={allowPdf ? handleDownloadPdf : undefined}
              isDownloadingPdf={isDownloadingPdf}
              onSelectMatch={
                onSelectMatch
                  ? (m) => {
                      onSelectMatch(m);
                      onClose();
                    }
                  : undefined
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
