import React from "react";
import JudgeMobileClient from "@/components/judge/JudgeMobileClient";

export default async function JudgeRingPage({
  params,
  searchParams,
}: {
  params: Promise<{ ringId: string }>;
  searchParams: Promise<{ k?: string }>;
}) {
  const { ringId } = await params;
  const { k } = await searchParams;

  // `k` is the pairing key from the desk's QR code. Without it the judge types the tatami PIN.
  return <JudgeMobileClient ringId={ringId} pairingKey={typeof k === "string" ? k.slice(0, 200) : ""} />;
}
