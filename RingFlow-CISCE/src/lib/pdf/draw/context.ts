import { PDFDocument, PDFPage, PDFImage, degrees, rgb } from "pdf-lib";
import { cleanText, drawText, loadFontSet, truncateToWidth, type RunFont } from "@/lib/pdf/pdfText";
import type { BracketMatchView } from "@/lib/draws/assembleDraw";
import fs from "fs";
import path from "path";

export type CategoryDrawPdfData = {
  tournamentName: string;
  categoryName: string;
  eventDate?: string | null;
  venue?: string | null;
  tournamentSize: number;
  byeCount: number;
  bronzeMedals?: number;
  /** 'LOCKED' draws are the official draw; anything else prints as a draft. */
  drawState?: string | null;
  /** How the draw was made: WKF procedure, or organiser's rules. */
  profile?: "OFFICIAL" | "LOCAL" | null;
  podium?: {
    goldRegistrationId?: string | null;
    silverRegistrationId?: string | null;
    bronzeRegistrationIds?: readonly string[];
  } | null;
  athletes?: Array<{ id: string; name: string; school?: string | null }>;
  /** When the category's pools run on different tatamis: the tatami name of each pool (by number) and of the finals. */
  tatamis?: { pools: Record<number, string>; finals?: string | null } | null;
  matches: BracketMatchView[];
};

/** Text as it will print. Names keep their own script; the fonts are embedded (see pdfText.ts). */
export function safeText(text: string | null | undefined): string {
  return cleanText(text);
}

/** Trim text to fit within a maxWidth without overlapping. */
export function ellipsize(text: string, font: RunFont, size: number, maxWidth: number): string {
  return truncateToWidth(text, font, size, maxWidth, "...");
}

export interface MatchCoord {
  matchId: string;
  roundIdx: number;
  x: number;
  centerY: number;
  width: number;
  height: number;
  match: BracketMatchView;
}

/**
 * Everything one draw sheet needs to draw: the document, the embedded fonts,
 * the palette, the labels for this draw's state and the shared page header.
 * Built once per sheet; the page modules in this folder draw with it.
 */
