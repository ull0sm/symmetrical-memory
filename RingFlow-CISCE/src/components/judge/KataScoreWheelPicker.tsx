"use client";

import React, { useRef, useEffect, useCallback, useState } from "react";

interface KataScoreWheelPickerProps {
  value: number; // e.g. 7.6
  onChange: (value: number) => void;
  minWhole?: number;
  maxWhole?: number;
}

export function KataScoreWheelPicker({
  value,
  onChange,
  minWhole = 5,
  maxWhole = 10,
}: KataScoreWheelPickerProps) {
  const wholeList = Array.from(
    { length: maxWhole - minWhole + 1 },
    (_, i) => minWhole + i
  );
  const decimalList = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  // Decompose current value into whole and decimal
  const currentWhole = Math.floor(value);
  const currentDecimal = Math.round((value - currentWhole) * 10);

  const wholeRef = useRef<HTMLDivElement>(null);
  const decimalRef = useRef<HTMLDivElement>(null);

  const isUserScrollingWhole = useRef(false);
  const isUserScrollingDecimal = useRef(false);

  // Height of each item in pixels for scrolling calculation
  const ITEM_HEIGHT = 72;

  // Scroll to position without triggering infinite update loops
  const scrollToWhole = useCallback(
    (w: number, smooth = true) => {
      const el = wholeRef.current;
      if (!el) return;
      const idx = wholeList.indexOf(w);
      if (idx !== -1) {
        el.scrollTo({
          top: idx * ITEM_HEIGHT,
          behavior: smooth ? "smooth" : "instant",
        });
      }
    },
    [wholeList, ITEM_HEIGHT]
  );

  const scrollToDecimal = useCallback(
    (d: number, smooth = true) => {
      const el = decimalRef.current;
      if (!el) return;
      const idx = decimalList.indexOf(d);
      if (idx !== -1) {
        el.scrollTo({
          top: idx * ITEM_HEIGHT,
          behavior: smooth ? "smooth" : "instant",
        });
      }
    },
    [decimalList, ITEM_HEIGHT]
  );

  // Initial scroll into view
  useEffect(() => {
    scrollToWhole(currentWhole, false);
    scrollToDecimal(currentDecimal, false);
  }, []);

  // Update wheel positions if value changed externally (e.g. from preset click)
  useEffect(() => {
    if (!isUserScrollingWhole.current) {
      scrollToWhole(currentWhole, true);
    }
    if (!isUserScrollingDecimal.current) {
      scrollToDecimal(currentDecimal, true);
    }
  }, [currentWhole, currentDecimal, scrollToWhole, scrollToDecimal]);

  // Handle scroll events with haptic feedback
  const handleWholeScroll = () => {
    const el = wholeRef.current;
    if (!el) return;
    const scrollPos = el.scrollTop;
    const index = Math.round(scrollPos / ITEM_HEIGHT);
    const clampedIndex = Math.max(0, Math.min(wholeList.length - 1, index));
    const newWhole = wholeList[clampedIndex];

    if (newWhole !== undefined && newWhole !== currentWhole) {
      if (typeof window !== "undefined" && "vibrate" in navigator) {
        try {
          navigator.vibrate(8);
        } catch {}
      }
      const combined = Number((newWhole + currentDecimal / 10).toFixed(1));
      onChange(combined);
    }
  };

  const handleDecimalScroll = () => {
    const el = decimalRef.current;
    if (!el) return;
    const scrollPos = el.scrollTop;
    const index = Math.round(scrollPos / ITEM_HEIGHT);
    const clampedIndex = Math.max(0, Math.min(decimalList.length - 1, index));
    const newDecimal = decimalList[clampedIndex];

    if (newDecimal !== undefined && newDecimal !== currentDecimal) {
      if (typeof window !== "undefined" && "vibrate" in navigator) {
        try {
          navigator.vibrate(8);
        } catch {}
      }
      const combined = Number((currentWhole + newDecimal / 10).toFixed(1));
      onChange(combined);
    }
  };

  return (
    <div className="flex flex-col items-center select-none w-full">
      {/* ─── Two-Way Roller Wheel Frame ─── */}
      <div className="relative w-full max-w-xs h-[216px] overflow-hidden rounded-3xl bg-[#FAF9F5] border-2 border-[#E1DDCF] shadow-inner flex items-center justify-center">
        {/* Top & Bottom Vignette Gradient Masks */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-[#FAF9F5] via-[#FAF9F5]/70 to-transparent z-10" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#FAF9F5] via-[#FAF9F5]/70 to-transparent z-10" />

        {/* Center Target Lens Highlight */}
        <div className="pointer-events-none absolute inset-x-3 top-1/2 -translate-y-1/2 h-[72px] rounded-2xl bg-white border-2 border-[#0E9C7C] shadow-md z-0" />

        {/* Wheel Content: Columns */}
        <div className="relative z-10 flex items-center justify-center w-full h-full px-4">
          {/* Whole Number Drum */}
          <div
            ref={wholeRef}
            onScroll={handleWholeScroll}
            onTouchStart={() => (isUserScrollingWhole.current = true)}
            onTouchEnd={() => {
              setTimeout(() => (isUserScrollingWhole.current = false), 200);
            }}
            onMouseDown={() => (isUserScrollingWhole.current = true)}
            onMouseUp={() => {
              setTimeout(() => (isUserScrollingWhole.current = false), 200);
            }}
            className="flex-1 h-full overflow-y-scroll snap-y snap-mandatory no-scrollbar text-center"
            style={{ scrollbarWidth: "none" }}
          >
            {/* Top spacer (1 item height) */}
            <div style={{ height: ITEM_HEIGHT }} />
            {wholeList.map((num) => (
              <div
                key={num}
                onClick={() => {
                  scrollToWhole(num);
                  onChange(Number((num + currentDecimal / 10).toFixed(1)));
                }}
                className={`snap-center h-[72px] flex items-center justify-center text-5xl font-black font-data-mono cursor-pointer transition-all ${
                  num === currentWhole
                    ? "text-[#1B1815] scale-110"
                    : "text-[#8C877C]/50 scale-90"
                }`}
              >
                {num}
              </div>
            ))}
            {/* Bottom spacer (1 item height) */}
            <div style={{ height: ITEM_HEIGHT }} />
          </div>

          {/* Decimal Separator Dot */}
          <div className="shrink-0 flex items-center justify-center px-1 text-4xl font-black font-data-mono text-[#0E9C7C]">
            .
          </div>

          {/* Tenths Decimal Drum */}
          <div
            ref={decimalRef}
            onScroll={handleDecimalScroll}
            onTouchStart={() => (isUserScrollingDecimal.current = true)}
            onTouchEnd={() => {
              setTimeout(() => (isUserScrollingDecimal.current = false), 200);
            }}
            onMouseDown={() => (isUserScrollingDecimal.current = true)}
            onMouseUp={() => {
              setTimeout(() => (isUserScrollingDecimal.current = false), 200);
            }}
            className="flex-1 h-full overflow-y-scroll snap-y snap-mandatory no-scrollbar text-center"
            style={{ scrollbarWidth: "none" }}
          >
            {/* Top spacer (1 item height) */}
            <div style={{ height: ITEM_HEIGHT }} />
            {decimalList.map((dec) => (
              <div
                key={dec}
                onClick={() => {
                  scrollToDecimal(dec);
                  onChange(Number((currentWhole + dec / 10).toFixed(1)));
                }}
                className={`snap-center h-[72px] flex items-center justify-center text-5xl font-black font-data-mono cursor-pointer transition-all ${
                  dec === currentDecimal
                    ? "text-[#1B1815] scale-110"
                    : "text-[#8C877C]/50 scale-90"
                }`}
              >
                {dec}
              </div>
            ))}
            {/* Bottom spacer (1 item height) */}
            <div style={{ height: ITEM_HEIGHT }} />
          </div>
        </div>
      </div>

      {/* Swipe Hint */}
      <div className="flex items-center justify-between w-full max-w-xs px-2 pt-2 text-[10px] font-bold font-data-mono text-[#8C877C]">
        <span>▲ Flick left for whole</span>
        <span>Flick right for tenths ▲</span>
      </div>

      {/* Quick Presets Pills */}
      <div className="grid grid-cols-4 gap-2 w-full max-w-xs pt-3">
        {[7.0, 7.5, 8.0, 8.5].map((val) => (
          <button
            key={val}
            type="button"
            onClick={() => {
              onChange(val);
              scrollToWhole(Math.floor(val));
              scrollToDecimal(Math.round((val - Math.floor(val)) * 10));
            }}
            className={`py-2 rounded-xl border text-xs font-bold font-data-mono transition-all cursor-pointer ${
              value === val
                ? "bg-[#0E9C7C] text-white border-[#0E9C7C] shadow-xs"
                : "bg-white text-[#504C42] border-[#E1DDCF] hover:bg-[#FAF9F5]"
            }`}
          >
            {val.toFixed(1)}
          </button>
        ))}
      </div>
    </div>
  );
}
