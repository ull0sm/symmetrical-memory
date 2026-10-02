import { PDFPage } from "pdf-lib";
import { drawText } from "@/lib/pdf/pdfText";
import { ellipsize, type SheetContext } from "./context";

/** Draws the results / podium card (blank write-in lines on a draw sheet). */
export function createPodiumCardDrawer(ctx: SheetContext) {
  const { helvetica, helveticaBold, darkInk, mutedInk, lineGray, cardBg, pureWhite, goldTone, silverTone, bronzeTone, athleteNameById, data } = ctx;

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

    drawText(p, "RESULTS / PODIUM", {
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

      drawText(p, row.rank, {
        x: cardX + 8,
        y: rowY + rowH / 2 - 2,
        size: 6.5,
        font: helveticaBold,
        color: row.color,
      });

      if (row.athlete) {
        const athName = ellipsize(row.athlete.name, helveticaBold, 7.5, cardW - 96);
        drawText(p, athName, {
          x: cardX + 72,
          y: rowY + rowH / 2 - 1,
          size: 7.5,
          font: helveticaBold,
          color: darkInk,
        });

        if (row.athlete.school) {
          const athSchool = ellipsize(row.athlete.school, helvetica, 5.5, cardW - 96);
          drawText(p, athSchool, {
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

  return drawPodiumCard;
}
