import { drawText } from "@/lib/pdf/pdfText";
import { ellipsize, type SheetContext, type MatchCoord } from "./context";
import type { BracketMatchView } from "@/lib/draws/assembleDraw";

/** What the sectioned layout needs from the main generator: the bouts by kind and the box/podium drawers. */
export interface SectionedModel {
  mainMatches: BracketMatchView[];
  repechageMatches: BracketMatchView[];
  bronzeMatches: BracketMatchView[];
  hasRepechageOrBronze: boolean;
  roundsMap: Map<number, BracketMatchView[]>;
  round0MatchesAll: BracketMatchView[];
  totalRound0Slots: number;
  realRound0Count: number;
  drawMatchBox: ReturnType<typeof import("./matchBox").createMatchBoxDrawer>;
  drawPodiumCard: ReturnType<typeof import("./podiumCard").createPodiumCardDrawer>;
}

/**
 * Brackets of 32 or more are printed as sections of 16 (one page each, winners feeding the
 * next stage) plus a finals page with the medal rounds. These are slices of ONE bracket, not
 * pools; "pool" is reserved for kata pool flights.
 */
export function drawSectionedBracket(ctx: SheetContext, model: SectionedModel): Promise<Uint8Array> {
  const { pdfDoc, helvetica, helveticaBold, emerald, darkInk, mutedInk, lightMuted, lineGray, cardBg, pureWhite, pageMarginX, sheetLabel, medalRoundsTitle, medalRoundsNote, finish, drawPageHeader, data } = ctx;
  const { mainMatches, repechageMatches, bronzeMatches, roundsMap, round0MatchesAll, totalRound0Slots, drawMatchBox, drawPodiumCard } = model;

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
      `SECTION ${poolLetter} — 16-COMPETITOR BRACKET  |  Winner advances to ${targetAdvName}`
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
        colTitle = totalRound0Slots >= 32 ? `QUARTER-FINAL (SECTION ${poolLetter})` : `SEMI-FINAL ${poolNumber} (SECTION ${poolLetter})`;
      }

      // Column Header
      drawText(poolPage, colTitle, {
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

        drawText(poolPage, "QUALIFIES FOR", {
          x: badgeX + 7,
          y: badgeY + 16,
          size: 5.5,
          font: helveticaBold,
          color: emerald,
        });

        drawText(poolPage, ellipsize(targetAdvShort, helveticaBold, 6.8, badgeW - 12), {
          x: badgeX + 7,
          y: badgeY + 6,
          size: 6.8,
          font: helveticaBold,
          color: darkInk,
        });
      }
    }

    // Signatures at bottom of pool sheet
    drawText(poolPage, "Chief Referee: ___________________________", {
      x: pageMarginX + 16,
      y: 16,
      size: 7,
      font: helvetica,
      color: darkInk,
    });

    drawText(poolPage, "Tatami Manager: ___________________________", {
      x: pageMarginX + 260,
      y: 16,
      size: 7,
      font: helvetica,
      color: darkInk,
    });

    drawText(poolPage, 
      `Section ${poolLetter}  ·  ${sheetLabel}  ·  RingFlow`,
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
  drawPageHeader(finalsPage, fWidth, fHeight, `CHAMPIONSHIP FINALS, ${medalRoundsTitle} & PODIUM`);

  const leftColW = 486;
  const rightColX = pageMarginX + leftColW + 28;
  const rightColW = fWidth - pageMarginX - rightColX;

  const finalsTopY = fHeight - 74;

  // SECTION 1: Championship Final(s)
  drawText(finalsPage, "CHAMPIONSHIP FINAL", {
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
    drawText(finalsPage, "Semi-Finals & Grand Final Championship Matches", {
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
    drawText(finalsPage, "Gold Medal Bout — Section A Winner vs Section B Winner", {
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

  drawText(finalsPage, medalRoundsTitle, {
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

  drawText(finalsPage, medalRoundsNote, {
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

    drawText(finalsPage, "Single Elimination Category — No Bronze Bouts Scheduled", {
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

  drawText(finalsPage, "TOURNAMENT CATEGORY AUDIT", {
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
    { label: "Draw Structure", val: `${numPools} Sections of 16 + Finals` },
    { label: "Bracket Size", val: `${data.tournamentSize} Competitor Slots` },
    { label: "Opening Byes", val: `${data.byeCount} Byes Allocated` },
    { label: "Total Bouts", val: `${data.matches.length} Scheduled Bouts` },
    { label: "Medal System", val: formatLabel },
    { label: "Sheet", val: sheetLabel },
  ];

  const auditRowH = (auditCardH - 22) / auditItems.length;
  auditItems.forEach((item, idx) => {
    const rowY = auditCardY + auditCardH - 22 - (idx + 1) * auditRowH;

    drawText(finalsPage, item.label, {
      x: rightColX + 8,
      y: rowY + auditRowH / 2 - 2,
      size: 6.5,
      font: helveticaBold,
      color: mutedInk,
    });

    drawText(finalsPage, item.val, {
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
  drawText(finalsPage, "Chief Referee: ___________________________", {
    x: pageMarginX + 16,
    y: 16,
    size: 7,
    font: helvetica,
    color: darkInk,
  });

  drawText(finalsPage, "Tatami Manager: ___________________________", {
    x: pageMarginX + 260,
    y: 16,
    size: 7,
    font: helvetica,
    color: darkInk,
  });

  drawText(finalsPage, `RingFlow ${sheetLabel}`, {
    x: fWidth - pageMarginX - 250,
    y: 16,
    size: 6.5,
    font: helvetica,
    color: mutedInk,
  });

  return finish();
}
