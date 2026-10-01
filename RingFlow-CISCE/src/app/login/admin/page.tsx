"use client";

import React, { useState, Suspense } from "react";
import { useRouter } from "next/navigation";
import { RingFlowLogo } from "@/components/ui/ringflow-logo";
import { signInWithAdminPassword } from "@/actions/auth";

function AdminLoginContent() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError("Please enter your administrator email address.");
      return;
    }
    if (!password) {
      setError("Please enter your password.");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const res = await signInWithAdminPassword({ email, password });
      if (res.success) {
        router.push("/admin");
      } else {
        setError(res.error || "Invalid email or password.");
        setIsLoading(false);
      }
    } catch (err: any) {
      setError(err.message || "Unable to connect. Please verify local network connection.");
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#FAF9F5] p-4 sm:p-6">
      <div className="w-full max-w-md bg-white border border-[#E1DDCF] rounded-2xl p-6 sm:p-8 shadow-[0_4px_24px_rgba(0,0,0,0.06)] transition-all">
        {/* Logo & Header */}
        <div className="flex flex-col items-center text-center mb-7">
          <div className="mb-4">
            <RingFlowLogo className="h-10 w-auto" />
          </div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-[#0E9C7C] bg-[#E8F6F2] border border-[#0E9C7C]/20 px-2.5 py-0.5 rounded-full mb-2">
            Local Network Edition
          </span>
          <h1 className="text-2xl sm:text-3xl font-black text-[#0F172A] tracking-tight">
            Director Console
          </h1>
          <p className="text-xs sm:text-sm text-[#64748B] mt-1">
            Sign in to manage categories, tatami rings, and draws.
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-5 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium flex items-center gap-2">
            <span className="material-symbols-outlined text-base shrink-0">error</span>
            <span>{error}</span>
          </div>
        )}

        {/* Credentials Form */}
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#334155] mb-1.5">
              Email Address
            </label>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-[#94A3B8] text-[20px] pointer-events-none">
                mail
              </span>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError("");
                }}
                placeholder="admin@ringflow.org"
                className="w-full pl-10 pr-4 py-3 bg-[#FAF9F5] border border-[#E1DDCF] rounded-xl text-sm text-[#0F172A] placeholder-[#94A3B8] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0E9C7C]/40 focus:border-[#0E9C7C] transition-all"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold uppercase tracking-wider text-[#334155]">
                Password
              </label>
            </div>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-[#94A3B8] text-[20px] pointer-events-none">
                lock
              </span>
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError("");
                }}
                placeholder="••••••••"
                className="w-full pl-10 pr-11 py-3 bg-[#FAF9F5] border border-[#E1DDCF] rounded-xl text-sm text-[#0F172A] placeholder-[#94A3B8] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0E9C7C]/40 focus:border-[#0E9C7C] transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#334155] p-1 transition-colors"
                title={showPassword ? "Hide password" : "Show password"}
              >
                <span className="material-symbols-outlined text-[18px]">
                  {showPassword ? "visibility_off" : "visibility"}
                </span>
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 flex items-center justify-center gap-2 py-3.5 px-4 bg-[#0E9C7C] hover:bg-[#0C8569] active:scale-[0.99] text-white font-bold text-sm rounded-xl transition-all shadow-[0_2px_8px_rgba(14,156,124,0.25)] disabled:opacity-60 cursor-pointer"
          >
            {isLoading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Verifying credentials...</span>
              </>
            ) : (
              <>
                <span>Sign In to Admin</span>
                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
              </>
            )}
          </button>
        </form>


        {/* Footer info */}
        <div className="mt-5 text-center">
          <p className="text-[11px] text-[#94A3B8]">
            RingFlow Tournament Operating System · Local LAN deployment
          </p>
        </div>
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen w-full items-center justify-center bg-[#FAF9F5]">
          <span className="w-6 h-6 border-2 border-[#0E9C7C]/30 border-t-[#0E9C7C] rounded-full animate-spin" />
        </div>
      }
    >
      <AdminLoginContent />
    </Suspense>
  );
}
