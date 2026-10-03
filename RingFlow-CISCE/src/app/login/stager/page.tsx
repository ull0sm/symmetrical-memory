"use client";

import React, { useState, useRef, useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import { requestStagerAccess, getCurrentStagerSession } from "@/actions/stager";
import { Turnstile } from "@marsidev/react-turnstile";
import { RingFlowLogo } from "@/components/ui/ringflow-logo";
import { v4 as uuidv4 } from "uuid";
import { isOfflineMode, isTurnstileEnabled } from "@/lib/offline";

function parseUserAgent(ua: string) {
  let browser = "Unknown";
  let os = "Unknown";
  const deviceType = /Mobile|Android|iP(ad|hone)/.test(ua) ? "Mobile" : "Desktop";

  if (ua.includes("Chrome")) browser = "Chrome";
  else if (ua.includes("Firefox")) browser = "Firefox";
  else if (ua.includes("Safari") && !ua.includes("Chrome")) browser = "Safari";
  else if (ua.includes("Edge")) browser = "Edge";

  if (ua.includes("Win")) os = "Windows";
  else if (ua.includes("Mac")) os = "MacOS";
  else if (ua.includes("Android")) os = "Android";
  else if (ua.includes("iOS") || ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";
  else if (ua.includes("Linux")) os = "Linux";

  return { browser, os, deviceType };
}

function StagerLoginContent() {
  const [accessCode, setAccessCode] = useState("");
  const [stagerName, setStagerName] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const turnstileRef = useRef<any>(null);
  const router = useRouter();

  const isOffline = isOfflineMode();
  const turnstileRequired = isTurnstileEnabled();

  useEffect(() => {
    // 1. Prefill saved name
    const savedName = localStorage.getItem("ringflow_stager_name");
    if (savedName) setStagerName(savedName);

    // 2. Auto-forward if session already active
    getCurrentStagerSession().then((res) => {
      if (res?.tournamentId) {
        router.replace(`/stager/event/${res.tournamentId}`);
      }
    }).catch(() => {});
  }, [router]);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    if (val.length > 6) val = val.slice(0, 6);
    setAccessCode(val);
    setError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stagerName.trim()) {
      setError("Please enter your name.");
      return;
    }
    if (accessCode.length < 6) {
      setError("Please enter a 6-character access code.");
      return;
    }
    if (turnstileRequired && !turnstileToken) {
      setError("Please complete the security check.");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      let deviceId = localStorage.getItem("ringflow_stager_device_id");
      if (!deviceId) {
        deviceId = uuidv4();
        localStorage.setItem("ringflow_stager_device_id", deviceId);
      }

      const { browser, os, deviceType } = parseUserAgent(navigator.userAgent);

      // Note: IP and location are resolved server-side from x-forwarded-for headers
      // in the requestStagerAccess server action — no need to call ipapi.co here.
      const deviceInfo = { deviceId, browser, os, deviceType };

      const result = await requestStagerAccess(
        accessCode,
        stagerName,
        deviceInfo,
        turnstileToken || (turnstileRequired ? "" : "offline-bypass")
      );

      if (result.success && result.requestId) {
        if (typeof window !== "undefined") {
          localStorage.setItem("ringflow_stager_name", stagerName.trim());
        }
        router.push(`/stager/waiting/${result.requestId}`);
      } else {
        setError(result.error || "Failed to submit access request.");
        turnstileRef.current?.reset();
        setTurnstileToken("");
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
      turnstileRef.current?.reset();
      setTurnstileToken("");
    } finally {
      setIsLoading(false);
    }
  };

  const percentage = (accessCode.length / 6) * 100;

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-4 font-body-md">
      <div className="w-full max-w-md bg-surface-container-lowest p-5 sm:p-card-padding border border-outline-variant rounded-xl shadow-lg text-center">
        <div className="flex items-center justify-center gap-2 mb-3">
          <RingFlowLogo className="h-8 w-8 text-primary shrink-0" />
          <span className="font-headline-sm text-headline-sm font-black text-primary tracking-tight">RingFlow</span>
        </div>
        <h1 className="font-headline-md text-headline-md font-bold text-primary mb-1">Stager Portal</h1>
        <p className="font-body-sm text-on-surface-variant mb-6">
          Enter your Stager Access Code to request entry to the tournament board
        </p>

        {isOffline && (
          <div className="mb-5 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-secondary/10 border border-secondary/20 text-secondary text-xs font-semibold">
            <span className="material-symbols-outlined text-sm">wifi_off</span>
            Offline Venue LAN Mode Active
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-error/10 border border-error/20 text-error text-label-sm font-label-sm text-left">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5 text-left">
          <div>
            <label className="font-label-caps text-label-caps text-on-surface-variant mb-1.5 block">
              YOUR NAME (REQUIRED)
            </label>
            <input
              type="text"
              required
              value={stagerName}
              onChange={(e) => {
                setStagerName(e.target.value);
                setError("");
              }}
              placeholder="E.g., Priya Mehta"
              className="w-full bg-surface-container border border-outline-variant text-on-surface px-4 py-3 rounded-lg focus:outline-none focus:border-secondary transition-all font-body-md"
            />
          </div>

          <div className="relative group">
            <label className="font-label-caps text-label-caps text-on-surface-variant mb-1.5 block">
              6-CHARACTER STAGER CODE
            </label>
            <input
              autoComplete="off"
              className="w-full bg-surface-container-lowest border border-outline-variant text-center font-data-mono tracking-[0.4em] px-4 rounded-lg focus:outline-none focus:border-secondary transition-all uppercase placeholder:opacity-20 text-headline-md py-4"
              id="stager-code"
              maxLength={6}
              placeholder="••••••"
              type="text"
              value={accessCode}
              onChange={handleInput}
            />
            <div
              className="absolute bottom-0 left-0 h-0.5 bg-secondary transition-all duration-500 rounded-b"
              style={{ width: `${percentage}%` }}
            />
          </div>

          <div className="flex justify-between items-center px-1 text-xs text-on-surface-variant">
            <span>{accessCode.length} / 6 Characters</span>
            <span className="text-[11px] opacity-80">Obtain code from tournament director</span>
          </div>

          {turnstileRequired && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ? (
            <div className="flex justify-center min-h-[65px] pt-1">
              <Turnstile
                ref={turnstileRef}
                siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
                onSuccess={(token) => {
                  setTurnstileToken(token);
                  setError("");
                }}
                onExpire={() => {
                  setTurnstileToken("");
                }}
                onError={() => {
                  setTurnstileToken("");
                }}
                options={{ theme: "light" }}
              />
            </div>
          ) : null}

          <button
            type="submit"
            disabled={
              (turnstileRequired && !turnstileToken) ||
              isLoading ||
              accessCode.length < 6 ||
              !stagerName.trim()
            }
            className="w-full bg-primary hover:bg-black text-white font-headline-sm py-4 rounded-lg transition-all flex items-center justify-center gap-2 group disabled:opacity-50 mt-2 shadow-xs"
          >
            {isLoading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                VERIFYING CODE...
              </>
            ) : (
              <>
                REQUEST ACCESS
                <span className="material-symbols-outlined text-[18px] group-hover:translate-x-1 transition-transform">
                  arrow_forward
                </span>
              </>
            )}
          </button>
        </form>

        <div className="mt-8 pt-4 border-t border-outline-variant/40 flex flex-wrap justify-center sm:justify-between items-center gap-2.5 text-xs text-on-surface-variant">
          <a href="/login/admin" className="hover:underline flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">shield</span>
            Admin Sign-in
          </a>
          <a href="/login/mod" className="hover:underline flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">lock</span>
            Tatami Moderator
          </a>
          <a href="/login/organiser" className="hover:underline flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">badge</span>
            Organiser
          </a>
        </div>
      </div>
    </div>
  );
}

export default function StagerLoginPage() {
  return (
    <Suspense fallback={<div className="flex h-screen w-full items-center justify-center bg-background">Loading...</div>}>
      <StagerLoginContent />
    </Suspense>
  );
}
