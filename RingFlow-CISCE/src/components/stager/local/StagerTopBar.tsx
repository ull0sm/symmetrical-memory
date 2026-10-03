"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { logoutStager } from "@/actions/stager";
import LogoutConfirmModal from "@/components/ui/LogoutConfirmModal";
import BuiltByCrux from "@/components/layout/BuiltByCrux";

/**
 * The Local stager screens' top bar: where you are, a way back, and who is signed
 * in (tap to sign out). Signing out keeps the category you hold: it belongs to
 * your stager code, so signing in again with it carries on.
 */
export default function StagerTopBar({
  tournamentName,
  title,
  stagerName,
  back,
}: {
  tournamentName: string;
  title: string;
  stagerName: string;
  back?: { href: string; label: string };
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[var(--surface)]">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-3 sm:px-6">
        {back ? (
          <Link
            href={back.href}
            aria-label={back.label}
            title={back.label}
            className="-ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[var(--ink-700)] hover:bg-[var(--canvas)]"
          >
            <span className="material-symbols-outlined text-[22px]">arrow_back</span>
          </Link>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium text-[var(--ink-400)]">{tournamentName}</p>
          <p className="truncate text-[15px] font-bold leading-tight text-[var(--ink-900)]">{title}</p>
        </div>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          title={`${stagerName} · tap to sign out`}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-[999px] border border-[var(--line)] bg-[var(--canvas)] px-2.5 text-[12px] font-bold text-[var(--ink-900)] hover:border-red-200 hover:bg-red-50"
        >
          <span className="h-2 w-2 rounded-[999px] bg-[var(--accent)]" />
          <span className="max-w-[90px] truncate sm:max-w-[160px]">{stagerName}</span>
        </button>
        <BuiltByCrux imageHeightClass="h-[14px] sm:h-[17px]" className="hidden shrink-0 sm:flex" />
      </div>
      <LogoutConfirmModal
        isOpen={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={async () => {
          setLeaving(true);
          try {
            await logoutStager();
            router.push("/login/stager");
          } catch (err) {
            console.error("Sign out failed:", err);
            setLeaving(false);
          }
        }}
        isLoggingOut={leaving}
        title="Sign out of the stager desk"
        message="Any category you hold stays yours: sign in again with the same stager code to carry on."
        confirmLabel="Sign out"
      />
    </header>
  );
}
