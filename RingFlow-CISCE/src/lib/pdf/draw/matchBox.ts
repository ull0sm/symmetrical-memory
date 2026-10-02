import { PDFPage } from "pdf-lib";
import { drawText } from "@/lib/pdf/pdfText";
import { ellipsize, type SheetContext } from "./context";
import type { BracketMatchView } from "@/lib/draws/assembleDraw";

/** Draws one bout (both athletes, AKA/AO badges, write-in lines) into a box on a page. */
export function createMatchBoxDrawer(ctx: SheetContext) {
  const { helvetica, helveticaBold, emerald, darkInk, mutedInk, lightMuted, lineGray, cardBg, pureWhite, redAka, redAkaBg, redAkaBorder, blueAo, blueAoBg, blueAoBorder, liveBg, liveAmber, helveticaOblique } = ctx;

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

      drawText(p, `BOUT #${m.matchNo}`, {
        x: boxX + 4,
        y: boxY + boxH - 6.2,
        size: 5.5,
        font: helveticaBold,
        color: isLive ? liveAmber : darkInk,
      });

      if (statusBadge) {
        const statusW = helveticaBold.widthOfTextAtSize(statusBadge, 4.8);
        drawText(p, statusBadge, {
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
      drawText(p, "AKA", {
        x: boxX + 5.5,
        y: akaY + (fighterSlotH - akaPillH) / 2 + 1.2,
        size: 4.8,
        font: helveticaBold,
        color: redAka,
      });

      if (akaIsBye) {
        drawText(p, "- BYE -", {
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

        drawText(p, akaText, {
          x: contentStartX,
          y: akaY + 2,
          size: 6.2,
          font: akaWon ? helveticaBold : helvetica,
          color: akaWon ? emerald : darkInk,
        });

        if (isDecided && !isByeMatch) {
          if (akaWon) {
            drawText(p, "WIN", {
              x: rightMarginX - 25,
              y: akaY + 2,
              size: 5,
              font: helveticaBold,
              color: emerald,
            });
          }
          const akaScoreStr = `${m.senshu === "AKA" ? "S " : ""}${m.akaScore ?? 0}`;
          const scoreW = helveticaBold.widthOfTextAtSize(akaScoreStr, 6.2);
          drawText(p, akaScoreStr, {
            x: rightMarginX - scoreW - 1,
            y: akaY + 2,
            size: 6.2,
            font: helveticaBold,
            color: akaWon ? emerald : darkInk,
          });
        }
      } else {
        const guideText = m.aka.sourceMatchNo ? `${roleWord} Bout #${m.aka.sourceMatchNo}` : defaultAkaGuide;
        drawText(p, guideText, {
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
      drawText(p, "AO", {
        x: boxX + 6,
        y: aoY + (fighterSlotH - aoPillH) / 2 + 1.2,
        size: 4.8,
        font: helveticaBold,
        color: blueAo,
      });

      if (aoIsBye) {
        drawText(p, "- BYE -", {
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

        drawText(p, aoText, {
          x: contentStartX,
          y: aoY + 2,
          size: 6.2,
          font: aoWon ? helveticaBold : helvetica,
          color: aoWon ? emerald : darkInk,
        });

        if (isDecided && !isByeMatch) {
          if (aoWon) {
            drawText(p, "WIN", {
              x: rightMarginX - 25,
              y: aoY + 2,
              size: 5,
              font: helveticaBold,
              color: emerald,
            });
          }
          const aoScoreStr = `${m.senshu === "AO" ? "S " : ""}${m.aoScore ?? 0}`;
          const scoreW = helveticaBold.widthOfTextAtSize(aoScoreStr, 6.2);
          drawText(p, aoScoreStr, {
            x: rightMarginX - scoreW - 1,
            y: aoY + 2,
            size: 6.2,
            font: helveticaBold,
            color: aoWon ? emerald : darkInk,
          });
        }
      } else {
        const guideText = m.ao.sourceMatchNo ? `${roleWord} Bout #${m.ao.sourceMatchNo}` : defaultAoGuide;
        drawText(p, guideText, {
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

      drawText(p, `BOUT #${m.matchNo}`, {
        x: boxX + 6,
        y: boxY + boxH - 8.5,
        size: 6.8,
        font: helveticaBold,
        color: isLive ? liveAmber : darkInk,
      });

      if (statusBadge) {
        const statusW = helveticaBold.widthOfTextAtSize(statusBadge, 6);
        drawText(p, statusBadge, {
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
      drawText(p, "AKA", {
        x: boxX + 7.5,
        y: akaY + fighterSlotH - 9,
        size: 5.5,
        font: helveticaBold,
        color: redAka,
      });

      if (akaIsBye) {
        drawText(p, "- BYE -", {
          x: contentStartX,
          y: akaY + (fighterSlotH - 7) / 2,
          size: 7.5,
          font: helveticaOblique,
          color: lightMuted,
        });
      } else if (m.aka.id || (m.aka.displayName && m.aka.displayName !== "TBD")) {
        const hasSchool = Boolean(m.aka.school);
        const nameY = hasSchool ? akaY + 9.8 : akaY + (fighterSlotH - 8) / 2;

        const scoreSpace = isDecided && !isByeMatch ? 38 : 6;
        const maxNameW = rightMarginX - contentStartX - scoreSpace;
        const akaName = ellipsize(m.aka.displayName, akaWon ? helveticaBold : helvetica, 7.5, maxNameW);

        drawText(p, akaName, {
          x: contentStartX,
          y: nameY,
          size: 7.5,
          font: akaWon ? helveticaBold : helvetica,
          color: akaWon ? emerald : darkInk,
        });

        if (isDecided && !isByeMatch) {
          if (akaWon) {
            drawText(p, "WIN", {
              x: rightMarginX - 34,
              y: nameY,
              size: 6,
              font: helveticaBold,
              color: emerald,
            });
          }
          const akaScoreStr = `${m.senshu === "AKA" ? "S " : ""}${m.akaScore ?? 0}`;
          const scoreW = helveticaBold.widthOfTextAtSize(akaScoreStr, 7.5);
          drawText(p, akaScoreStr, {
            x: rightMarginX - scoreW - 1,
            y: nameY,
            size: 7.5,
            font: helveticaBold,
            color: akaWon ? emerald : darkInk,
          });
        }

        if (hasSchool) {
          const akaSchool = ellipsize(m.aka.school || "", helvetica, 5.5, rightMarginX - contentStartX);
          drawText(p, akaSchool, {
            x: contentStartX,
            y: akaY + 1.2,
            size: 5.5,
            font: helvetica,
            color: mutedInk,
          });
        }
      } else {
        const guideText = m.aka.sourceMatchNo ? `${roleWord} Bout #${m.aka.sourceMatchNo}` : defaultAkaGuide;
        drawText(p, guideText, {
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
      drawText(p, "AO", {
        x: boxX + 7.5,
        y: aoY + fighterSlotH - 9,
        size: 5.5,
        font: helveticaBold,
        color: blueAo,
      });

      if (aoIsBye) {
        drawText(p, "- BYE -", {
          x: contentStartX,
          y: aoY + (fighterSlotH - 7) / 2,
          size: 7.5,
          font: helveticaOblique,
          color: lightMuted,
        });
      } else if (m.ao.id || (m.ao.displayName && m.ao.displayName !== "TBD")) {
        const hasSchool = Boolean(m.ao.school);
        const nameY = hasSchool ? aoY + 9.8 : aoY + (fighterSlotH - 8) / 2;

        const scoreSpace = isDecided && !isByeMatch ? 38 : 6;
        const maxNameW = rightMarginX - contentStartX - scoreSpace;
        const aoName = ellipsize(m.ao.displayName, aoWon ? helveticaBold : helvetica, 7.5, maxNameW);

        drawText(p, aoName, {
          x: contentStartX,
          y: nameY,
          size: 7.5,
          font: aoWon ? helveticaBold : helvetica,
          color: aoWon ? emerald : darkInk,
        });

        if (isDecided && !isByeMatch) {
          if (aoWon) {
            drawText(p, "WIN", {
              x: rightMarginX - 34,
              y: nameY,
              size: 6,
              font: helveticaBold,
              color: emerald,
            });
          }
          const aoScoreStr = `${m.senshu === "AO" ? "S " : ""}${m.aoScore ?? 0}`;
          const scoreW = helveticaBold.widthOfTextAtSize(aoScoreStr, 7.5);
          drawText(p, aoScoreStr, {
            x: rightMarginX - scoreW - 1,
            y: nameY,
            size: 7.5,
            font: helveticaBold,
            color: aoWon ? emerald : darkInk,
          });
        }

        if (hasSchool) {
          const aoSchool = ellipsize(m.ao.school || "", helvetica, 5.5, rightMarginX - contentStartX);
          drawText(p, aoSchool, {
            x: contentStartX,
            y: aoY + 1.2,
            size: 5.5,
            font: helvetica,
            color: mutedInk,
          });
        }
      } else {
        const guideText = m.ao.sourceMatchNo ? `${roleWord} Bout #${m.ao.sourceMatchNo}` : defaultAoGuide;
        drawText(p, guideText, {
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

  return drawMatchBox;
}
