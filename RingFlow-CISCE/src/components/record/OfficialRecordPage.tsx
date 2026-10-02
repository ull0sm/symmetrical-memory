import React from "react";
import { getAuditFilterOptions, getAuditLog } from "@/actions/audit";
import OfficialRecordClient from "@/components/record/OfficialRecordClient";

/** Shared server half of the Official Record screen (admin and organiser). */
export default async function OfficialRecordPage({ tournamentId }: { tournamentId: string }) {
  const [options, first] = await Promise.all([getAuditFilterOptions(tournamentId), getAuditLog(tournamentId)]);
  return (
    <OfficialRecordClient
      tournamentId={tournamentId}
      options={options}
      initialRows={first.rows}
      initialHasMore={first.hasMore}
    />
  );
}
