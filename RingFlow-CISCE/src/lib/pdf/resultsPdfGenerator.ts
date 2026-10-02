import { PDFDocument, rgb } from "pdf-lib";
import { drawText, loadFontSet, truncateChars } from "@/lib/pdf/pdfText";

export interface ResultRow {
  categoryName: string;
  roundName: string;
  matchNo: number;
  bracketType: string;
  status: string;
  akaName: string;
  akaChest: string | null;
  akaSchool: string | null;
  akaScore: number;
  akaPenalties: number;
  aoName: string;
  aoChest: string | null;
  aoSchool: string | null;
  aoScore: number;
  aoPenalties: number;
  senshu: string | null;
  winnerName: string | null;
  decisionMethod: string | null;
  /** Official who confirmed the result as it stands. */
  confirmedBy?: string | null;
  /** Times the confirmed result was changed afterwards. */
  corrections?: number;
  correctionReason?: string | null;
}

export interface ResultsPdfData {
  tournamentName: string;
  eventDate: string | null;
  venue: string | null;
  city: string | null;
  rows: ResultRow[];
  athleteTotals: {
    name: string;
    chestNumber: string | null;
    school: string | null;
    categoryName: string;
    bouts: number;
    wins: number;
    pointsFor: number;
    pointsAgainst: number;
  }[];
}

const PAGE: [number, number] = [842, 595]; // Landscape A4
const MARGIN = 28;
const ROW_HEIGHT = 15;

const emerald = rgb(14 / 255, 156 / 255, 124 / 255);
const ink = rgb(27 / 255, 24 / 255, 21 / 255);
const muted = rgb(104 / 255, 100 / 255, 90 / 255);
const faint = rgb(140 / 255, 135 / 255, 124 / 255);
const line = rgb(225 / 255, 221 / 255, 207 / 255);
const cardBg = rgb(250 / 255, 249 / 255, 245 / 255);
const akaColor = rgb(192 / 255, 57 / 255, 43 / 255);
const aoColor = rgb(29 / 255, 78 / 255, 216 / 255);

function truncate(text: string, max: number): string {
  return truncateChars(text, max);
}

/**
 * The paper copy of what was conducted: one table per category, each bout with
 * both athletes, the score line, the decision and the winner, plus the bouts
 * each athlete fought and a sign-off block for the officials.
 */
