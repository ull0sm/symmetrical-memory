import { liveStreamResponse } from "@/lib/realtime/liveStream";

/** Staff change feed (401 without a staff session for the scope). See lib/realtime/liveStream.ts. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return liveStreamResponse(request, "staff");
}
