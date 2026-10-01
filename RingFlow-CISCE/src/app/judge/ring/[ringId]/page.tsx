import React from "react";
import JudgeMobileClient from "@/components/judge/JudgeMobileClient";

export default async function JudgeRingPage({
  params,
  searchParams,
}: {
  params: Promise<{ ringId: string }>;
  searchParams: Promise<{ pin?: string }>;
}) {
  const { ringId } = await params;
  const { pin } = await searchParams;

  return <JudgeMobileClient ringId={ringId} initialPin={pin || ""} />;
}
