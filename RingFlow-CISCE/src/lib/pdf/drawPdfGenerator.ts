import { drawText } from "@/lib/pdf/pdfText";
import type { BracketMatchView } from "@/lib/draws/assembleDraw";
import { createSheetContext, safeText, type CategoryDrawPdfData, type MatchCoord } from "./draw/context";
import { drawKataSheet } from "./draw/kataSheet";
import { createMatchBoxDrawer } from "./draw/matchBox";
import { createPodiumCardDrawer } from "./draw/podiumCard";
import { drawSectionedBracket } from "./draw/sectionedBracket";

export type { CategoryDrawPdfData } from "./draw/context";

/**
 * The printed draw sheet for one category. Pure layout over the bouts the draw
 * produced; the page modules in ./draw do the drawing:
 *  - context.ts            fonts, palette, labels, shared page header, DRAFT watermark
 *  - matchBox.ts           one bout
 *  - podiumCard.ts         the results / podium card
 *  - kataSheet.ts          a kata pool flight
 *  - sectionedBracket.ts   brackets of 32+ as sections of 16, plus a finals page
 * This file lays out the single-page and two-page brackets (up to 16 entrants).
 */
export async function generateCategoryDrawPdfBytes(
  data: CategoryDrawPdfData
): Promise<Uint8Array> {
  const ctx = await createSheetContext(data);
  const drawMatchBox = createMatchBoxDrawer(ctx);
  const drawPodiumCard = createPodiumCardDrawer(ctx);
  const { pdfDoc, helvetica, helveticaBold, emerald, darkInk, mutedInk, lightMuted, pageMarginX, medalRoundsTitle, medalRoundsNote, finish, drawPageHeader } = ctx;

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

  // A kata pool flight has its own sheet.
  if (poolMatches.length > 0) return drawKataSheet(ctx, poolMatches);

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
    return drawSectionedBracket(ctx, {
      mainMatches,
      repechageMatches,
      bronzeMatches,
      hasRepechageOrBronze,
      roundsMap,
      round0MatchesAll,
      totalRound0Slots,
      realRound0Count,
      drawMatchBox,
      drawPodiumCard,
    });
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
    drawText(page1, safeText(round.roundName).toUpperCase(), {
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
      drawText(page1, data.bronzeMedals === 1 ? "SINGLE BRONZE BOUT" : "REPECHAGE & 3RD PLACE BOUTS", {
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

      drawText(page1, data.bronzeMedals === 1 ? "Semi-final losers meet for the bronze" : "Losers to finalists compete for bronze medals", {
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

    drawText(page1, "Chief Referee: _________________________________", {
      x: pageMarginX + 10,
      y: sigLine1Y,
      size: 7.5,
      font: helvetica,
      color: darkInk,
    });

    drawText(page1, "Tatami Manager: _________________________________", {
      x: pageMarginX + 260,
      y: sigLine1Y,
      size: 7.5,
      font: helvetica,
      color: darkInk,
    });
  } else {
    // For 16+ entrant brackets: Signatures on the left/center-left of Page 1
    const footerY = 16;

    drawText(page1, "Chief Referee: ___________________________", {
      x: pageMarginX + 16,
      y: footerY,
      size: 7,
      font: helvetica,
      color: darkInk,
    });

    drawText(page1, "Tatami Manager: ___________________________", {
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
    drawPageHeader(page2, p2Width, p2Height, `${medalRoundsTitle} & PODIUM`);

    const p2TopY = p2Height - 74;

    // Left 480 pt: Repechage & Bronze Matches
    const ancWidth = 480;
    const ancillaryMatches = [...repechageMatches, ...bronzeMatches];

    drawText(page2, medalRoundsTitle, {
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

    drawText(page2, medalRoundsNote, {
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

    drawText(page2, "Chief Referee: ___________________________", {
      x: pageMarginX + 16,
      y: footerY,
      size: 7,
      font: helvetica,
      color: darkInk,
    });

    drawText(page2, "Tatami Manager: ___________________________", {
      x: pageMarginX + 260,
      y: footerY,
      size: 7,
      font: helvetica,
      color: darkInk,
    });
  }

  return finish();
}
