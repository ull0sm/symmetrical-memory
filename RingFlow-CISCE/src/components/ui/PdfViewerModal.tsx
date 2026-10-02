"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { isOfflineMode } from "@/lib/offline";

interface PdfViewerModalProps {
  url: string | null;
  title?: string;
  onClose: () => void;
}

declare global {
  interface Window {
    pdfjsLib?: any;
  }
}

// Dynamically load Mozilla PDF.js from cdnjs without bloating project bundle.
// On an offline venue LAN there is no CDN: fail fast so the viewer falls back
// to the browser's own PDF viewer (the iframe below) instead of hanging.
function loadPdfJs(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject("Window is undefined");
  if (isOfflineMode()) return Promise.reject(new Error("Offline: using the browser's PDF viewer"));
  if (window.pdfjsLib) {
    return Promise.resolve(window.pdfjsLib);
  }

  return new Promise((resolve, reject) => {
    const existingScript = document.getElementById("pdfjs-script") as HTMLScriptElement | null;
    if (existingScript) {
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        return resolve(window.pdfjsLib);
      }
      existingScript.addEventListener("load", () => {
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
          resolve(window.pdfjsLib);
        } else {
          reject(new Error("PDF.js failed to initialize"));
        }
      });
      existingScript.addEventListener("error", reject);
      return;
    }

    const script = document.createElement("script");
    script.id = "pdfjs-script";
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.async = true;
    script.onload = () => {
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        resolve(window.pdfjsLib);
      } else {
        reject(new Error("PDF.js failed to load"));
      }
    };
    script.onerror = () => reject(new Error("Failed to load PDF viewer engine"));
    document.head.appendChild(script);
  });
}

