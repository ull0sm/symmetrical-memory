import { drawText } from "@/lib/pdf/pdfText";
import { safeText, ellipsize, type SheetContext } from "./context";
import type { BracketMatchView } from "@/lib/draws/assembleDraw";

/**
 * A kata pool flight has pool bouts and a medal flight, not an elimination tree: one
 * paginated sheet with each pool's bouts (write-in results) and the medal flight.
 */
export function drawKataSheet(ctx: SheetContext, poolMatches: BracketMatchView[]): Promise<Uint8Array> {
  const { pdfDoc, helvetica, helveticaBold, emerald, darkInk, mutedInk, lightMuted, lineGray, pureWhite, redAka, blueAo, pageMarginX, sheetLabel, profileLabel, finish, drawPageHeader, helveticaOblique, data } = ctx;

  const flightMatches = data.matches
    .filter((m) => m.poolGroup === "Final Flight")
    .sort((a, b) => a.matchNo - b.matchNo);
  const poolNames = Array.from(new Set(poolMatches.map((m) => m.poolGroup ?? "Pool"))).sort();
  const athleteCount = new Set(
    poolMatches.flatMap((m) => [m.aka.id, m.ao.id]).filter((id): id is string => Boolean(id))
  ).size;

  const pageW = 842;
  const pageH = 595;
  const bottomY = 44;
  const rowH = 26;
  const cols = { bout: pageMarginX, aka: pageMarginX + 44, ao: pageMarginX + 292, score: pageMarginX + 540 };
  const colW = { aka: 240, ao: 240, score: pageW - pageMarginX * 2 - 540 };

  let page = pdfDoc.addPage([pageW, pageH]);
  let y = 0;
  const scoring = poolMatches[0]?.kataScoringMode === "POINTS" ? "Points scoring" : "Flag scoring";
  const pageSub = `KATA POOLS  |  ${athleteCount} athletes in ${poolNames.length} pool${poolNames.length === 1 ? "" : "s"}  |  ${scoring}${profileLabel ? `  |  ${profileLabel}` : ""}  |  ${sheetLabel}`;

  const startPage = (first: boolean) => {
    if (!first) page = pdfDoc.addPage([pageW, pageH]);
    drawPageHeader(page, pageW, pageH, pageSub);
    y = pageH - 84;
  };

  const sectionBar = (title: string, note: string) => {
    page.drawRectangle({ x: pageMarginX, y: y - 18, width: pageW - pageMarginX * 2, height: 18, color: emerald });
    drawText(page, title, { x: pageMarginX + 8, y: y - 13, size: 9, font: helveticaBold, color: pureWhite });
    const noteW = helvetica.widthOfTextAtSize(note, 7.5);
    drawText(page, note, { x: pageW - pageMarginX - noteW - 8, y: y - 12.5, size: 7.5, font: helvetica, color: pureWhite });
    y -= 22;
  };

  const columnHeads = () => {
    for (const [label, x] of [["BOUT", cols.bout], ["AKA (RED)", cols.aka], ["AO (BLUE)", cols.ao], ["RESULT", cols.score]] as const) {
      drawText(page, label, { x: x + 2, y: y - 9, size: 6.5, font: helveticaBold, color: mutedInk });
    }
    y -= 13;
  };

  const fighterCell = (x: number, w: number, who: BracketMatchView["aka"], tint: "aka" | "ao", solo = false) => {
    page.drawRectangle({ x, y: y - rowH + 3, width: 3, height: rowH - 6, color: tint === "aka" ? redAka : blueAo });
    if (!who.id) {
      const label = solo ? "- solo performance -" : who.displayName === "TBD" ? "To be decided" : safeText(who.displayName);
      drawText(page, label, { x: x + 8, y: y - 16, size: 7.5, font: helveticaOblique, color: lightMuted });
      return;
    }
    const chest = who.chestNumber ? `#${who.chestNumber}  ` : "";
    drawText(page, ellipsize(`${chest}${who.displayName}`, helveticaBold, 8, w - 12), { x: x + 8, y: y - 12, size: 8, font: helveticaBold, color: darkInk });
    if (who.school) {
      drawText(page, ellipsize(who.school, helvetica, 6.5, w - 12), { x: x + 8, y: y - 21.5, size: 6.5, font: helvetica, color: mutedInk });
    }
  };

  const resultCell = (m: BracketMatchView) => {
    const x = cols.score;
    const lineY = y - 18;
    const points = m.kataScoringMode === "POINTS";
    const labels = points ? ["AKA", "AO"] : ["Winner"];
    let cx = x + 4;
    for (const label of labels) {
      drawText(page, label, { x: cx, y: lineY + 3, size: 6.5, font: helvetica, color: mutedInk });
      const lx = cx + helvetica.widthOfTextAtSize(label, 6.5) + 3;
      const lw = points ? 38 : colW.score - 60;
      page.drawLine({ start: { x: lx, y: lineY }, end: { x: lx + lw, y: lineY }, thickness: 0.6, color: lightMuted });
      cx = lx + lw + 8;
    }
  };

  const boutRow = (m: BracketMatchView, label: string) => {
    page.drawRectangle({ x: pageMarginX, y: y - rowH, width: pageW - pageMarginX * 2, height: rowH, color: pureWhite, borderColor: lineGray, borderWidth: 0.6 });
    drawText(page, label, { x: cols.bout + 4, y: y - 16, size: 8, font: helveticaBold, color: darkInk });
    fighterCell(cols.aka, colW.aka, m.aka, "aka");
    fighterCell(cols.ao, colW.ao, m.ao, "ao", m.bracketType === "POOL" && !m.ao.id);
    resultCell(m);
    y -= rowH;
  };

  const needRoom = (rows: number, title: string, note: string) => {
    if (y - rows * rowH < bottomY) {
      startPage(false);
      sectionBar(`${title} (continued)`, note);
      columnHeads();
    }
  };

  startPage(true);

  for (const poolName of poolNames) {
    const bouts = poolMatches.filter((m) => m.poolGroup === poolName).sort((a, b) => a.matchNo - b.matchNo);
    const note = `${bouts.length} bout${bouts.length === 1 ? "" : "s"}`;
    if (y - (3 * rowH + 40) < bottomY) startPage(false);
    sectionBar(poolName.toUpperCase(), note);
    columnHeads();
    for (const m of bouts) {
      needRoom(1, poolName.toUpperCase(), note);
      boutRow(m, `#${m.matchNo}`);
    }
    y -= 14;
  }

  if (flightMatches.length > 0) {
    const note = "after the pools · scores start from zero";
    if (y - (2 * rowH + 40) < bottomY) startPage(false);
    sectionBar("MEDAL FLIGHT", note);
    for (const m of flightMatches) {
      needRoom(2, "MEDAL FLIGHT", note);
      page.drawRectangle({ x: pageMarginX, y: y - rowH, width: pageW - pageMarginX * 2, height: rowH, color: pureWhite, borderColor: lineGray, borderWidth: 0.6 });
      drawText(page, `#${m.matchNo}`, { x: cols.bout + 4, y: y - 16, size: 8, font: helveticaBold, color: darkInk });
      const title = m.roundName.replace(/^Pool [A-Z] · /, "");
      drawText(page, ellipsize(title, helveticaBold, 8, cols.score - cols.aka - 8), { x: cols.aka + 8, y: y - 16, size: 8, font: helveticaBold, color: darkInk });
      resultCell(m);
      y -= rowH;
    }
  }

  // Signatures on the last page.
  if (y - 40 < bottomY) startPage(false);
  drawText(page, "Chief Referee: ___________________________", { x: pageMarginX, y: 30, size: 7, font: helvetica, color: darkInk });
  drawText(page, "Tatami Manager: ___________________________", { x: pageMarginX + 260, y: 30, size: 7, font: helvetica, color: darkInk });

  const total = pdfDoc.getPageCount();
  pdfDoc.getPages().forEach((p, index) => {
    const label = `RingFlow ${sheetLabel}  ·  Page ${index + 1} of ${total}`;
    drawText(p, label, { x: pageW - pageMarginX - helvetica.widthOfTextAtSize(label, 6.5), y: 16, size: 6.5, font: helvetica, color: mutedInk });
  });

  return finish();
}
