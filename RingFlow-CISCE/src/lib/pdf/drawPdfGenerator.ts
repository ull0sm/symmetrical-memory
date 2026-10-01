import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from "pdf-lib";
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
  podium?: {
    goldRegistrationId?: string | null;
    silverRegistrationId?: string | null;
    bronzeRegistrationIds?: readonly string[];
  } | null;
  athletes?: Array<{ id: string; name: string; school?: string | null }>;
  matches: BracketMatchView[];
};

/** pdf-lib Helvetica encoder rejects anything outside Latin-1. */
function safeText(text: string | null | undefined): string {
  if (!text) return "";
  return String(text)
    .normalize("NFKD")
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "?")
    .trim();
}

/** Trim text to fit within a maxWidth without overlapping. */
function ellipsize(text: string, font: PDFFont, size: number, maxWidth: number): string {
  const clean = safeText(text);
  if (font.widthOfTextAtSize(clean, size) <= maxWidth) return clean;
  let cut = clean;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}...`, size) > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}...`;
}

interface MatchCoord {
  matchId: string;
  roundIdx: number;
  x: number;
  centerY: number;
  width: number;
  height: number;
  match: BracketMatchView;
}

export async function generateCategoryDrawPdfBytes(
  data: CategoryDrawPdfData
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();

  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helveticaOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

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
  let brandImg: any = null;
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
    page.drawText(safeText(data.tournamentName).toUpperCase(), {
      x: pageMarginX + 16,
      y: headerY + headerH - 16,
      size: 11.5,
      font: helveticaBold,
      color: darkInk,
    });

    // Category Name
    page.drawText(`CATEGORY: ${safeText(data.categoryName).toUpperCase()}`, {
      x: pageMarginX + 16,
      y: headerY + headerH - 31,
      size: 10,
      font: helveticaBold,
      color: emerald,
    });

    // Subtitle Line
    if (customSub) {
      page.drawText(customSub, {
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
      metaParts.push("Official Draw Sheet");

      page.drawText(metaParts.join("  |  "), {
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

  // Reusable Bout Box renderer:
  // - Explicit AKA & AO badges for B&W printing
  // - NO weird nested score box beside names (clean layout!)
  // - Full width handwriting lines for unplayed bouts
  // Reusable Bout Box renderer:
  // - Supports adaptive compact mode (for dense rounds like Round of 32)
  // - Supports spacious standard mode (for rounds of 8 or fewer matches)
  // - Explicit AKA & AO badges for crisp B&W printing
  // - Repechage/Bronze bouts show 'Loser Bout #X' / 'Loser Semi-Final'
  // - NO weird nested score box beside names (clean layout!)
  const drawMatchBox = (
    p: PDFPage,
    m: BracketMatchView,
    boxX: number,
    boxY: number,
    boxW: number,
    boxH: number
  ) => {
    const isDecided = m.status === "CONFIRMED" || m.winnerId != null;
    const isLive = m.status === "LIVE";
    const isCompact = boxH <= 32;

    const akaIsBye =
      Boolean(m.aka.isBye) ||
      m.aka.displayName === "BYE" ||
      (!m.aka.id && m.status === "WALKOVER" && Boolean(m.ao.id));
    const aoIsBye =
      Boolean(m.ao.isBye) ||
      m.ao.displayName === "BYE" ||
      (!m.ao.id && m.status === "WALKOVER" && Boolean(m.aka.id));

    const isByeMatch = akaIsBye || aoIsBye;

    const akaWon = Boolean(
      m.winnerId &&
        m.aka.id &&
        m.winnerId === m.aka.id &&
        !aoIsBye
    );
    const aoWon = Boolean(
      m.winnerId &&
        m.ao.id &&
        m.winnerId === m.ao.id &&
        !akaIsBye
    );

    // Box Container
    p.drawRectangle({
      x: boxX,
      y: boxY,
      width: boxW,
      height: boxH,
      color: pureWhite,
      borderColor: isDecided && !isByeMatch ? emerald : lineGray,
      borderWidth: isDecided && !isByeMatch ? 1.2 : 0.8,
    });

    // Status Badge determination
    let statusBadge = "";
    let statusColor = mutedInk;
    if (isLive) {
      statusBadge = "LIVE";
      statusColor = liveAmber;
    } else if (isByeMatch) {
      statusBadge = "BYE ADVANCE";
      statusColor = lightMuted;
    } else if (isDecided) {
      statusBadge = "OFFICIAL";
      statusColor = emerald;
    }

    // Role word for pending slots (Loser for Repechage/Bronze, Winner for Main bracket)
    const isRepechageOrBronze = m.bracketType === "REPECHAGE" || m.bracketType === "BRONZE";
    const roleWord = isRepechageOrBronze ? "Loser" : "Winner";
    const defaultAkaGuide = isRepechageOrBronze
      ? (m.bracketType === "BRONZE" ? "Loser Semi-Final" : "Loser of Bout")
      : "Winner of Bout";
    const defaultAoGuide = isRepechageOrBronze
      ? (m.bracketType === "BRONZE" ? "Loser Semi-Final" : "Loser of Bout")
      : "Winner of Bout";

    if (isCompact) {
      // ==========================================
      // COMPACT MODE (e.g. 25 pt height for Round of 32)
      // Single-line competitor display, zero vertical clutter
      // ==========================================
      const headerBarH = 7.5;
      p.drawRectangle({
        x: boxX,
        y: boxY + boxH - headerBarH,
        width: boxW,
        height: headerBarH,
        color: isLive ? liveBg : cardBg,
        borderColor: lineGray,
        borderWidth: 0.5,
      });

      p.drawText(`BOUT #${m.matchNo}`, {
        x: boxX + 4,
        y: boxY + boxH - 6.2,
        size: 5.5,
        font: helveticaBold,
        color: isLive ? liveAmber : darkInk,
      });

      if (statusBadge) {
        const statusW = helveticaBold.widthOfTextAtSize(statusBadge, 4.8);
        p.drawText(statusBadge, {
          x: boxX + boxW - statusW - 4,
          y: boxY + boxH - 6.2,
          size: 4.8,
          font: helveticaBold,
          color: statusColor,
        });
      }

      const fighterSlotH = (boxH - headerBarH) / 2;
      const contentStartX = boxX + 22;
      const rightMarginX = boxX + boxW - 4;

      // --- AKA (Compact) ---
      const akaY = boxY + fighterSlotH;

      // Red stripe
      p.drawRectangle({
        x: boxX + 1.5,
        y: akaY + 1,
        width: 2.5,
        height: fighterSlotH - 2,
        color: redAka,
      });

      // AKA Pill
      const akaPillW = 14;
      const akaPillH = 6.8;
      p.drawRectangle({
        x: boxX + 4.5,
        y: akaY + (fighterSlotH - akaPillH) / 2,
        width: akaPillW,
        height: akaPillH,
        color: redAkaBg,
        borderColor: redAkaBorder,
        borderWidth: 0.5,
      });
      p.drawText("AKA", {
        x: boxX + 5.5,
        y: akaY + (fighterSlotH - akaPillH) / 2 + 1.2,
        size: 4.8,
        font: helveticaBold,
        color: redAka,
      });

      if (akaIsBye) {
        p.drawText("- BYE -", {
          x: contentStartX,
          y: akaY + 2,
          size: 6,
          font: helveticaOblique,
          color: lightMuted,
        });
      } else if (m.aka.id || (m.aka.displayName && m.aka.displayName !== "TBD")) {
        const scoreSpace = isDecided && !isByeMatch ? 28 : 2;
        const maxW = rightMarginX - contentStartX - scoreSpace;
        const fullName = m.aka.school ? `${m.aka.displayName} (${m.aka.school})` : m.aka.displayName;
        const akaText = ellipsize(fullName, akaWon ? helveticaBold : helvetica, 6.2, maxW);

        p.drawText(akaText, {
          x: contentStartX,
          y: akaY + 2,
          size: 6.2,
          font: akaWon ? helveticaBold : helvetica,
          color: akaWon ? emerald : darkInk,
        });

        if (isDecided && !isByeMatch) {
          if (akaWon) {
            p.drawText("WIN", {
              x: rightMarginX - 25,
              y: akaY + 2,
              size: 5,
              font: helveticaBold,
              color: emerald,
            });
          }
          const akaScoreStr = `${m.senshu === "AKA" ? "S " : ""}${m.akaScore ?? 0}`;
          const scoreW = helveticaBold.widthOfTextAtSize(akaScoreStr, 6.2);
          p.drawText(akaScoreStr, {
            x: rightMarginX - scoreW - 1,
            y: akaY + 2,
            size: 6.2,
            font: helveticaBold,
            color: akaWon ? emerald : darkInk,
          });
        }
      } else {
        const guideText = m.aka.sourceMatchNo ? `${roleWord} Bout #${m.aka.sourceMatchNo}` : defaultAkaGuide;
        p.drawText(guideText, {
          x: contentStartX,
          y: akaY + 2,
          size: 5,
          font: helvetica,
          color: lightMuted,
        });
        p.drawLine({
          start: { x: contentStartX, y: akaY + 1 },
          end: { x: rightMarginX - 2, y: akaY + 1 },
          thickness: 0.5,
          color: lineGray,
        });
      }

      // Divider
      p.drawLine({
        start: { x: boxX + 2, y: akaY },
        end: { x: boxX + boxW - 2, y: akaY },
        thickness: 0.5,
        color: lineGray,
      });

      // --- AO (Compact) ---
      const aoY = boxY;

      // Blue stripe
      p.drawRectangle({
        x: boxX + 1.5,
        y: aoY + 1,
        width: 2.5,
        height: fighterSlotH - 2,
        color: blueAo,
      });

      // AO Pill
      const aoPillW = 14;
      const aoPillH = 6.8;
      p.drawRectangle({
        x: boxX + 4.5,
        y: aoY + (fighterSlotH - aoPillH) / 2,
        width: aoPillW,
        height: aoPillH,
        color: blueAoBg,
        borderColor: blueAoBorder,
        borderWidth: 0.5,
      });
      p.drawText("AO", {
        x: boxX + 6,
        y: aoY + (fighterSlotH - aoPillH) / 2 + 1.2,
        size: 4.8,
        font: helveticaBold,
        color: blueAo,
      });

      if (aoIsBye) {
        p.drawText("- BYE -", {
          x: contentStartX,
          y: aoY + 2,
          size: 6,
          font: helveticaOblique,
          color: lightMuted,
        });
      } else if (m.ao.id || (m.ao.displayName && m.ao.displayName !== "TBD")) {
        const scoreSpace = isDecided && !isByeMatch ? 28 : 2;
        const maxW = rightMarginX - contentStartX - scoreSpace;
        const fullName = m.ao.school ? `${m.ao.displayName} (${m.ao.school})` : m.ao.displayName;
        const aoText = ellipsize(fullName, aoWon ? helveticaBold : helvetica, 6.2, maxW);

        p.drawText(aoText, {
          x: contentStartX,
          y: aoY + 2,
          size: 6.2,
          font: aoWon ? helveticaBold : helvetica,
          color: aoWon ? emerald : darkInk,
        });

        if (isDecided && !isByeMatch) {
          if (aoWon) {
            p.drawText("WIN", {
              x: rightMarginX - 25,
              y: aoY + 2,
              size: 5,
              font: helveticaBold,
              color: emerald,
            });
          }
          const aoScoreStr = `${m.senshu === "AO" ? "S " : ""}${m.aoScore ?? 0}`;
          const scoreW = helveticaBold.widthOfTextAtSize(aoScoreStr, 6.2);
          p.drawText(aoScoreStr, {
            x: rightMarginX - scoreW - 1,
            y: aoY + 2,
            size: 6.2,
            font: helveticaBold,
            color: aoWon ? emerald : darkInk,
          });
        }
      } else {
        const guideText = m.ao.sourceMatchNo ? `${roleWord} Bout #${m.ao.sourceMatchNo}` : defaultAoGuide;
        p.drawText(guideText, {
          x: contentStartX,
          y: aoY + 2,
          size: 5,
          font: helvetica,
          color: lightMuted,
        });
        p.drawLine({
          start: { x: contentStartX, y: aoY + 1 },
          end: { x: rightMarginX - 2, y: aoY + 1 },
          thickness: 0.5,
          color: lineGray,
        });
      }
    } else {
      // ==========================================
      // STANDARD SPACIOUS MODE (for rounds with <= 8 matches)
      // Two-tier display: Name on top, School cleanly below with zero overlap
      // ==========================================
      const headerBarH = 10.5;
      p.drawRectangle({
        x: boxX,
        y: boxY + boxH - headerBarH,
        width: boxW,
        height: headerBarH,
        color: isLive ? liveBg : cardBg,
        borderColor: lineGray,
        borderWidth: 0.5,
      });

      p.drawText(`BOUT #${m.matchNo}`, {
        x: boxX + 6,
        y: boxY + boxH - 8.5,
        size: 6.8,
        font: helveticaBold,
        color: isLive ? liveAmber : darkInk,
      });

      if (statusBadge) {
        const statusW = helveticaBold.widthOfTextAtSize(statusBadge, 6);
        p.drawText(statusBadge, {
          x: boxX + boxW - statusW - 6,
          y: boxY + boxH - 8.5,
          size: 6,
          font: helveticaBold,
          color: statusColor,
        });
      }

      const fighterSlotH = (boxH - headerBarH) / 2;
      const contentStartX = boxX + 27;
      const rightMarginX = boxX + boxW - 6;

      // --- AKA (Red) Slot ---
      const akaY = boxY + fighterSlotH;

      // Red left stripe
      p.drawRectangle({
        x: boxX + 2,
        y: akaY + 2,
        width: 3,
        height: fighterSlotH - 4,
        color: redAka,
      });

      // Explicit AKA Pill
      const akaPillW = 18;
      const akaPillH = 8.5;
      p.drawRectangle({
        x: boxX + 6,
        y: akaY + fighterSlotH - 11,
        width: akaPillW,
        height: akaPillH,
        color: redAkaBg,
        borderColor: redAkaBorder,
        borderWidth: 0.5,
      });
      p.drawText("AKA", {
        x: boxX + 7.5,
        y: akaY + fighterSlotH - 9,
        size: 5.5,
        font: helveticaBold,
        color: redAka,
      });

      if (akaIsBye) {
        p.drawText("- BYE -", {
          x: contentStartX,
          y: akaY + (fighterSlotH - 7) / 2,
          size: 7.5,
          font: helveticaOblique,
          color: lightMuted,
        });
      } else if (m.aka.id || (m.aka.displayName && m.aka.displayName !== "TBD")) {
        const hasSchool = Boolean(m.aka.school);
        const nameY = hasSchool ? akaY + 8.5 : akaY + (fighterSlotH - 8) / 2;

        const scoreSpace = isDecided && !isByeMatch ? 38 : 6;
        const maxNameW = rightMarginX - contentStartX - scoreSpace;
        const akaName = ellipsize(m.aka.displayName, akaWon ? helveticaBold : helvetica, 7.5, maxNameW);

        p.drawText(akaName, {
          x: contentStartX,
          y: nameY,
          size: 7.5,
          font: akaWon ? helveticaBold : helvetica,
          color: akaWon ? emerald : darkInk,
        });

        if (isDecided && !isByeMatch) {
          if (akaWon) {
            p.drawText("WIN", {
              x: rightMarginX - 34,
              y: nameY,
              size: 6,
              font: helveticaBold,
              color: emerald,
            });
          }
          const akaScoreStr = `${m.senshu === "AKA" ? "S " : ""}${m.akaScore ?? 0}`;
          const scoreW = helveticaBold.widthOfTextAtSize(akaScoreStr, 7.5);
          p.drawText(akaScoreStr, {
            x: rightMarginX - scoreW - 1,
            y: nameY,
            size: 7.5,
            font: helveticaBold,
            color: akaWon ? emerald : darkInk,
          });
        }

        if (hasSchool) {
          const akaSchool = ellipsize(m.aka.school || "", helvetica, 5.5, rightMarginX - contentStartX);
          p.drawText(akaSchool, {
            x: contentStartX,
            y: akaY + 1.8,
            size: 5.5,
            font: helvetica,
            color: mutedInk,
          });
        }
      } else {
        const guideText = m.aka.sourceMatchNo ? `${roleWord} Bout #${m.aka.sourceMatchNo}` : defaultAkaGuide;
        p.drawText(guideText, {
          x: contentStartX,
          y: akaY + fighterSlotH - 9,
          size: 5.5,
          font: helvetica,
          color: lightMuted,
        });
        p.drawLine({
          start: { x: contentStartX, y: akaY + 2.5 },
          end: { x: rightMarginX - 2, y: akaY + 2.5 },
          thickness: 0.6,
          color: lineGray,
        });
      }

      // Divider Line between AKA and AO
      p.drawLine({
        start: { x: boxX + 4, y: akaY },
        end: { x: boxX + boxW - 4, y: akaY },
        thickness: 0.5,
        color: lineGray,
      });

      // --- AO (Blue) Slot ---
      const aoY = boxY;

      // Blue left stripe
      p.drawRectangle({
        x: boxX + 2,
        y: aoY + 2,
        width: 3,
        height: fighterSlotH - 4,
        color: blueAo,
      });

      // Explicit AO Pill
      const aoPillW = 16;
      const aoPillH = 8.5;
      p.drawRectangle({
        x: boxX + 6,
        y: aoY + fighterSlotH - 11,
        width: aoPillW,
        height: aoPillH,
        color: blueAoBg,
        borderColor: blueAoBorder,
        borderWidth: 0.5,
      });
      p.drawText("AO", {
        x: boxX + 7.5,
        y: aoY + fighterSlotH - 9,
        size: 5.5,
        font: helveticaBold,
        color: blueAo,
      });

      if (aoIsBye) {
        p.drawText("- BYE -", {
          x: contentStartX,
          y: aoY + (fighterSlotH - 7) / 2,
          size: 7.5,
          font: helveticaOblique,
          color: lightMuted,
        });
      } else if (m.ao.id || (m.ao.displayName && m.ao.displayName !== "TBD")) {
        const hasSchool = Boolean(m.ao.school);
        const nameY = hasSchool ? aoY + 8.5 : aoY + (fighterSlotH - 8) / 2;

        const scoreSpace = isDecided && !isByeMatch ? 38 : 6;
        const maxNameW = rightMarginX - contentStartX - scoreSpace;
        const aoName = ellipsize(m.ao.displayName, aoWon ? helveticaBold : helvetica, 7.5, maxNameW);

        p.drawText(aoName, {
          x: contentStartX,
          y: nameY,
          size: 7.5,
          font: aoWon ? helveticaBold : helvetica,
          color: aoWon ? emerald : darkInk,
        });

        if (isDecided && !isByeMatch) {
          if (aoWon) {
            p.drawText("WIN", {
              x: rightMarginX - 34,
              y: nameY,
              size: 6,
              font: helveticaBold,
              color: emerald,
            });
          }
          const aoScoreStr = `${m.senshu === "AO" ? "S " : ""}${m.aoScore ?? 0}`;
          const scoreW = helveticaBold.widthOfTextAtSize(aoScoreStr, 7.5);
          p.drawText(aoScoreStr, {
            x: rightMarginX - scoreW - 1,
            y: nameY,
            size: 7.5,
            font: helveticaBold,
            color: aoWon ? emerald : darkInk,
          });
        }

        if (hasSchool) {
          const aoSchool = ellipsize(m.ao.school || "", helvetica, 5.5, rightMarginX - contentStartX);
          p.drawText(aoSchool, {
            x: contentStartX,
            y: aoY + 1.8,
            size: 5.5,
            font: helvetica,
            color: mutedInk,
          });
        }
      } else {
        const guideText = m.ao.sourceMatchNo ? `${roleWord} Bout #${m.ao.sourceMatchNo}` : defaultAoGuide;
        p.drawText(guideText, {
          x: contentStartX,
          y: aoY + fighterSlotH - 9,
          size: 5.5,
          font: helvetica,
          color: lightMuted,
        });
        p.drawLine({
          start: { x: contentStartX, y: aoY + 2.5 },
          end: { x: rightMarginX - 2, y: aoY + 2.5 },
          thickness: 0.6,
          color: lineGray,
        });
      }
    }
  };

  // Reusable Podium Card renderer placed in bottom-right
  const drawPodiumCard = (p: PDFPage, cardX: number, cardY: number, cardW: number, cardH: number) => {
    p.drawRectangle({
      x: cardX,
      y: cardY,
      width: cardW,
      height: cardH,
      color: pureWhite,
      borderColor: lineGray,
      borderWidth: 1,
    });

    // Card Header Bar
    p.drawRectangle({
      x: cardX,
      y: cardY + cardH - 18,
      width: cardW,
      height: 18,
      color: cardBg,
      borderColor: lineGray,
      borderWidth: 0.5,
    });

    p.drawText("OFFICIAL RESULTS / PODIUM", {
      x: cardX + 8,
      y: cardY + cardH - 13,
      size: 7.5,
      font: helveticaBold,
      color: darkInk,
    });

    const goldAth = data.podium?.goldRegistrationId
      ? athleteNameById.get(data.podium.goldRegistrationId)
      : null;
    const silverAth = data.podium?.silverRegistrationId
      ? athleteNameById.get(data.podium.silverRegistrationId)
      : null;
    const bronze1Ath = data.podium?.bronzeRegistrationIds?.[0]
      ? athleteNameById.get(data.podium.bronzeRegistrationIds[0])
      : null;
    const bronze2Ath = data.podium?.bronzeRegistrationIds?.[1]
      ? athleteNameById.get(data.podium.bronzeRegistrationIds[1])
      : null;

    const medalRows = [
      { rank: "1ST / GOLD", color: goldTone, athlete: goldAth },
      { rank: "2ND / SILVER", color: silverTone, athlete: silverAth },
      { rank: "3RD / BRONZE", color: bronzeTone, athlete: bronze1Ath },
    ];
    if (data.bronzeMedals !== 1) {
      medalRows.push({ rank: "3RD / BRONZE", color: bronzeTone, athlete: bronze2Ath });
    }

    const rowH = (cardH - 22) / medalRows.length;
    medalRows.forEach((row, idx) => {
      const rowY = cardY + cardH - 22 - (idx + 1) * rowH;

      p.drawText(row.rank, {
        x: cardX + 8,
        y: rowY + rowH / 2 - 2,
        size: 6.5,
        font: helveticaBold,
        color: row.color,
      });

      if (row.athlete) {
        const athName = ellipsize(row.athlete.name, helveticaBold, 7.5, cardW - 96);
        p.drawText(athName, {
          x: cardX + 72,
          y: rowY + rowH / 2 - 1,
          size: 7.5,
          font: helveticaBold,
          color: darkInk,
        });

        if (row.athlete.school) {
          const athSchool = ellipsize(row.athlete.school, helvetica, 5.5, cardW - 96);
          p.drawText(athSchool, {
            x: cardX + 72,
            y: rowY + 2,
            size: 5.5,
            font: helvetica,
            color: mutedInk,
          });
        }
      } else {
        p.drawLine({
          start: { x: cardX + 72, y: rowY + rowH / 2 },
          end: { x: cardX + cardW - 12, y: rowY + rowH / 2 },
          thickness: 0.6,
          color: lineGray,
        });
      }

      if (idx < medalRows.length - 1) {
        p.drawLine({
          start: { x: cardX + 6, y: rowY },
          end: { x: cardX + cardW - 6, y: rowY },
          thickness: 0.5,
          color: lineGray,
        });
      }
    });
  };

  // Classify Matches
  const mainMatches = data.matches.filter((m) => m.bracketType === "MAIN");
  const repechageMatches = data.matches
    .filter((m) => m.bracketType === "REPECHAGE")
    .sort((a, b) => a.matchNo - b.matchNo);
  const bronzeMatches = data.matches
    .filter((m) => m.bracketType === "BRONZE")
    .sort((a, b) => a.matchNo - b.matchNo);
  const poolMatches = data.matches
    .filter((m) => m.bracketType === "POOL")
    .sort((a, b) => a.matchNo - b.matchNo);

  const hasRepechageOrBronze = repechageMatches.length > 0 || bronzeMatches.length > 0;

  // Helper to detect pure BYE matches
  const isMatchBye = (m: BracketMatchView): boolean => {
    const akaIsBye =
      Boolean(m.aka.isBye) ||
      m.aka.displayName === "BYE" ||
      (!m.aka.id && m.status === "WALKOVER" && Boolean(m.ao.id));
    const aoIsBye =
      Boolean(m.ao.isBye) ||
      m.ao.displayName === "BYE" ||
      (!m.ao.id && m.status === "WALKOVER" && Boolean(m.aka.id));
    return akaIsBye || aoIsBye;
  };

  // Group Main Matches by Round
  const roundsMap = new Map<number, BracketMatchView[]>();
  for (const m of mainMatches) {
    const list = roundsMap.get(m.roundNo) ?? [];
    list.push(m);
    roundsMap.set(m.roundNo, list);
  }

  // Preserve full list of Round 0 matches for slot indexing & feeder mapping
  const round0MatchesAll = (roundsMap.get(0) ?? []).slice().sort((a, b) => a.matchNo - b.matchNo);
  const totalRound0Slots = round0MatchesAll.length;
  const realRound0Matches = round0MatchesAll.filter((m) => !isMatchBye(m));
  const realRound0Count = realRound0Matches.length;

  const isKumiteOrElimination = mainMatches.length > 0;
  const is32Bracket = totalRound0Slots === 16 || data.tournamentSize === 32;
  const is64OrLargerBracket = totalRound0Slots >= 32 || data.tournamentSize >= 64;

  // Standard is Round of 16.
  // If 32 bracket has "very less people" (specifically <= 2 non-bye bouts in Round 0), extend 32 on a single page.
  // If anything exceeds that (> 2 preliminary bouts, or size 64+), split into standard Pools of 16 (16 + 16 for 32, 4 x 16 for 64).
  const shouldSplitIntoPools =
    isKumiteOrElimination &&
    (is64OrLargerBracket || (is32Bracket && realRound0Count > 2));

  if (shouldSplitIntoPools) {
    const numPools = Math.max(2, Math.ceil(totalRound0Slots / 8));
    const r1All = (roundsMap.get(1) ?? []).slice().sort((a, b) => a.matchNo - b.matchNo);
    const r2All = (roundsMap.get(2) ?? []).slice().sort((a, b) => a.matchNo - b.matchNo);
    const r3All = (roundsMap.get(3) ?? []).slice().sort((a, b) => a.matchNo - b.matchNo);

    for (let p = 0; p < numPools; p++) {
      const poolPage = pdfDoc.addPage([842, 595]);
      const { width: pWidth, height: pHeight } = poolPage.getSize();
      const poolLetter = String.fromCharCode(65 + p);
      const poolNumber = p + 1;

      // Extract exact binary subtree for this pool (8, 4, 2, 1 matches)
      const r0Matches = round0MatchesAll.slice(p * 8, p * 8 + 8);
      const r1Matches = r1All.slice(p * 4, p * 4 + 4);
      const r2Matches = r2All.slice(p * 2, p * 2 + 2);
      const r3Matches = r3All.slice(p * 1, p * 1 + 1);

      const poolRounds = [r0Matches, r1Matches, r2Matches, r3Matches];

      // Identify target advancement match for Pool Final
      let targetAdvName = "GRAND FINAL";
      let targetAdvShort = "GRAND FINAL";
      if (totalRound0Slots >= 32) {
        // Size 64: Pool winners advance to Semi-Finals
        const sfIndex = Math.floor(p / 2);
        const sfMatch = roundsMap.get(4)?.[sfIndex];
        targetAdvName = sfMatch ? `SEMI-FINAL ${sfIndex + 1} (BOUT #${sfMatch.matchNo})` : `SEMI-FINAL ${sfIndex + 1}`;
        targetAdvShort = sfMatch ? `SEMI-FINAL #${sfMatch.matchNo}` : `SEMI-FINAL ${sfIndex + 1}`;
      } else {
        // Size 32: Pool winners advance to Grand Final
        const finalMatch = roundsMap.get(4)?.[0];
        targetAdvName = finalMatch ? `GRAND FINAL (BOUT #${finalMatch.matchNo})` : "GRAND FINAL";
        targetAdvShort = finalMatch ? `FINAL #${finalMatch.matchNo}` : "GRAND FINAL";
      }

      drawPageHeader(
        poolPage,
        pWidth,
        pHeight,
        `POOL ${poolNumber} (POOL ${poolLetter}) — 16-COMPETITOR BRACKET  |  Winner advances to ${targetAdvName}`
      );

      const topY = pHeight - 74;
      const roundTitleY = topY - 10;
      const treeTopY = roundTitleY - 14;
      const bottomSignaturesY = 36;
      const usableTreeHeight = treeTopY - bottomSignaturesY;

      const poolColWidth = 145;
      const poolColGap = 42;
      const poolMatchCoords = new Map<string, MatchCoord>();

      poolRounds.forEach((roundMatches, rIdx) => {
        const colX = pageMarginX + rIdx * (poolColWidth + poolColGap);
        const matchCount = roundMatches.length;

        let colTitle = "";
        if (rIdx === 0) {
          colTitle = totalRound0Slots >= 32 ? "ROUND OF 64" : "ROUND OF 32";
        } else if (rIdx === 1) {
          colTitle = totalRound0Slots >= 32 ? "ROUND OF 32" : "ROUND OF 16";
        } else if (rIdx === 2) {
          colTitle = totalRound0Slots >= 32 ? "ROUND OF 16" : "QUARTER-FINALS";
        } else {
          colTitle = totalRound0Slots >= 32 ? `QUARTER-FINAL (POOL ${poolLetter})` : `SEMI-FINAL ${poolNumber} (POOL ${poolLetter})`;
        }

        // Column Header
        poolPage.drawText(colTitle, {
          x: colX + 2,
          y: roundTitleY,
          size: 8,
          font: helveticaBold,
          color: emerald,
        });

        poolPage.drawLine({
          start: { x: colX, y: roundTitleY - 5 },
          end: { x: colX + poolColWidth, y: roundTitleY - 5 },
          thickness: 1.5,
          color: emerald,
        });

        // Box Heights: spacious, clear, zero cramped text
        let boxHeight = 54;
        if (matchCount === 8) {
          boxHeight = 44;
        } else if (matchCount === 4) {
          boxHeight = 48;
        } else if (matchCount === 2) {
          boxHeight = 52;
        } else {
          boxHeight = 54;
        }

        const slotH = usableTreeHeight / matchCount;

        roundMatches.forEach((match, mIdx) => {
          const centerY = treeTopY - (mIdx + 0.5) * slotH;
          const boxY = centerY - boxHeight / 2;

          drawMatchBox(poolPage, match, colX, boxY, poolColWidth, boxHeight);

          poolMatchCoords.set(match.matchId, {
            matchId: match.matchId,
            roundIdx: rIdx,
            x: colX,
            centerY,
            width: poolColWidth,
            height: boxHeight,
            match,
          });
        });
      });

      // Draw Orthogonal Connector Lines for this pool
      for (let rIdx = 0; rIdx < 3; rIdx++) {
        const curMatches = poolRounds[rIdx];
        const nextMatches = poolRounds[rIdx + 1];
        const fromColX = pageMarginX + rIdx * (poolColWidth + poolColGap);
        const toColX = pageMarginX + (rIdx + 1) * (poolColWidth + poolColGap);
        const branchX = fromColX + poolColWidth + poolColGap / 2;

        nextMatches.forEach((nextMatch, nextIdx) => {
          const f1 = curMatches[2 * nextIdx];
          const f2 = curMatches[2 * nextIdx + 1];
          const c1 = f1 ? poolMatchCoords.get(f1.matchId) : null;
          const c2 = f2 ? poolMatchCoords.get(f2.matchId) : null;
          const nextCoord = poolMatchCoords.get(nextMatch.matchId);

          if (c1 && c2 && nextCoord) {
            const yTop = Math.max(c1.centerY, c2.centerY);
            const yBottom = Math.min(c1.centerY, c2.centerY);
            const yTarget = nextCoord.centerY;

            const f1Won = Boolean(f1?.winnerId && nextMatch.winnerId === f1.winnerId);
            const f2Won = Boolean(f2?.winnerId && nextMatch.winnerId === f2.winnerId);

            poolPage.drawLine({
              start: { x: fromColX + poolColWidth, y: yTop },
              end: { x: branchX, y: yTop },
              thickness: f1Won ? 1.4 : 1.1,
              color: f1Won ? emerald : lightMuted,
            });

            poolPage.drawLine({
              start: { x: fromColX + poolColWidth, y: yBottom },
              end: { x: branchX, y: yBottom },
              thickness: f2Won ? 1.4 : 1.1,
              color: f2Won ? emerald : lightMuted,
            });

            poolPage.drawLine({
              start: { x: branchX, y: yTop },
              end: { x: branchX, y: yBottom },
              thickness: 1.1,
              color: lightMuted,
            });

            poolPage.drawLine({
              start: { x: branchX, y: yTarget },
              end: { x: toColX, y: yTarget },
              thickness: f1Won || f2Won ? 1.4 : 1.1,
              color: f1Won || f2Won ? emerald : lightMuted,
            });
          }
        });
      }

      // Draw Pool Winner Advancement Banner
      const poolFinalMatch = r3Matches[0];
      if (poolFinalMatch) {
        const finalCoord = poolMatchCoords.get(poolFinalMatch.matchId);
        if (finalCoord) {
          const stemStartX = finalCoord.x + finalCoord.width;
          const stemEndX = stemStartX + 14;
          const finalY = finalCoord.centerY;

          poolPage.drawLine({
            start: { x: stemStartX, y: finalY },
            end: { x: stemEndX, y: finalY },
            thickness: 1.4,
            color: emerald,
          });

          const badgeW = 72;
          const badgeH = 28;
          const badgeX = stemEndX;
          const badgeY = finalY - badgeH / 2;

          poolPage.drawRectangle({
            x: badgeX,
            y: badgeY,
            width: badgeW,
            height: badgeH,
            color: pureWhite,
            borderColor: emerald,
            borderWidth: 1.2,
          });

          poolPage.drawRectangle({
            x: badgeX,
            y: badgeY,
            width: 3.5,
            height: badgeH,
            color: emerald,
          });

          poolPage.drawText("QUALIFIES FOR", {
            x: badgeX + 7,
            y: badgeY + 16,
            size: 5.5,
            font: helveticaBold,
            color: emerald,
          });

          poolPage.drawText(ellipsize(targetAdvShort, helveticaBold, 6.8, badgeW - 12), {
            x: badgeX + 7,
            y: badgeY + 6,
            size: 6.8,
            font: helveticaBold,
            color: darkInk,
          });
        }
      }

      // Signatures at bottom of pool sheet
      poolPage.drawText("Chief Referee: ___________________________", {
        x: pageMarginX + 16,
        y: 16,
        size: 7,
        font: helvetica,
        color: darkInk,
      });

      poolPage.drawText("Tatami Manager: ___________________________", {
        x: pageMarginX + 260,
        y: 16,
        size: 7,
        font: helvetica,
        color: darkInk,
      });

      poolPage.drawText(
        `Pool ${poolNumber} (Pool ${poolLetter}) Official Draw Sheet  ·  RingFlow Tournament Engine`,
        {
          x: pWidth - pageMarginX - 250,
          y: 16,
          size: 6.5,
          font: helvetica,
          color: mutedInk,
        }
      );
    }

    // --- FINALS PAGE ---
    const finalsPage = pdfDoc.addPage([842, 595]);
    const { width: fWidth, height: fHeight } = finalsPage.getSize();
    drawPageHeader(finalsPage, fWidth, fHeight, "CHAMPIONSHIP FINALS, REPECHAGE MEDAL ROUNDS & OFFICIAL PODIUM");

    const leftColW = 486;
    const rightColX = pageMarginX + leftColW + 28;
    const rightColW = fWidth - pageMarginX - rightColX;

    const finalsTopY = fHeight - 74;

    // SECTION 1: Championship Final(s)
    finalsPage.drawText("OFFICIAL CHAMPIONSHIP FINAL", {
      x: pageMarginX + 4,
      y: finalsTopY - 10,
      size: 10,
      font: helveticaBold,
      color: emerald,
    });

    finalsPage.drawLine({
      start: { x: pageMarginX, y: finalsTopY - 15 },
      end: { x: pageMarginX + leftColW, y: finalsTopY - 15 },
      thickness: 1.5,
      color: emerald,
    });

    if (totalRound0Slots >= 32) {
      // 64-entrant finals: Semi-Finals 1 & 2 feeding into Grand Final
      finalsPage.drawText("Semi-Finals & Grand Final Championship Matches", {
        x: pageMarginX + 4,
        y: finalsTopY - 26,
        size: 6.5,
        font: helvetica,
        color: mutedInk,
      });

      const sfMatches = roundsMap.get(4) ?? [];
      const grandFinalMatch = roundsMap.get(5)?.[0] || mainMatches[mainMatches.length - 1];

      const sf1 = sfMatches[0];
      const sf2 = sfMatches[1];

      const sfBoxW = 210;
      const sfBoxH = 48;
      const sf1Y = finalsTopY - 84;
      const sf2Y = finalsTopY - 146;

      if (sf1) drawMatchBox(finalsPage, sf1, pageMarginX, sf1Y, sfBoxW, sfBoxH);
      if (sf2) drawMatchBox(finalsPage, sf2, pageMarginX, sf2Y, sfBoxW, sfBoxH);

      const finalBoxW = 230;
      const finalBoxH = 68;
      const finalBoxX = pageMarginX + sfBoxW + 46;
      const finalBoxY = (sf1Y + sf2Y) / 2 - finalBoxH / 2 + 24;

      if (grandFinalMatch) {
        drawMatchBox(finalsPage, grandFinalMatch, finalBoxX, finalBoxY, finalBoxW, finalBoxH);
      }

      // Orthogonal connector from SF1/SF2 to Grand Final
      const branchX = pageMarginX + sfBoxW + 23;
      const sf1Center = sf1Y + sfBoxH / 2;
      const sf2Center = sf2Y + sfBoxH / 2;
      const finalCenter = finalBoxY + finalBoxH / 2;

      finalsPage.drawLine({ start: { x: pageMarginX + sfBoxW, y: sf1Center }, end: { x: branchX, y: sf1Center }, thickness: 1.2, color: lightMuted });
      finalsPage.drawLine({ start: { x: pageMarginX + sfBoxW, y: sf2Center }, end: { x: branchX, y: sf2Center }, thickness: 1.2, color: lightMuted });
      finalsPage.drawLine({ start: { x: branchX, y: sf1Center }, end: { x: branchX, y: sf2Center }, thickness: 1.2, color: lightMuted });
      finalsPage.drawLine({ start: { x: branchX, y: finalCenter }, end: { x: finalBoxX, y: finalCenter }, thickness: 1.4, color: emerald });
    } else {
      // 32-entrant final: Single Grand Final bout prominently displayed
      finalsPage.drawText("Gold Medal Bout — Pool 1 (Pool A) Winner vs Pool 2 (Pool B) Winner", {
        x: pageMarginX + 4,
        y: finalsTopY - 26,
        size: 6.5,
        font: helvetica,
        color: mutedInk,
      });

      const grandFinalMatch = roundsMap.get(4)?.[0] || mainMatches[mainMatches.length - 1];
      const finalBoxW = leftColW;
      const finalBoxH = 70;
      const finalBoxY = finalsTopY - 108;

      if (grandFinalMatch) {
        drawMatchBox(finalsPage, grandFinalMatch, pageMarginX, finalBoxY, finalBoxW, finalBoxH);
      }
    }

    // SECTION 2: Repechage & Bronze Medal Rounds
    const repTopY = finalsTopY - 188;

    finalsPage.drawText("REPECHAGE & 3RD PLACE MEDAL ROUNDS", {
      x: pageMarginX + 4,
      y: repTopY,
      size: 10,
      font: helveticaBold,
      color: emerald,
    });

    finalsPage.drawLine({
      start: { x: pageMarginX, y: repTopY - 5 },
      end: { x: pageMarginX + leftColW, y: repTopY - 5 },
      thickness: 1.5,
      color: emerald,
    });

    finalsPage.drawText("Competitors beaten by the finalists compete in repechage pools for bronze medals", {
      x: pageMarginX + 4,
      y: repTopY - 16,
      size: 6.5,
      font: helvetica,
      color: mutedInk,
    });

    const ancillaryMatches = [...repechageMatches, ...bronzeMatches];
    if (ancillaryMatches.length > 0) {
      const ancBoxW = (leftColW - 16) / 2;
      const ancBoxH = 46;
      let startY = repTopY - 26;

      ancillaryMatches.slice(0, 8).forEach((m, idx) => {
        const col = idx % 2;
        const row = Math.floor(idx / 2);
        const boxX = pageMarginX + col * (ancBoxW + 16);
        const boxY = startY - (row + 1) * ancBoxH - row * 10;
        if (boxY >= 36) {
          drawMatchBox(finalsPage, m, boxX, boxY, ancBoxW, ancBoxH);
        }
      });
    } else {
      // Empty slot card for single-elimination categories
      finalsPage.drawRectangle({
        x: pageMarginX,
        y: repTopY - 80,
        width: leftColW,
        height: 50,
        color: cardBg,
        borderColor: lineGray,
        borderWidth: 0.8,
      });

      finalsPage.drawText("Single Elimination Category — No Bronze Bouts Scheduled", {
        x: pageMarginX + 16,
        y: repTopY - 55,
        size: 8,
        font: helveticaBold,
        color: mutedInk,
      });
    }

    // RIGHT SIDE: Official Podium Card
    const podiumCardH = 155;
    const podiumCardY = finalsTopY - 15 - podiumCardH;
    drawPodiumCard(finalsPage, rightColX, podiumCardY, rightColW, podiumCardH);

    // RIGHT SIDE: Tournament Category Audit Card
    const auditCardH = 175;
    const auditCardY = podiumCardY - 16 - auditCardH;

    finalsPage.drawRectangle({
      x: rightColX,
      y: auditCardY,
      width: rightColW,
      height: auditCardH,
      color: pureWhite,
      borderColor: lineGray,
      borderWidth: 1,
    });

    // Card Header Bar
    finalsPage.drawRectangle({
      x: rightColX,
      y: auditCardY + auditCardH - 18,
      width: rightColW,
      height: 18,
      color: cardBg,
      borderColor: lineGray,
      borderWidth: 0.5,
    });

    finalsPage.drawText("TOURNAMENT CATEGORY AUDIT", {
      x: rightColX + 8,
      y: auditCardY + auditCardH - 13,
      size: 7.5,
      font: helveticaBold,
      color: darkInk,
    });

    const formatLabel =
      data.bronzeMedals === 0
        ? "Single Elimination"
        : data.bronzeMedals === 1
          ? "Single Bronze Bout"
          : data.bronzeMedals === 3
            ? "Local Official (Joint 3rd Bronzes)"
            : "WKF 2 Bronze Medals";

    const auditItems = [
      { label: "Category", val: ellipsize(data.categoryName, helveticaBold, 7, rightColW - 90) },
      { label: "Draw Structure", val: `${numPools} Pools of 16 + Finals` },
      { label: "Bracket Size", val: `${data.tournamentSize} Competitor Slots` },
      { label: "Opening Byes", val: `${data.byeCount} Byes Allocated` },
      { label: "Total Bouts", val: `${data.matches.length} Scheduled Bouts` },
      { label: "Medal System", val: formatLabel },
      { label: "Certified", val: "RingFlow Official Record" },
    ];

    const auditRowH = (auditCardH - 22) / auditItems.length;
    auditItems.forEach((item, idx) => {
      const rowY = auditCardY + auditCardH - 22 - (idx + 1) * auditRowH;

      finalsPage.drawText(item.label, {
        x: rightColX + 8,
        y: rowY + auditRowH / 2 - 2,
        size: 6.5,
        font: helveticaBold,
        color: mutedInk,
      });

      finalsPage.drawText(item.val, {
        x: rightColX + 90,
        y: rowY + auditRowH / 2 - 2,
        size: 7,
        font: helvetica,
        color: idx === auditItems.length - 1 ? emerald : darkInk,
      });

      if (idx < auditItems.length - 1) {
        finalsPage.drawLine({
          start: { x: rightColX + 6, y: rowY },
          end: { x: rightColX + rightColW - 6, y: rowY },
          thickness: 0.5,
          color: lineGray,
        });
      }
    });

    // Finals Signatures
    finalsPage.drawText("Chief Referee: ___________________________", {
      x: pageMarginX + 16,
      y: 16,
      size: 7,
      font: helvetica,
      color: darkInk,
    });

    finalsPage.drawText("Tatami Manager: ___________________________", {
      x: pageMarginX + 260,
      y: 16,
      size: 7,
      font: helvetica,
      color: darkInk,
    });

    finalsPage.drawText("RingFlow Official Draw Sheet  ·  Certified Tournament Results", {
      x: fWidth - pageMarginX - 250,
      y: 16,
      size: 6.5,
      font: helvetica,
      color: mutedInk,
    });

    return await pdfDoc.save();
  }

  // Filter out redundant BYE advance matches from Round 0 (since those athletes already start in Round 1)
  if (roundsMap.has(0)) {
    const realRound0Matches = round0MatchesAll.filter((m) => !isMatchBye(m));
    if (realRound0Matches.length === 0 && totalRound0Slots > 0) {
      // If every match in Round 0 was a BYE, drop Round 0 completely
      roundsMap.delete(0);
    } else {
      roundsMap.set(0, realRound0Matches);
    }
  }

  const sortedRounds = Array.from(roundsMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([rNo, list]) => ({
      roundNo: rNo,
      roundName: list[0]?.roundName || `Round ${rNo}`,
      matches: list.sort((a, b) => a.matchNo - b.matchNo),
    }));

  const numRounds = Math.max(1, sortedRounds.length);
  const fitsSinglePage = numRounds <= 3;

  // --- PAGE 1: Main Bracket Tree ---
  const page1 = pdfDoc.addPage([842, 595]);
  const { width: p1Width, height: p1Height } = page1.getSize();
  drawPageHeader(page1, p1Width, p1Height);

  // Available height: topY down to bottom signatures (32)
  const topY = p1Height - 74;
  const bottomSignaturesY = 32;

  // For <= 3 rounds (e.g. 8-bracket):
  // Tree takes left ~530 pt. Right panel (236 pt) contains Repechage on top, Podium on bottom-right corner!
  let treeWidth = p1Width - pageMarginX * 2;
  let rightPanelWidth = 0;
  let rightPanelX = 0;

  if (fitsSinglePage) {
    rightPanelWidth = 236;
    treeWidth = p1Width - pageMarginX * 2 - rightPanelWidth - 24;
    rightPanelX = p1Width - pageMarginX - rightPanelWidth;
  }

  // Generous column spacing to ensure tree following is spacious, breathable & NEVER cramped
  const colWidth = fitsSinglePage ? 144 : Math.min(140, (treeWidth - (numRounds - 1) * 28) / numRounds);
  const colGap = numRounds > 1 ? (treeWidth - colWidth * numRounds) / (numRounds - 1) : 0;

  const matchCoords = new Map<string, MatchCoord>();

  sortedRounds.forEach((round, rIdx) => {
    const colX = pageMarginX + rIdx * (colWidth + colGap);
    const roundTitleY = topY - 10;

    // Column Header
    page1.drawText(safeText(round.roundName).toUpperCase(), {
      x: colX + 4,
      y: roundTitleY,
      size: 9,
      font: helveticaBold,
      color: emerald,
    });

    page1.drawLine({
      start: { x: colX, y: roundTitleY - 5 },
      end: { x: colX + colWidth, y: roundTitleY - 5 },
      thickness: 1.5,
      color: emerald,
    });

    const matchCount = round.matches.length;
    const treeTopY = roundTitleY - 14;

    round.matches.forEach((match, mIdx) => {
      let centerY: number;
      if (rIdx === 0 && round.roundNo === 0 && totalRound0Slots > 0 && round0MatchesAll.length > round.matches.length) {
        // Sparse Round 0 matches positioned at their exact binary tree feeder slot
        const origSlotIdx = round0MatchesAll.findIndex((x) => x.matchId === match.matchId);
        const slotH = (treeTopY - bottomSignaturesY) / totalRound0Slots;
        centerY = treeTopY - (origSlotIdx + 0.5) * slotH;
      } else {
        const slotH = (treeTopY - bottomSignaturesY) / matchCount;
        centerY = treeTopY - (mIdx + 0.5) * slotH;
      }

      // Adaptive box height based on match count in the round:
      // - 16+ matches (e.g. dense Round of 32): 25 pt compact box with single-line rows, 0 overlap!
      // - 8 or fewer matches: 44 pt spacious box
      // - 4 matches (Quarter-Finals): 50 pt box
      // - <= 2 matches (Semi-Final & Final): 54 pt box
      let boxHeight = 54;
      if (matchCount >= 16) {
        boxHeight = 25;
      } else if (matchCount >= 8) {
        boxHeight = 44;
      } else if (matchCount === 4) {
        boxHeight = 50;
      } else {
        boxHeight = 54;
      }

      matchCoords.set(match.matchId, {
        matchId: match.matchId,
        roundIdx: rIdx,
        x: colX,
        centerY,
        width: colWidth,
        height: boxHeight,
        match,
      });
    });
  });

  // Draw Orthogonal Connector Lines (Spacious and breathable)
  for (let rIdx = 0; rIdx < numRounds - 1; rIdx++) {
    const curRound = sortedRounds[rIdx];
    const nextRound = sortedRounds[rIdx + 1];
    if (!nextRound) continue;

    const fromColX = pageMarginX + rIdx * (colWidth + colGap);
    const toColX = pageMarginX + (rIdx + 1) * (colWidth + colGap);
    const branchX = fromColX + colWidth + colGap / 2;

    const isConnectingFromFilteredRound0 = curRound.roundNo === 0 && totalRound0Slots > curRound.matches.length;

    nextRound.matches.forEach((nextMatch, nextIdx) => {
      const nextCoord = matchCoords.get(nextMatch.matchId);
      if (!nextCoord) return;

      const f1 = isConnectingFromFilteredRound0
        ? round0MatchesAll[2 * nextIdx]
        : curRound.matches[2 * nextIdx];
      const f2 = isConnectingFromFilteredRound0
        ? round0MatchesAll[2 * nextIdx + 1]
        : curRound.matches[2 * nextIdx + 1];

      const c1 = f1 ? matchCoords.get(f1.matchId) : null;
      const c2 = f2 ? matchCoords.get(f2.matchId) : null;

      if (c1 && c2) {
        const yTop = Math.max(c1.centerY, c2.centerY);
        const yBottom = Math.min(c1.centerY, c2.centerY);
        const yTarget = nextCoord.centerY;

        const f1Won = Boolean(f1?.winnerId && nextMatch.winnerId === f1.winnerId);
        const f2Won = Boolean(f2?.winnerId && nextMatch.winnerId === f2.winnerId);

        // Branch from top feeder
        page1.drawLine({
          start: { x: fromColX + colWidth, y: yTop },
          end: { x: branchX, y: yTop },
          thickness: f1Won ? 1.4 : 1.1,
          color: f1Won ? emerald : lightMuted,
        });

        // Branch from bottom feeder
        page1.drawLine({
          start: { x: fromColX + colWidth, y: yBottom },
          end: { x: branchX, y: yBottom },
          thickness: f2Won ? 1.4 : 1.1,
          color: f2Won ? emerald : lightMuted,
        });

        // Vertical connector joiner
        page1.drawLine({
          start: { x: branchX, y: yTop },
          end: { x: branchX, y: yBottom },
          thickness: 1.1,
          color: lightMuted,
        });

        // Stem into next match box
        page1.drawLine({
          start: { x: branchX, y: yTarget },
          end: { x: toColX, y: yTarget },
          thickness: f1Won || f2Won ? 1.4 : 1.1,
          color: f1Won || f2Won ? emerald : lightMuted,
        });
      } else if (c1) {
        // Only top feeder exists (bottom was a bye)
        const ySource = c1.centerY;
        const yTarget = nextCoord.centerY;
        const f1Won = Boolean(f1?.winnerId && nextMatch.winnerId === f1.winnerId);

        page1.drawLine({
          start: { x: fromColX + colWidth, y: ySource },
          end: { x: branchX, y: ySource },
          thickness: f1Won ? 1.4 : 1.1,
          color: f1Won ? emerald : lightMuted,
        });
        page1.drawLine({
          start: { x: branchX, y: ySource },
          end: { x: branchX, y: yTarget },
          thickness: 1.1,
          color: lightMuted,
        });
        page1.drawLine({
          start: { x: branchX, y: yTarget },
          end: { x: toColX, y: yTarget },
          thickness: f1Won ? 1.4 : 1.1,
          color: f1Won ? emerald : lightMuted,
        });
      } else if (c2) {
        // Only bottom feeder exists (top was a bye)
        const ySource = c2.centerY;
        const yTarget = nextCoord.centerY;
        const f2Won = Boolean(f2?.winnerId && nextMatch.winnerId === f2.winnerId);

        page1.drawLine({
          start: { x: fromColX + colWidth, y: ySource },
          end: { x: branchX, y: ySource },
          thickness: f2Won ? 1.4 : 1.1,
          color: f2Won ? emerald : lightMuted,
        });
        page1.drawLine({
          start: { x: branchX, y: ySource },
          end: { x: branchX, y: yTarget },
          thickness: 1.1,
          color: lightMuted,
        });
        page1.drawLine({
          start: { x: branchX, y: yTarget },
          end: { x: toColX, y: yTarget },
          thickness: f2Won ? 1.4 : 1.1,
          color: f2Won ? emerald : lightMuted,
        });
      }
    });
  }

  // Draw Match Boxes for Main Bracket
  for (const coord of Array.from(matchCoords.values())) {
    const boxY = coord.centerY - coord.height / 2;
    drawMatchBox(page1, coord.match, coord.x, boxY, coord.width, coord.height);
  }

  // If <= 3 rounds (e.g. 8-entrant):
  // 1. Repechage & 3rd Place sits in upper right
  // 2. Podium Card is anchored in the RIGHT BOTTOM CORNER!
  // 3. Signatures are positioned towards the LEFT and CENTER-LEFT!
  if (fitsSinglePage && rightPanelWidth > 0) {
    // A. Anchored Podium Card in RIGHT BOTTOM CORNER
    const podiumCardW = rightPanelWidth;
    const podiumCardH = 135;
    const podiumCardY = 18; // Anchored right bottom corner
    drawPodiumCard(page1, rightPanelX, podiumCardY, podiumCardW, podiumCardH);

    // B. Repechage & 3rd Place Bouts in the upper right
    let currentY = topY - 10;
    const ancillaryMatches = [...repechageMatches, ...bronzeMatches];

    if (ancillaryMatches.length > 0) {
      page1.drawText("REPECHAGE & 3RD PLACE BOUTS", {
        x: rightPanelX + 4,
        y: currentY,
        size: 9,
        font: helveticaBold,
        color: emerald,
      });

      page1.drawLine({
        start: { x: rightPanelX, y: currentY - 5 },
        end: { x: rightPanelX + rightPanelWidth, y: currentY - 5 },
        thickness: 1.5,
        color: emerald,
      });

      page1.drawText("Losers to finalists compete for bronze medals", {
        x: rightPanelX + 4,
        y: currentY - 15,
        size: 6,
        font: helvetica,
        color: mutedInk,
      });

      let boutBoxY = currentY - 26;
      const ancBoxH = 54;
      ancillaryMatches.slice(0, 3).forEach((m) => {
        boutBoxY -= ancBoxH;
        if (boutBoxY > podiumCardY + podiumCardH + 10) {
          drawMatchBox(page1, m, rightPanelX, boutBoxY, rightPanelWidth, ancBoxH);
          boutBoxY -= 10;
        }
      });
    }

    // C. Signatures placed towards the LEFT & CENTER-LEFT (never colliding with right bottom corner)
    const sigLine1Y = 20;

    page1.drawText("Chief Referee: _________________________________", {
      x: pageMarginX + 10,
      y: sigLine1Y,
      size: 7.5,
      font: helvetica,
      color: darkInk,
    });

    page1.drawText("Tatami Manager: _________________________________", {
      x: pageMarginX + 260,
      y: sigLine1Y,
      size: 7.5,
      font: helvetica,
      color: darkInk,
    });
  } else {
    // For 16+ entrant brackets: Signatures on the left/center-left of Page 1
    const footerY = 16;

    page1.drawText("Chief Referee: ___________________________", {
      x: pageMarginX + 16,
      y: footerY,
      size: 7,
      font: helvetica,
      color: darkInk,
    });

    page1.drawText("Tatami Manager: ___________________________", {
      x: pageMarginX + 260,
      y: footerY,
      size: 7,
      font: helvetica,
      color: darkInk,
    });
  }

  // --- PAGE 2: For 16+ entrants (Dedicated to Repechage & Bronze + Podium) ---
  if (!fitsSinglePage && (hasRepechageOrBronze || data.podium != null)) {
    const page2 = pdfDoc.addPage([842, 595]);
    const { width: p2Width, height: p2Height } = page2.getSize();
    drawPageHeader(page2, p2Width, p2Height, "REPECHAGE LADDERS, 3RD PLACE BOUTS & OFFICIAL PODIUM");

    const p2TopY = p2Height - 74;

    // Left 480 pt: Repechage & Bronze Matches
    const ancWidth = 480;
    const ancillaryMatches = [...repechageMatches, ...bronzeMatches];

    page2.drawText("REPECHAGE & 3RD PLACE MEDAL ROUNDS", {
      x: pageMarginX + 4,
      y: p2TopY - 10,
      size: 10,
      font: helveticaBold,
      color: emerald,
    });

    page2.drawLine({
      start: { x: pageMarginX, y: p2TopY - 15 },
      end: { x: pageMarginX + ancWidth, y: p2TopY - 15 },
      thickness: 1.5,
      color: emerald,
    });

    page2.drawText("Athletes beaten by the finalists compete in repechage pools for bronze medals", {
      x: pageMarginX + 4,
      y: p2TopY - 26,
      size: 6.5,
      font: helvetica,
      color: mutedInk,
    });

    let ancY = p2TopY - 40;
    const matchBoxW = (ancWidth - 20) / 2;
    const matchBoxH = 54;

    ancillaryMatches.forEach((m, idx) => {
      const colX = idx % 2 === 0 ? pageMarginX : pageMarginX + matchBoxW + 20;
      if (idx % 2 === 0 && idx > 0) ancY -= (matchBoxH + 12);
      drawMatchBox(page2, m, colX, ancY - matchBoxH, matchBoxW, matchBoxH);
    });

    // Right side: Official Podium Card
    const p2PodiumX = pageMarginX + ancWidth + 24;
    const p2PodiumW = p2Width - pageMarginX - p2PodiumX;
    const p2PodiumH = 150;
    drawPodiumCard(page2, p2PodiumX, p2TopY - 40 - p2PodiumH, p2PodiumW, p2PodiumH);

    // Page 2 Signatures
    const footerY = 16;

    page2.drawText("Chief Referee: ___________________________", {
      x: pageMarginX + 16,
      y: footerY,
      size: 7,
      font: helvetica,
      color: darkInk,
    });

    page2.drawText("Tatami Manager: ___________________________", {
      x: pageMarginX + 260,
      y: footerY,
      size: 7,
      font: helvetica,
      color: darkInk,
    });
  }

  // Kata Pools Fallback (if category is Kata Flight Draw)
  if (poolMatches.length > 0 && mainMatches.length === 0) {
    let poolY = topY - 14;
    const poolColW = (p1Width - pageMarginX * 2 - 20) / 2;

    page1.drawText("KATA GROUP POOLS", {
      x: pageMarginX + 4,
      y: topY - 10,
      size: 9,
      font: helveticaBold,
      color: emerald,
    });

    poolMatches.forEach((m, idx) => {
      const colX = idx % 2 === 0 ? pageMarginX : pageMarginX + poolColW + 20;
      if (idx % 2 === 0 && idx > 0) poolY -= 56;
      drawMatchBox(page1, m, colX, poolY - 52, poolColW, 52);
    });
  }

  return await pdfDoc.save();
}
