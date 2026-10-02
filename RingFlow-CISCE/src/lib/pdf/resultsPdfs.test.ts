import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { BracketMatchView } from "@/lib/draws/assembleDraw";
import { generateDrawStatePdfBytes } from "./drawStatePdfGenerator";
import { generateResultsPdfBytes } from "./resultsPdfGenerator";

const names = ["José Núñez", "अश्विन कुमार", "ಅಶ್ವಿನ್ ಕುಮಾರ್"];

describe("results documents", () => {
  it("prints the results table with names in every supported script", async () => {
    const bytes = await generateResultsPdfBytes({
      tournamentName: "Dasara · ದಸರಾ",
      eventDate: "2026-10-12",
      venue: "Bengaluru",
      city: null,
      rows: names.map((name, i) => ({
        categoryName: "Under 21 ಪುರುಷ",
        roundName: "Final",
        matchNo: i + 1,
        bracketType: "MAIN",
        status: "CONFIRMED",
        akaName: name,
        akaChest: "101",
        akaSchool: "Shito Ryu",
        akaScore: 3,
        akaPenalties: 0,
        aoName: names[(i + 1) % names.length] as string,
        aoChest: "102",
        aoSchool: "ಕರ್ನಾಟಕ",
        aoScore: 1,
        aoPenalties: 0,
        senshu: null,
        winnerName: name,
        decisionMethod: "POINTS",
      })),
      athleteTotals: [],
    });

    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("prints the draw state with names in every supported script", async () => {
    const matches: BracketMatchView[] = names.map((name, i) => ({
      matchId: `m${i}`,
      matchNo: i + 1,
      roundNo: 0,
      roundName: "Semi-final",
      bracketType: "MAIN",
      status: "CONFIRMED",
      aka: { id: `a${i}`, displayName: name, name, school: "ಕರ್ನಾಟಕ ಕರಾಟೆ" },
      ao: { id: `b${i}`, displayName: "Zoë Ångström", name: "Zoë Ångström", school: "Wado" },
      winnerId: `a${i}`,
      akaScore: 4,
      aoScore: 2,
    }));

    const bytes = await generateDrawStatePdfBytes({
      tournamentName: "Dasara · ದಸರಾ",
      categories: [{ categoryName: "Under 21 ಪುರುಷ", tournamentSize: 4, bronzeMedals: 2, matches }],
      generatedAt: new Date("2026-10-12T10:00:00Z"),
    });

    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
  });
});
