import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { cleanText, loadFontSet, splitRuns, truncateChars, truncateToWidth } from "./pdfText";

describe("splitRuns", () => {
  it("keeps accented Latin names in one run", () => {
    expect(splitRuns("José Núñez")).toEqual([{ script: "latin", text: "José Núñez" }]);
  });

  it("switches font at script boundaries and keeps spaces with Latin", () => {
    expect(splitRuns("Rahul ರಾಹುಲ್ राहुल #12").map((r) => r.script)).toEqual([
      "latin",
      "kannada",
      "latin",
      "devanagari",
      "latin",
    ]);
  });

  it("composes decomposed accents so a combining mark never prints as a separate glyph", () => {
    expect(splitRuns("Jose\u0301")[0]?.text).toBe("José");
  });

  it("keeps a zero-width joiner inside the script it joins", () => {
    const runs = splitRuns("ಕ್\u200dಷ");
    expect(runs).toHaveLength(1);
    expect(runs[0]?.script).toBe("kannada");
  });
});

describe("truncation", () => {
  it("counts characters as a reader does, not code units", () => {
    const cut = truncateChars("ಅಶ್ವಿನ್ ಕುಮಾರ್ ಶೆಟ್ಟಿ", 8);
    expect(Array.from(new Intl.Segmenter().segment(cut)).length).toBeLessThanOrEqual(8);
    expect(cut.endsWith("…")).toBe(true);
  });

  it("leaves short text alone and cleans spacing", () => {
    expect(truncateChars("  Priya   Nair ", 20)).toBe("Priya Nair");
    expect(cleanText(null)).toBe("");
  });

  it("fits text to a width without splitting a syllable", async () => {
    const doc = await PDFDocument.create();
    const { regular } = await loadFontSet(doc);
    const name = "ಅಶ್ವಿನ್ ಕುಮಾರ್ ಶೆಟ್ಟಿ ಬೆಂಗಳೂರು";
    const fitted = truncateToWidth(name, regular, 10, 60);

    expect(regular.widthOfTextAtSize(fitted, 10)).toBeLessThanOrEqual(60);
    expect(fitted.endsWith("…")).toBe(true);
    expect(name.startsWith(fitted.slice(0, -1))).toBe(true);
  });
});

describe("loadFontSet", () => {
  it("measures and draws every supported script without throwing", async () => {
    const doc = await PDFDocument.create();
    const { regular, bold } = await loadFontSet(doc);
    const page = doc.addPage([300, 100]);

    for (const text of ["José", "अश्विन कुमार", "ಅಶ್ವಿನ್ ಕುಮಾರ್", "mixed ರಾಹುಲ್ राहुल 7"]) {
      expect(regular.widthOfTextAtSize(text, 10)).toBeGreaterThan(0);
      regular.draw(page, text, { x: 10, y: 50, size: 10 });
      bold.draw(page, text, { x: 10, y: 30, size: 10 });
    }

    expect((await doc.save()).length).toBeGreaterThan(1000);
  });

  it("degrades a character no font has instead of failing the sheet", async () => {
    const doc = await PDFDocument.create();
    const { regular } = await loadFontSet(doc);
    const page = doc.addPage([200, 50]);

    expect(() => regular.draw(page, "ok 🥋 ok", { x: 5, y: 20, size: 10 })).not.toThrow();
  });
});