export function PdfViewerModal({ url, title, onClose }: PdfViewerModalProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rotation, setRotation] = useState<number>(0);
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfDocRef = useRef<any>(null);

  // Handle hardware / gesture back button on mobile via popstate
  useEffect(() => {
    if (!url) return;

    window.history.pushState({ pdfModalOpen: true }, "");

    const handlePopState = () => {
      onClose();
    };

    window.addEventListener("popstate", handlePopState);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("popstate", handlePopState);
      document.body.style.overflow = prevOverflow;
    };
  }, [url, onClose]);

  // Clean close: calls onClose directly and resets history state if needed
  const handleClose = () => {
    if (typeof window !== "undefined" && window.history.state?.pdfModalOpen) {
      try {
        window.history.replaceState(null, "");
      } catch {}
    }
    onClose();
  };

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Render all pages onto HTML5 canvas elements: Fits vertically, scrolls horizontally
  const renderPdf = useCallback(async (pdf: any, rot: number = 0, zoom: number = 1.0) => {
    if (!containerRef.current || !pdf) return;

    const container = containerRef.current;
    container.innerHTML = ""; // Clear existing canvases

    try {
      // Calculate available height so the page fits vertically without vertical scrolling
      const availableHeight = scrollAreaRef.current
        ? scrollAreaRef.current.clientHeight - 36
        : 460;
      const targetHeight = Math.max(260, availableHeight);

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);

        // Native PDF.js rotation (0, 90, 180, 270)
        const totalRotation = ((page.rotate || 0) + rot) % 360;
        const unscaledViewport = page.getViewport({ scale: 1.0, rotation: totalRotation });

        // Fit height to available container height, multiplied by user zoom level
        const baseScale = targetHeight / unscaledViewport.height;
        const finalScale = Math.max(0.4, baseScale * zoom);
        const viewport = page.getViewport({ scale: finalScale, rotation: totalRotation });

        const pageWrapper = document.createElement("div");
        pageWrapper.className = "flex flex-col items-center shrink-0 select-none";

        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        if (!context) continue;

        // Support Retina / high-DPI screens for crystal clear text
        const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        canvas.className = "shadow-lg rounded-lg bg-white border border-zinc-200 dark:border-zinc-800";

        context.scale(dpr, dpr);

        pageWrapper.appendChild(canvas);

        if (pdf.numPages > 1) {
          const pageBadge = document.createElement("span");
          pageBadge.className = "text-[11px] text-zinc-500 font-medium mt-1.5 opacity-75";
          pageBadge.innerText = `Page ${pageNum} of ${pdf.numPages}`;
          pageWrapper.appendChild(pageBadge);
        }

        container.appendChild(pageWrapper);

        await page.render({
          canvasContext: context,
          viewport: viewport,
        }).promise;
      }
    } catch (err: any) {
      console.error("Error rendering PDF pages:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch and load PDF document
  const loadDocument = useCallback(async () => {
    if (!url) return;

    setIsLoading(true);
    setError(null);

    try {
      const pdfjs = await loadPdfJs();
      // Storage URLs are cached and need busting to show a fresh document, but
      // appending a query to a blob:/data: URL makes it unresolvable.
      const isInlineUrl = url.startsWith("blob:") || url.startsWith("data:");
      const freshUrl = isInlineUrl
        ? url
        : url.includes("?")
          ? `${url}&_cb=${Date.now()}`
          : `${url}?_cb=${Date.now()}`;
      const loadingTask = pdfjs.getDocument({
        url: freshUrl,
        withCredentials: false,
      });

      const pdf = await loadingTask.promise;
      pdfDocRef.current = pdf;
      await renderPdf(pdf, rotation, zoomLevel);
    } catch (err: any) {
      console.error("Failed to load PDF:", err);
      setError(err?.message || "Unable to display document in browser.");
      setIsLoading(false);
    }
  }, [url, rotation, zoomLevel, renderPdf]);

  // Initial load
  useEffect(() => {
    loadDocument();
  }, [loadDocument]);

  // Zoom In
  const handleZoomIn = () => {
    setZoomLevel((prev) => {
      const next = Math.min(2.5, +(prev + 0.25).toFixed(2));
      if (pdfDocRef.current) renderPdf(pdfDocRef.current, rotation, next);
      return next;
    });
  };

  // Zoom Out
  const handleZoomOut = () => {
    setZoomLevel((prev) => {
      const next = Math.max(0.5, +(prev - 0.25).toFixed(2));
      if (pdfDocRef.current) renderPdf(pdfDocRef.current, rotation, next);
      return next;
    });
  };

  // Rotate 90° clockwise on tap
  const handleRotate = () => {
    setRotation((prev) => {
      const next = (prev + 90) % 360;
      if (pdfDocRef.current) {
        setIsLoading(true);
        renderPdf(pdfDocRef.current, next, zoomLevel);
      }
      return next;
    });
  };

  if (!url) return null;

  return (
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center p-4 sm:p-6 bg-black/65 backdrop-blur-sm transition-all animate-in fade-in duration-200"
      onClick={handleClose}
      aria-modal="true"
      role="dialog"
    >
      {/* 80% Floating Modal Container */}
      <div
        className="relative w-[88vw] sm:w-[82vw] max-w-3xl h-[80vh] flex flex-col bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden ring-1 ring-white/10 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Minimalist Header: Title on Left, Sleek Zoom/Rotate/Close Icons on Right */}
        <div className="flex items-center justify-between px-4 py-3 bg-zinc-900 border-b border-zinc-800 shrink-0 gap-2">
          <div className="flex items-center gap-2 min-w-0 pr-2">
            <span className="material-symbols-outlined text-red-400 text-[20px] shrink-0 select-none">
              description
            </span>
            <h3 className="text-sm sm:text-base font-semibold text-zinc-100 truncate">
              {title || "Athlete List PDF"}
            </h3>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* Zoom Out */}
            <button
              type="button"
              onClick={handleZoomOut}
              disabled={isLoading || zoomLevel <= 0.5}
              className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-full transition-colors cursor-pointer disabled:opacity-30"
              title="Zoom out"
              aria-label="Zoom out"
            >
              <span className="material-symbols-outlined text-[20px] leading-none select-none">
                zoom_out
              </span>
            </button>

            {/* Zoom In */}
            <button
              type="button"
              onClick={handleZoomIn}
              disabled={isLoading || zoomLevel >= 2.5}
              className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-full transition-colors cursor-pointer disabled:opacity-30"
              title="Zoom in"
              aria-label="Zoom in"
            >
              <span className="material-symbols-outlined text-[20px] leading-none select-none">
                zoom_in
              </span>
            </button>

            {/* Rotate 90° */}
            <button
              type="button"
              onClick={handleRotate}
              disabled={isLoading}
              className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-full transition-colors cursor-pointer disabled:opacity-30"
              title="Rotate 90°"
              aria-label="Rotate document 90 degrees"
            >
              <span className="material-symbols-outlined text-[20px] leading-none select-none">
                rotate_right
              </span>
            </button>

            {/* Close */}
            <button
              type="button"
              onClick={handleClose}
              className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-full transition-colors cursor-pointer ml-0.5"
              title="Close"
              aria-label="Close"
            >
              <span className="material-symbols-outlined text-[20px] leading-none select-none">
                close
              </span>
            </button>
          </div>
        </div>

        {/* PDF Document Canvas View: Fits vertically, horizontally scrollable */}
        <div
          ref={scrollAreaRef}
          className="relative flex-1 w-full h-full bg-zinc-950 overflow-x-auto overflow-y-auto min-h-0 p-3 sm:p-4 touch-pan-x touch-pan-y"
        >
          {isLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-zinc-950/90 z-10 p-4 text-center">
              <span className="w-8 h-8 rounded-full border-2 border-red-500/20 border-t-red-500 animate-spin" />
              <span className="text-xs font-medium text-zinc-400">Loading document...</span>
            </div>
          )}

          {error && !isLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-950/95 z-10 p-4 text-center overflow-y-auto">
              <span className="material-symbols-outlined text-3xl text-amber-400">
                preview
              </span>
              <p className="text-sm font-semibold text-white">Viewing Document (Offline Mode)</p>
              <p className="text-xs text-zinc-400 max-w-sm">
                Embedded browser PDF viewer loaded for local network environment.
              </p>
              <div className="flex gap-2">
                {url && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3.5 py-1.5 bg-[#0E9C7C] hover:bg-[#0B7C63] text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
                  >
                    Open in New Tab
                  </a>
                )}
                <button
                  type="button"
                  onClick={loadDocument}
                  className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                >
                  Retry
                </button>
              </div>
              {url && (
                <div className="w-full max-w-3xl h-[65vh] mt-2 rounded-xl overflow-hidden border border-zinc-800 bg-white">
                  <iframe src={url} className="w-full h-full border-0" title={title || "PDF Document"} />
                </div>
              )}
            </div>
          )}

          {/* Dedicated Canvas Container: vertical scroll across pages, horizontal scroll per page */}
          <div
            ref={containerRef}
            className="flex flex-col items-center justify-start min-h-full w-max mx-auto gap-6 pb-6"
          />
        </div>
      </div>
    </div>
  );
}