export async function generateResultsPdfBytes(data: ResultsPdfData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const { regular: helvetica, bold } = await loadFontSet(pdfDoc);

  const byCategory = new Map<string, ResultRow[]>();
  for (const row of data.rows) {
    const list = byCategory.get(row.categoryName) ?? [];
    list.push(row);
    byCategory.set(row.categoryName, list);
  }

  const columns = [
    { key: "bout", label: "Bout", width: 42 },
    { key: "round", label: "Round", width: 92 },
    { key: "aka", label: "AKA (red)", width: 200 },
    { key: "akaScore", label: "Score", width: 46, align: "center" as const },
    { key: "ao", label: "AO (blue)", width: 200 },
    { key: "aoScore", label: "Score", width: 46, align: "center" as const },
    { key: "winner", label: "Winner", width: 118 },
    { key: "method", label: "Decision", width: 70 },
  ];
  const tableWidth = columns.reduce((sum, c) => sum + c.width, 0);

  let page = pdfDoc.addPage(PAGE);
  let y = PAGE[1];

  const drawPageHeader = () => {
    page.drawRectangle({
      x: MARGIN,
      y: PAGE[1] - 62,
      width: PAGE[0] - MARGIN * 2,
      height: 44,
      color: cardBg,
      borderColor: line,
      borderWidth: 1,
    });
    drawText(page, truncate(data.tournamentName.toUpperCase(), 70), {
      x: MARGIN + 12,
      y: PAGE[1] - 34,
      size: 13,
      font: bold,
      color: emerald,
    });
    const meta = [data.eventDate ?? "", data.venue ?? "", data.city ?? ""]
      .filter(Boolean)
      .join(" · ");
    drawText(page, truncate(`Official results record${meta ? ` · ${meta}` : ""}`, 110), {
      x: MARGIN + 12,
      y: PAGE[1] - 50,
      size: 9,
      font: helvetica,
      color: muted,
    });
    drawText(page, "Page 1 of many — retained copy", {
      x: PAGE[0] - MARGIN - 150,
      y: PAGE[1] - 34,
      size: 8,
      font: helvetica,
      color: faint,
    });
  };

  drawPageHeader();
  y = PAGE[1] - 84;

  const ensureSpace = (needed: number) => {
    if (y - needed > MARGIN + 60) return;
    page = pdfDoc.addPage(PAGE);
    y = PAGE[1] - 60;
  };

  for (const [categoryName, rows] of byCategory) {
    ensureSpace(46);

    page.drawRectangle({
      x: MARGIN,
      y: y - 16,
      width: tableWidth,
      height: 20,
      color: rgb(245 / 255, 243 / 255, 236 / 255),
      borderColor: line,
      borderWidth: 0.5,
    });
    drawText(page, truncate(categoryName.toUpperCase(), 80), {
      x: MARGIN + 8,
      y: y - 11,
      size: 10,
      font: bold,
      color: ink,
    });
    const decided = rows.filter((r) => r.winnerName && r.status === "CONFIRMED").length;
    drawText(page, `${rows.length} bouts · ${decided} decided`, {
      x: MARGIN + tableWidth - 130,
      y: y - 11,
      size: 8,
      font: helvetica,
      color: muted,
    });
    y -= 26;

    // Column headings
    let x = MARGIN;
    for (const column of columns) {
      drawText(page, column.label.toUpperCase(), {
        x: column.align === "center" ? x + 4 : x + 4,
        y,
        size: 7,
        font: bold,
        color: muted,
      });
      x += column.width;
    }
    y -= 4;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: MARGIN + tableWidth, y },
      thickness: 0.5,
      color: line,
    });
    y -= ROW_HEIGHT - 4;

    for (const row of rows) {
      ensureSpace(ROW_HEIGHT + 4);

      const akaLabel = `${row.akaName}${row.akaChest ? ` (${row.akaChest})` : ""}${
        row.akaPenalties > 0 ? ` · ${row.akaPenalties}w` : ""
      }`;
      const aoLabel = `${row.aoName}${row.aoChest ? ` (${row.aoChest})` : ""}${
        row.aoPenalties > 0 ? ` · ${row.aoPenalties}w` : ""
      }`;

      x = MARGIN;
      const cells: { text: string; color: typeof ink; font: typeof helvetica }[] = [
        { text: `#${row.matchNo}`, color: muted, font: helvetica },
        {
          text: `${row.roundName}${row.bracketType !== "MAIN" ? ` (${row.bracketType.toLowerCase()})` : ""}`,
          color: muted,
          font: helvetica,
        },
        { text: truncate(akaLabel, 40), color: akaColor, font: bold },
        { text: String(row.akaScore), color: ink, font: bold },
        { text: truncate(aoLabel, 40), color: aoColor, font: bold },
        { text: String(row.aoScore), color: ink, font: bold },
        { text: truncate(row.winnerName ?? "—", 26), color: ink, font: bold },
        {
          text: row.decisionMethod ? truncate(row.decisionMethod.replace(/_/g, " ").toLowerCase(), 16) : "—",
          color: muted,
          font: helvetica,
        },
      ];

      for (let i = 0; i < columns.length; i += 1) {
        const cell = cells[i];
        const column = columns[i];
        const offset =
          column.align === "center"
            ? x + (column.width - cell.font.widthOfTextAtSize(cell.text, 8)) / 2
            : x + 4;
        drawText(page, cell.text, { x: offset, y, size: 8, font: cell.font, color: cell.color });
        x += column.width;
      }

      y -= ROW_HEIGHT;
    }

    y -= 10;
  }

  // Per-athlete totals
  if (data.athleteTotals.length > 0) {
    ensureSpace(60);
    drawText(page, "BOUTS FOUGHT PER ATHLETE", {
      x: MARGIN,
      y,
      size: 10,
      font: bold,
      color: ink,
    });
    y -= 16;

    const totalsHeader = ["Athlete", "Chest", "Category", "Bouts", "Wins", "Points for", "Points against"];
    const widths = [200, 60, 230, 60, 60, 80, 90];
    let x = MARGIN;
    totalsHeader.forEach((label, index) => {
      drawText(page, label.toUpperCase(), { x: x + 4, y, size: 7, font: bold, color: muted });
      x += widths[index];
    });
    y -= 12;

    for (const total of data.athleteTotals) {
      ensureSpace(ROW_HEIGHT + 6);
      const values = [
        truncate(total.name, 34),
        total.chestNumber ?? "",
        truncate(total.categoryName, 40),
        String(total.bouts),
        String(total.wins),
        String(total.pointsFor),
        String(total.pointsAgainst),
      ];
      x = MARGIN;
      values.forEach((value, index) => {
        drawText(page, value, { x: x + 4, y, size: 8, font: index === 0 ? bold : helvetica, color: ink });
        x += widths[index];
      });
      y -= ROW_HEIGHT;
    }
  }

  // Sign-off
  ensureSpace(70);
  y -= 12;
  const signWidth = (tableWidth - 40) / 3;
  const labels = ["Chief Referee", "Tournament Director", "Association Delegate"];
  labels.forEach((label, index) => {
    const sx = MARGIN + index * (signWidth + 20);
    page.drawLine({
      start: { x: sx, y: y - 22 },
      end: { x: sx + signWidth, y: y - 22 },
      thickness: 0.7,
      color: faint,
    });
    drawText(page, label, { x: sx, y: y - 34, size: 8, font: helvetica, color: muted });
    drawText(page, "Name / Signature / Date", { x: sx, y: y - 45, size: 7, font: helvetica, color: faint });
  });

  return pdfDoc.save();
}