export async function createSheetContext(data: CategoryDrawPdfData) {
  const pdfDoc = await PDFDocument.create();

  const { regular: helvetica, bold: helveticaBold } = await loadFontSet(pdfDoc);
  const helveticaOblique = helvetica;

  // High-contrast palette: crisp in color, crystal clear in B&W printing
  const emerald = rgb(14 / 255, 156 / 255, 124 / 255); // #0E9C7C RingFlow brand
  const darkInk = rgb(15 / 255, 23 / 255, 42 / 255); // #0F172A slate-900 (deep black)
  const mutedInk = rgb(71 / 255, 85 / 255, 105 / 255); // #475569 slate-600
  const lightMuted = rgb(148 / 255, 163 / 255, 184 / 255); // #94A3B8 slate-400
  const lineGray = rgb(203 / 255, 213 / 255, 225 / 255); // #CBD5E1 slate-300
  const cardBg = rgb(248 / 255, 250 / 255, 252 / 255); // #F8FAFC slate-50
  const pureWhite = rgb(1, 1, 1);
  const redAka = rgb(220 / 255, 38 / 255, 38 / 255); // #DC2626
  const redAkaBg = rgb(254 / 255, 242 / 255, 242 / 255); // #FEF2F2
  const redAkaBorder = rgb(252 / 255, 165 / 255, 165 / 255); // #FCA5A5
  const blueAo = rgb(37 / 255, 99 / 255, 235 / 255); // #2563EB
  const blueAoBg = rgb(239 / 255, 246 / 255, 255 / 255); // #EFF6FF
  const blueAoBorder = rgb(147 / 255, 197 / 255, 253 / 255); // #93C5FD
  const liveBg = rgb(254 / 255, 243 / 255, 199 / 255);
  const liveAmber = rgb(217 / 255, 119 / 255, 6 / 255);
  const goldTone = rgb(180 / 255, 83 / 255, 9 / 255);
  const silverTone = rgb(71 / 255, 85 / 255, 105 / 255);
  const bronzeTone = rgb(146 / 255, 64 / 255, 14 / 255);

  // Athlete name map for podium & display
  const athleteNameById = new Map<string, { name: string; school?: string | null }>();
  if (data.athletes) {
    for (const a of data.athletes) {
      athleteNameById.set(a.id, { name: a.name, school: a.school });
    }
  }
  for (const m of data.matches) {
    if (m.aka.id && !athleteNameById.has(m.aka.id)) {
      athleteNameById.set(m.aka.id, { name: m.aka.displayName, school: m.aka.school });
    }
    if (m.ao.id && !athleteNameById.has(m.ao.id)) {
      athleteNameById.set(m.ao.id, { name: m.ao.displayName, school: m.ao.school });
    }
  }

  // Load official branding PNG from public/branding
  let brandImg: PDFImage | null = null;
  try {
    const brandPath = path.join(process.cwd(), "public", "branding", "ringflow-powered.png");
    if (fs.existsSync(brandPath)) {
      const brandBytes = fs.readFileSync(brandPath);
      brandImg = await pdfDoc.embedPng(brandBytes);
    }
  } catch (err) {
    console.warn("Failed to load branding PNG:", err);
  }

  const pageMarginX = 24;

  const isOfficialSheet = data.drawState === "LOCKED";
  // A locked draw under WKF procedure is "Official"; under organiser's rules it is simply "Final".
  const sheetLabel = !isOfficialSheet ? "Draft Draw Sheet" : data.profile === "LOCAL" ? "Final Draw Sheet" : "Official Draw Sheet";
  const profileLabel = data.profile === "OFFICIAL" ? "WKF procedure" : data.profile === "LOCAL" ? "Organiser's rules" : null;

  // What the bronze rounds on the sheet mean depends on the format the draw was made with.
  const medalRoundsTitle =
    data.bronzeMedals === 1 ? "SINGLE BRONZE BOUT" : data.bronzeMedals === 3 ? "BRONZE MEDALS" : data.bronzeMedals === 0 ? "MEDALS" : "REPECHAGE & 3RD PLACE MEDAL ROUNDS";
  const medalRoundsNote =
    data.bronzeMedals === 1
      ? "The two semi-final losers meet for a single bronze medal"
      : data.bronzeMedals === 3
        ? "Both semi-final losers are awarded bronze; no extra bouts"
        : data.bronzeMedals === 0
          ? "No bronze bout: the draw stops at the final"
          : "Athletes beaten by the finalists compete in the repechage for bronze medals";

  /** Stamps DRAFT across every page of a draw that has not been locked, then saves. */
  const finish = async (): Promise<Uint8Array> => {
    if (!isOfficialSheet) {
      for (const page of pdfDoc.getPages()) {
        const { width, height } = page.getSize();
        const text = "DRAFT";
        const size = 120;
        const angle = 32;
        const w = helveticaBold.latin.widthOfTextAtSize(text, size);
        const rad = (angle * Math.PI) / 180;
        // pdf-lib rotates about the text origin, so start where the middle of the word lands on the page's middle.
        page.drawText(text, {
          x: width / 2 - (w / 2) * Math.cos(rad) + (size * 0.35) * Math.sin(rad),
          y: height / 2 - (w / 2) * Math.sin(rad) - (size * 0.35) * Math.cos(rad),
          size,
          font: helveticaBold.latin,
          color: rgb(0.8, 0.82, 0.85),
          opacity: 0.35,
          rotate: degrees(angle),
        });
      }
    }
    // Bye bouts are never fought but still hold a number, so the printed numbers have gaps.
    if (data.byeCount > 0) {
      for (const page of pdfDoc.getPages()) {
        drawText(page, "Bout numbers match the scoring screens. A number that is missing was a bye: no bout is fought.", {
          x: pageMarginX,
          y: 8,
          size: 5.5,
          font: helvetica,
          color: lightMuted,
        });
      }
    }
    return pdfDoc.save();
  };

  // Header drawing helper
  const drawPageHeader = (page: PDFPage, width: number, height: number, customSub?: string) => {
    const headerY = height - 66;
    const headerH = 48;
    page.drawRectangle({
      x: pageMarginX,
      y: headerY,
      width: width - pageMarginX * 2,
      height: headerH,
      color: pureWhite,
      borderColor: lineGray,
      borderWidth: 1,
    });

    // Emerald brand left accent bar
    page.drawRectangle({
      x: pageMarginX,
      y: headerY,
      width: 4,
      height: headerH,
      color: emerald,
    });

    // Tournament Name
    drawText(page, safeText(data.tournamentName).toUpperCase(), {
      x: pageMarginX + 16,
      y: headerY + headerH - 16,
      size: 11.5,
      font: helveticaBold,
      color: darkInk,
    });

    // Category Name
    drawText(page, `CATEGORY: ${safeText(data.categoryName).toUpperCase()}`, {
      x: pageMarginX + 16,
      y: headerY + headerH - 31,
      size: 10,
      font: helveticaBold,
      color: emerald,
    });

    // Subtitle Line
    if (customSub) {
      drawText(page, customSub, {
        x: pageMarginX + 16,
        y: headerY + 8,
        size: 7,
        font: helvetica,
        color: mutedInk,
      });
    } else {
      const metaParts: string[] = [];
      if (data.eventDate) metaParts.push(safeText(data.eventDate));
      if (data.venue) metaParts.push(safeText(data.venue));
      metaParts.push(`Bracket Size: ${data.tournamentSize}`);
      metaParts.push(`Byes: ${data.byeCount}`);
      const formatText =
        data.bronzeMedals === 0
          ? "Single Elimination"
          : data.bronzeMedals === 1
            ? "1 Bronze Bout"
            : data.bronzeMedals === 3
              ? "Local Official (Joint 3rd Bronzes)"
              : "WKF Repechage (2 Bronzes)";
      metaParts.push(formatText);
      if (profileLabel) metaParts.push(profileLabel);
      metaParts.push(sheetLabel);

      drawText(page, metaParts.join("  |  "), {
        x: pageMarginX + 16,
        y: headerY + 8,
        size: 7,
        font: helvetica,
        color: mutedInk,
      });
    }

    // Branding PNG on top right
    if (brandImg) {
      const brandH = 34;
      const brandW = brandH * (brandImg.width / brandImg.height);
      page.drawImage(brandImg, {
        x: width - pageMarginX - brandW - 12,
        y: headerY + (headerH - brandH) / 2,
        width: brandW,
        height: brandH,
      });
    }
  };

  return {
    pdfDoc,
    helvetica,
    helveticaBold,
    emerald,
    darkInk,
    mutedInk,
    lightMuted,
    lineGray,
    cardBg,
    pureWhite,
    redAka,
    redAkaBg,
    redAkaBorder,
    blueAo,
    blueAoBg,
    blueAoBorder,
    liveBg,
    liveAmber,
    goldTone,
    silverTone,
    bronzeTone,
    athleteNameById,
    brandImg,
    pageMarginX,
    isOfficialSheet,
    sheetLabel,
    profileLabel,
    medalRoundsTitle,
    medalRoundsNote,
    finish,
    drawPageHeader,
    helveticaOblique,
    data,
  };
}

export type SheetContext = Awaited<ReturnType<typeof createSheetContext>>;
