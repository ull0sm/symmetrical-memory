import fs from "node:fs";
import path from "node:path";
// fontkit's Indic shaper expects a global regeneratorRuntime that its build does not bring.
import "regenerator-runtime/runtime";
import fontkit from "@pdf-lib/fontkit";
import type { Color, PDFDocument, PDFFont, PDFPage } from "pdf-lib";

/**
 * Text for the PDFs, in the scripts athletes' names are actually written in.
 *
 * pdf-lib's built-in Helvetica only encodes Latin-1, so a name like "José" or
 * "ಅಶ್ವಿನ್" used to print as "?". The PDFs embed Noto Sans (Latin, Devanagari,
 * Kannada; bundled in public/fonts/pdf, SIL OFL) and this module picks the right
 * font for each stretch of text, so a name that mixes scripts still prints.
 */

export type Script = "latin" | "devanagari" | "kannada";

const SCRIPTS: readonly Script[] = ["latin", "devanagari", "kannada"];

/** The script a code point must be drawn in; `null` means "any font will do". */
function scriptOf(codePoint: number): Exclude<Script, "latin"> | null {
  if ((codePoint >= 0x0900 && codePoint <= 0x097f) || (codePoint >= 0xa8e0 && codePoint <= 0xa8ff)) {
    return "devanagari";
  }
  if (codePoint >= 0x0c80 && codePoint <= 0x0cff) return "kannada";
  return null;
}

const ZERO_WIDTH_JOINERS = new Set([0x200c, 0x200d]);

export interface TextRun {
  script: Script;
  text: string;
}

/**
 * Splits text into runs that each belong to one font. Spaces, digits and
 * punctuation go to the Latin font; joiners stay with the script they join, so a
 * conjunct is never torn in two.
 */
export function splitRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];

  for (const char of text.normalize("NFC")) {
    const codePoint = char.codePointAt(0) as number;
    const own = scriptOf(codePoint);
    const previous = runs[runs.length - 1];

    const script: Script =
      own ?? (ZERO_WIDTH_JOINERS.has(codePoint) && previous !== undefined ? previous.script : "latin");

    if (previous !== undefined && previous.script === script) {
      previous.text += char;
    } else {
      runs.push({ script, text: char });
    }
  }

  return runs;
}

/** A font that looks like one PDFFont to the layout code but spans several scripts. */
export class RunFont {
  private readonly supported = new Map<Script, Set<number>>();

  constructor(private readonly fonts: Readonly<Record<Script, PDFFont>>) {
    for (const script of SCRIPTS) {
      this.supported.set(script, new Set(fonts[script].getCharacterSet()));
    }
  }

  /** Replaces what the chosen font cannot draw, so one odd character never fails a whole sheet. */
  private printable(run: TextRun): string {
    const known = this.supported.get(run.script) as Set<number>;
    let out = "";

    for (const char of run.text) {
      const codePoint = char.codePointAt(0) as number;
      out += known.has(codePoint) || codePoint === 0x20 ? char : "?";
    }

    return out;
  }

  private runs(text: string | null | undefined): Array<{ font: PDFFont; text: string }> {
    if (!text) return [];
    return splitRuns(String(text).replace(/[\r\n\t]+/g, " ")).map((run) => ({
      font: this.fonts[run.script],
      text: this.printable(run),
    }));
  }

  widthOfTextAtSize(text: string | null | undefined, size: number): number {
    return this.runs(text).reduce((sum, run) => sum + run.font.widthOfTextAtSize(run.text, size), 0);
  }

  /** The Latin face, for text that has to be drawn as one piece (a rotated watermark). */
  get latin(): PDFFont {
    return this.fonts.latin;
  }

  heightAtSize(size: number): number {
    return this.fonts.latin.heightAtSize(size);
  }

  /** Draws the text, starting at x, switching font between runs. */
  draw(page: PDFPage, text: string | null | undefined, options: DrawTextOptions): void {
    let x = options.x;

    for (const run of this.runs(text)) {
      if (run.text === "") continue;
      page.drawText(run.text, { ...options, x, font: run.font });
      x += run.font.widthOfTextAtSize(run.text, options.size);
    }
  }
}

export interface DrawTextOptions {
  x: number;
  y: number;
  size: number;
  color?: Color;
}

/** Draws `text` on a page with a RunFont. The drop-in for `page.drawText`. */
export function drawText(
  page: PDFPage,
  text: string | null | undefined,
  options: DrawTextOptions & { font: RunFont }
): void {
  const { font, ...rest } = options;
  font.draw(page, text, rest);
}

export interface FontSet {
  regular: RunFont;
  bold: RunFont;
}

const FONT_DIR = path.join(process.cwd(), "public", "fonts", "pdf");
const fileCache = new Map<string, Uint8Array>();

function fontBytes(file: string): Uint8Array {
  let bytes = fileCache.get(file);
  if (bytes === undefined) {
    bytes = fs.readFileSync(path.join(FONT_DIR, file));
    fileCache.set(file, bytes);
  }
  return bytes;
}

/** Embeds the Noto Sans family in a document. Each document embeds only the glyphs it uses. */
export async function loadFontSet(pdfDoc: PDFDocument): Promise<FontSet> {
  pdfDoc.registerFontkit(fontkit);

  const embed = (file: string) => pdfDoc.embedFont(fontBytes(file), { subset: true });

  const [regular, regularDevanagari, regularKannada, bold, boldDevanagari, boldKannada] = await Promise.all([
    embed("NotoSans-Regular.ttf"),
    embed("NotoSansDevanagari-Regular.ttf"),
    embed("NotoSansKannada-Regular.ttf"),
    embed("NotoSans-Bold.ttf"),
    embed("NotoSansDevanagari-Bold.ttf"),
    embed("NotoSansKannada-Bold.ttf"),
  ]);

  return {
    regular: new RunFont({ latin: regular, devanagari: regularDevanagari, kannada: regularKannada }),
    bold: new RunFont({ latin: bold, devanagari: boldDevanagari, kannada: boldKannada }),
  };
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Splits into user-perceived characters, so a cut never separates a letter from its vowel sign. */
function clusters(text: string): string[] {
  return Array.from(graphemes.segment(text), (part) => part.segment);
}

/** Text as it will print: composed, on one line, trimmed. */
export function cleanText(text: string | null | undefined): string {
  if (!text) return "";
  return String(text).normalize("NFC").replace(/\s+/g, " ").trim();
}

/** Shortens text to fit `maxWidth`, ending in an ellipsis when it had to cut. */
export function truncateToWidth(
  text: string | null | undefined,
  font: RunFont,
  size: number,
  maxWidth: number,
  ellipsis = "…"
): string {
  const clean = cleanText(text);
  if (font.widthOfTextAtSize(clean, size) <= maxWidth) return clean;

  const parts = clusters(clean);
  while (parts.length > 1 && font.widthOfTextAtSize(`${parts.join("")}${ellipsis}`, size) > maxWidth) {
    parts.pop();
  }
  return `${parts.join("")}${ellipsis}`;
}

/** Shortens text to at most `max` characters (as a reader counts them). */
export function truncateChars(text: string | null | undefined, max: number): string {
  const parts = clusters(cleanText(text));
  return parts.length <= max ? parts.join("") : `${parts.slice(0, max - 1).join("")}…`;
}
