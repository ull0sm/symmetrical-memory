import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { BracketMatchView } from "@/lib/draws/assembleDraw";
import { generateCategoryDrawPdfBytes, type CategoryDrawPdfData } from "./drawPdfGenerator";

const fighter = (id: string, name: string, school = "Shito Ryu") => ({ id, displayName: name, name, school });
const tbd = { displayName: "TBD", name: "TBD" };

function match(partial: Partial<BracketMatchView> & Pick<BracketMatchView, "matchId" | "matchNo">): BracketMatchView {
  return {
    roundNo: 0,
    roundName: "Round",
    bracketType: "MAIN",
    status: "SCHEDULED",
    aka: tbd,
    ao: tbd,
    ...partial,
  };
}

const base: Omit<CategoryDrawPdfData, "matches"> = {
  tournamentName: "Dasara · ದಸರಾ",
  categoryName: "Under 21 ಪುರುಷ",
  tournamentSize: 4,
  byeCount: 0,
  bronzeMedals: 2,
  profile: "LOCAL",
};

const bracket: BracketMatchView[] = [
  match({ matchId: "m1", matchNo: 1, roundName: "Semi-final", aka: fighter("a", "José Núñez"), ao: fighter("b", "अश्विन कुमार") }),
  match({ matchId: "m2", matchNo: 2, roundName: "Semi-final", aka: fighter("c", "ಅಶ್ವಿನ್ ಕುಮಾರ್"), ao: fighter("d", "Zoë Ångström") }),
  match({ matchId: "m3", matchNo: 3, roundNo: 1, roundName: "Final", aka: { ...tbd, sourceMatchNo: 1 }, ao: { ...tbd, sourceMatchNo: 2 } }),
];

const kata: BracketMatchView[] = [
  match({ matchId: "k1", matchNo: 1, bracketType: "POOL", poolGroup: "Pool A", kataScoringMode: "FLAG", aka: fighter("a", "José Núñez"), ao: fighter("b", "ರಾಹುಲ್ ಗೌಡ") }),
  match({ matchId: "k2", matchNo: 2, bracketType: "POOL", poolGroup: "Pool A", kataScoringMode: "FLAG", aka: fighter("c", "Solo Athlete") }),
  match({ matchId: "k3", matchNo: 3, bracketType: "MAIN", poolGroup: "Final Flight", roundName: "Final Championship Match", kataScoringMode: "FLAG" }),
];

const pageCount = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPageCount();

describe("generateCategoryDrawPdfBytes", () => {
  it("draws a small bracket with names in every supported script", async () => {
    const bytes = await generateCategoryDrawPdfBytes({ ...base, drawState: "DRAFT", matches: bracket });
    expect(await pageCount(bytes)).toBeGreaterThanOrEqual(1);
  });

  it("gives a kata flight its own pool sheet, even though it has a main final", async () => {
    const bytes = await generateCategoryDrawPdfBytes({ ...base, drawState: "LOCKED", matches: kata });
    expect(await pageCount(bytes)).toBe(1);
  });

  it("paginates a long kata flight instead of running off the page", async () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      match({ matchId: `p${i}`, matchNo: i + 1, bracketType: "POOL", poolGroup: i < 20 ? "Pool A" : "Pool B", kataScoringMode: "POINTS", aka: fighter(`a${i}`, `Athlete ${i}`), ao: fighter(`b${i}`, `Rival ${i}`) })
    );
    const bytes = await generateCategoryDrawPdfBytes({ ...base, drawState: "DRAFT", matches: many });
    expect(await pageCount(bytes)).toBeGreaterThan(1);
  });

  it("does not stamp a locked draw as a draft", async () => {
    const draft = await generateCategoryDrawPdfBytes({ ...base, drawState: "DRAFT", matches: bracket });
    const locked = await generateCategoryDrawPdfBytes({ ...base, drawState: "LOCKED", matches: bracket });
    // The draft carries the extra watermark drawing on every page.
    expect(draft.length).toBeGreaterThan(locked.length);
  });
});
