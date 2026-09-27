"use client";

import React, { useState, useRef, Suspense } from "react";
import { useRouter } from "next/navigation";
import { requestModeratorAccess } from "@/actions/moderator";
import { Turnstile } from "@marsidev/react-turnstile";
import { RingFlowLogo } from "@/components/ui/ringflow-logo";
import { v4 as uuidv4 } from "uuid";
import { isOfflineMode, isTurnstileEnabled } from "@/lib/offline";

// Simple user-agent parser
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

function ModeratorLoginContent() {
  const [accessCode, setAccessCode] = useState("");
  const [moderatorName, setModeratorName] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const turnstileRef = useRef<any>(null);
  const router = useRouter();

  const isOffline = isOfflineMode();
  const turnstileRequired = isTurnstileEnabled();

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    if (val.length > 6) val = val.slice(0, 6);
    setAccessCode(val);
    setError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!moderatorName.trim()) {
      setError("Please enter your name.");
      return;
    }

    if (accessCode.length < 6) {
      setError("Please enter the full 6-digit access code.");
      return;
    }

    if (turnstileRequired && !turnstileToken) {
      setError("Please complete the Cloudflare security verification.");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      // 1. Get or create persistent device ID
      let deviceId = localStorage.getItem("ringflow_mod_device_id");
      if (!deviceId) {
        deviceId = uuidv4();
        localStorage.setItem("ringflow_mod_device_id", deviceId);
      }

      // 2. Parse User Agent (instant, no network call)
      const { browser, os, deviceType } = parseUserAgent(navigator.userAgent);

      // Note: IP and location are resolved server-side from x-forwarded-for headers
      // in the requestModeratorAccess server action — no need to call ipapi.co here.
      const deviceInfo = {
        deviceId,
        browser,
        os,
        deviceType,
      };

      const result = await requestModeratorAccess(
        accessCode,
        moderatorName.trim(),
        deviceInfo,
        turnstileToken || (turnstileRequired ? "" : "offline-bypass")
      );

      if (result.success && result.requestId) {
        router.push(`/moderator/waiting/${result.requestId}`);
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
        <h1 className="font-headline-md text-headline-md font-bold text-primary mb-1">Tatami Moderator Portal</h1>
        <p className="font-body-sm text-on-surface-variant mb-6">
          Enter your Tatami Access Code to request entry
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
              value={moderatorName}
              onChange={(e) => {
                setModeratorName(e.target.value);
                setError("");
              }}
              placeholder="E.g., Rahul"
              className="w-full bg-surface-container border border-outline-variant text-on-surface px-4 py-3 rounded-lg focus:outline-none focus:border-secondary transition-all font-body-md"
            />
          </div>

          <div className="relative group">
            <label className="font-label-caps text-label-caps text-on-surface-variant mb-1.5 block">
              6-CHARACTER TATAMI CODE
            </label>
            <input
              autoComplete="off"
              className="w-full bg-surface-container-lowest border border-outline-variant text-center font-data-mono tracking-[0.4em] px-4 rounded-lg focus:outline-none focus:border-secondary transition-all uppercase placeholder:opacity-20 text-headline-md py-4"
              id="access-code"
              maxLength={6}
              placeholder="••••••"
              type="text"
              value={accessCode}
              onChange={handleInput}
            />
            <div
              className="absolute bottom-0 left-0 h-0.5 bg-secondary transition-all duration-500 rounded-b"
              style={{ width: `${percentage}%` }}
            ></div>
          </div>

          <div className="flex justify-between items-center px-1 text-xs text-on-surface-variant">
            <span>{accessCode.length} / 6 Characters</span>
            <span className="text-[11px] opacity-80">Obtain code from tournament admin</span>
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
                options={{
                  theme: "light",
                }}
              />
            </div>
          ) : null}

          <button
            type="submit"
            disabled={
              (turnstileRequired && !turnstileToken) ||
              isLoading ||
              accessCode.length < 6 ||
              !moderatorName.trim()
            }
            className="w-full bg-primary hover:bg-black text-white font-headline-sm py-4 rounded-lg transition-all flex items-center justify-center gap-2 group disabled:opacity-50 mt-2 shadow-xs cursor-pointer"
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
          <a href="/login/organiser" className="hover:underline flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">badge</span>
            Organiser
          </a>
          <a href="/login/stager" className="hover:underline flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">sports_kabaddi</span>
            Stager
          </a>
        </div>
      </div>
    </div>
  );
}

export default function ModLoginPage() {
  return (
    <Suspense fallback={<div className="flex h-screen w-full items-center justify-center bg-background">Loading...</div>}>
      <ModeratorLoginContent />
    </Suspense>
  );
}
