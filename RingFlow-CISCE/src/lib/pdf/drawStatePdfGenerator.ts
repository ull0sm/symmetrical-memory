import { PDFDocument, PDFPage, rgb } from "pdf-lib";
import { cleanText, drawText, loadFontSet, truncateToWidth, type RunFont } from "@/lib/pdf/pdfText";
import type { BracketMatchView } from "@/lib/draws/assembleDraw";
import type { BoutOfficial } from "@/lib/results/officials";
import type { TallyRow } from "@/lib/results/medalTally";
import type { GroupPodium } from "@/lib/results/podium";

/**
 * The results document: not a results table, but the state of every draw as it
 * stands — round by round, who fought whom, the points, and who won. That is
 * what a venue actually needs to print at the end of a day.
 */

export interface CategoryDrawState {
  categoryName: string;
  tournamentSize?: number;
  bronzeMedals?: number;
  matches: BracketMatchView[];
  /** Per bout: who confirmed it and any corrections (keyed by match id). */
  officials?: Record<string, BoutOfficial>;
}

export interface DrawStatePdfData {
  tournamentName: string;
  eventDate?: string | null;
  venue?: string | null;
  city?: string | null;
  categories: CategoryDrawState[];
  /** Podiums of every category or group, and the club medal tally; both optional. */
  podiums?: GroupPodium[];
  tally?: TallyRow[];
  generatedAt: Date;
}

const PAGE_W = 595.28; // A4 portrait
const PAGE_H = 841.89;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;

const INK = rgb(27 / 255, 24 / 255, 21 / 255);
const MUTED = rgb(104 / 255, 100 / 255, 90 / 255);
const LINE = rgb(225 / 255, 221 / 255, 207 / 255);
const CARD = rgb(250 / 255, 249 / 255, 245 / 255);
const EMERALD = rgb(14 / 255, 156 / 255, 124 / 255);
const AKA = rgb(192 / 255, 57 / 255, 43 / 255);
const AO = rgb(29 / 255, 78 / 255, 216 / 255);
const WON_BG = rgb(229 / 255, 246 / 255, 240 / 255);

/** Trim to fit a column, so long school names never overlap the score. */
function ellipsize(text: string, font: RunFont, size: number, maxWidth: number): string {
  return truncateToWidth(text, font, size, maxWidth);
}

function scoreLine(match: BracketMatchView): string {
  const parts: string[] = [];
  if (match.akaScore !== undefined || match.aoScore !== undefined) {
    parts.push(`${match.akaScore ?? 0}-${match.aoScore ?? 0}`);
  }
  const penalties = (match.akaPenalties ?? 0) + (match.aoPenalties ?? 0);
  if (penalties > 0) parts.push(`P${match.akaPenalties ?? 0}/${match.aoPenalties ?? 0}`);
  if (match.senshu) parts.push(`S:${match.senshu === "AKA" ? "AKA" : "AO"}`);
  return parts.join(" · ");
}

function isDecided(match: BracketMatchView): boolean {
  return match.status === "CONFIRMED" || Boolean(match.winnerId);
}

function side(match: BracketMatchView, which: "aka" | "ao") {
  const fighter = which === "aka" ? match.aka : match.ao;
  return {
    name: fighter?.displayName || "TBD",
    chest: fighter?.chestNumber ?? null,
    school: fighter?.school ?? null,
    won: Boolean(match.winnerId && fighter?.id && match.winnerId === fighter.id),
  };
}

export async function generateDrawStatePdfBytes(data: DrawStatePdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const { regular, bold } = await loadFontSet(pdf);

  let page: PDFPage = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const newPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  };

  const ensure = (needed: number) => {
    if (y - needed < MARGIN) newPage();
  };

  // ── Title block ────────────────────────────────────────────────────────────
  page.drawRectangle({
    x: MARGIN,
    y: y - 52,
    width: CONTENT_W,
    height: 52,
    color: CARD,
    borderColor: LINE,
    borderWidth: 1,
  });
  drawText(page, ellipsize(data.tournamentName || "Tournament", bold, 15, CONTENT_W - 24), {
    x: MARGIN + 12,
    y: y - 22,
    size: 15,
    font: bold,
    color: INK,
  });

  const metaBits = [
    data.eventDate ? String(data.eventDate).slice(0, 10) : null,
    data.venue,
    data.city,
  ].filter(Boolean) as string[];
  drawText(page, 
    ellipsize(`Draw state · ${metaBits.join(" · ") || "Date not set"}`, regular, 9, CONTENT_W - 24),
    { x: MARGIN + 12, y: y - 38, size: 9, font: regular, color: MUTED }
  );
  y -= 52 + 18;

  drawText(page, 
    ellipsize(`Generated ${data.generatedAt.toISOString().slice(0, 16).replace("T", " ")}`, regular, 8, CONTENT_W),
    { x: MARGIN, y, size: 8, font: regular, color: MUTED }
  );
  y -= 20;

  // ── One section per category ───────────────────────────────────────────────
  for (const category of data.categories) {
    const decided = category.matches.filter(isDecided).length;
    const withScores = category.matches.filter(
      (m) => (m.akaScore ?? 0) > 0 || (m.aoScore ?? 0) > 0 || isDecided(m)
    ).length;

    ensure(70);
    y -= 6;
    page.drawRectangle({ x: MARGIN, y: y - 30, width: CONTENT_W, height: 30, color: INK });
    drawText(page, ellipsize(category.categoryName, bold, 12, CONTENT_W - 150), {
      x: MARGIN + 10,
      y: y - 20,
      size: 12,
      font: bold,
      color: rgb(1, 1, 1),
    });
    const summary =
      category.bronzeMedals === 0
        ? "no bronze bout"
        : category.bronzeMedals === 1
          ? "local official (single bronze)"
          : category.bronzeMedals === 3
            ? "local official (joint bronzes)"
            : "two bronzes (WKF repechage)";
    drawText(page, 
      ellipsize(
        `${category.matches.length} bouts · ${withScores} with points · ${summary}`,
        regular,
        8,
        CONTENT_W - 150
      ),
      { x: MARGIN + 10, y: y - 8, size: 8, font: regular, color: rgb(0.85, 0.85, 0.85) }
    );
    if (category.tournamentSize) {
      drawText(page, `Size ${category.tournamentSize}`, {
        x: MARGIN + CONTENT_W - 66,
        y: y - 20,
        size: 9,
        font: bold,
        color: rgb(1, 1, 1),
      });
    }
    y -= 38;

    // Kata pools first (one group per pool), then the main bracket in order,
    // then repechage, then bronze.
    const groups: Array<{ label: string; matches: BracketMatchView[] }> = [];
    const pools = new Map<string, BracketMatchView[]>();
    for (const m of category.matches.filter((m) => m.bracketType === "POOL")) {
      const key = m.poolGroup || "Pool";
      const list = pools.get(key) ?? [];
      list.push(m);
      pools.set(key, list);
    }
    for (const key of Array.from(pools.keys()).sort()) {
      groups.push({ label: key, matches: (pools.get(key) ?? []).sort((a, b) => a.matchNo - b.matchNo) });
    }
    const mainRounds = new Map<number, BracketMatchView[]>();
    for (const m of category.matches.filter((m) => m.bracketType === "MAIN")) {
      const list = mainRounds.get(m.roundNo) ?? [];
      list.push(m);
      mainRounds.set(m.roundNo, list);
    }
    for (const roundNo of Array.from(mainRounds.keys()).sort((a, b) => a - b)) {
      const list = (mainRounds.get(roundNo) ?? []).sort((a, b) => a.matchNo - b.matchNo);
      groups.push({ label: list[0]?.roundName || `Round ${roundNo}`, matches: list });
    }
    for (const type of ["REPECHAGE", "BRONZE"] as const) {
      const list = category.matches
        .filter((m) => m.bracketType === type)
        .sort((a, b) => a.matchNo - b.matchNo);
      if (list.length > 0) groups.push({ label: type, matches: list });
    }

    for (const group of groups) {
      ensure(34);
      drawText(page, cleanText(group.label.toUpperCase()), {
        x: MARGIN,
        y,
        size: 9,
        font: bold,
        color: EMERALD,
      });
      page.drawLine({
        start: { x: MARGIN, y: y - 4 },
        end: { x: PAGE_W - MARGIN, y: y - 4 },
        thickness: 0.5,
        color: LINE,
      });
      y -= 14;

      for (const match of group.matches) {
        ensure(26);
        const decidedMatch = isDecided(match);
        const aka = side(match, "aka");
        const ao = side(match, "ao");

        if (aka.won || ao.won) {
          page.drawRectangle({
            x: MARGIN,
            y: y - 16,
            width: CONTENT_W,
            height: 20,
            color: WON_BG,
          });
        }

        drawText(page, `#${match.matchNo}`, {
          x: MARGIN + 2,
          y: y - 10,
          size: 8,
          font: bold,
          color: MUTED,
        });

        const nameX = MARGIN + 26;
        const nameW = 200;
        const akaLabel = `${aka.name}${aka.chest ? ` (${aka.chest})` : ""}`;
        const aoLabel = `${ao.name}${ao.chest ? ` (${ao.chest})` : ""}`;

        drawText(page, `AKA`, { x: nameX, y: y - 2, size: 6, font: bold, color: AKA });
        drawText(page, ellipsize(akaLabel, aka.won ? bold : regular, 9, nameW), {
          x: nameX + 24,
          y: y - 2,
          size: 9,
          font: aka.won ? bold : regular,
          color: INK,
        });

        drawText(page, `AO`, { x: nameX, y: y - 13, size: 6, font: bold, color: AO });
        drawText(page, ellipsize(aoLabel, ao.won ? bold : regular, 9, nameW), {
          x: nameX + 24,
          y: y - 13,
          size: 9,
          font: ao.won ? bold : regular,
          color: INK,
        });

        // Points, in the corner colour of the fighter they belong to.
        // Kata bouts show the judges' total instead of kumite points.
        const akaPoints = match.akaScoreTotal ?? String(match.akaScore ?? 0);
        const aoPoints = match.aoScoreTotal ?? String(match.aoScore ?? 0);
        const scoreX = nameX + nameW + 16;
        drawText(page, `AKA ${akaPoints}`, {
          x: scoreX,
          y: y - 2,
          size: 9,
          font: bold,
          color: AKA,
        });
        drawText(page, `AO ${aoPoints}`, {
          x: scoreX,
          y: y - 13,
          size: 9,
          font: bold,
          color: AO,
        });

        const detail =
          match.status === "BYE" || match.status === "WALKOVER"
            ? "walkover"
            : decidedMatch
              ? `W · ${cleanText(aka.won ? aka.name : ao.won ? ao.name : "")}${
                  match.decisionMethod ? ` · ${cleanText(match.decisionMethod)}` : ""
                }`
              : match.status === "LIVE"
                ? "in progress"
                : "not fought yet";

        drawText(page, ellipsize(detail, regular, 8, 108), {
          x: scoreX + 62,
          y: y - 4,
          size: 8,
          font: regular,
          color: decidedMatch ? MUTED : rgb(0.7, 0.7, 0.7),
        });

        // Accountability: who confirmed it, and whether it was corrected.
        const official = category.officials?.[match.matchId];
        if (official?.confirmedBy || official?.corrections) {
          const note = [
            official.confirmedBy ? `by ${official.confirmedBy}` : null,
            official.corrections ? `corrected ${official.corrections}x` : null,
          ]
            .filter(Boolean)
            .join(" · ");
          drawText(page, ellipsize(note, regular, 7, 108), {
            x: scoreX + 62,
            y: y - 13,
            size: 7,
            font: regular,
            color: official.corrections ? AKA : MUTED,
          });
        }

        const schools = [aka.school, ao.school].filter(Boolean).join(" / ");
        if (schools) {
          drawText(page, ellipsize(schools, regular, 7, CONTENT_W - 26), {
            x: nameX,
            y: y - 22,
            size: 7,
            font: regular,
            color: rgb(0.65, 0.63, 0.6),
          });
          y -= 26;
        } else {
          y -= 20;
        }
      }
      y -= 4;
    }
    y -= 8;
  }

  // ── Podiums and the club medal tally ───────────────────────────────────────
  if (data.podiums && data.podiums.length > 0) {
    ensure(60);
    y -= 6;
    page.drawRectangle({ x: MARGIN, y: y - 26, width: CONTENT_W, height: 26, color: INK });
    drawText(page, "PODIUMS", { x: MARGIN + 10, y: y - 18, size: 12, font: bold, color: rgb(1, 1, 1) });
    y -= 36;
    for (const p of data.podiums) {
      ensure(18 + Math.max(1, p.places.length) * 13);
      drawText(page, ellipsize(cleanText(p.name), bold, 9, CONTENT_W), { x: MARGIN, y, size: 9, font: bold, color: EMERALD });
      y -= 13;
      if (!p.final || p.places.length === 0) {
        drawText(page, "In progress", { x: MARGIN + 10, y, size: 8, font: regular, color: MUTED });
        y -= 13;
      }
      for (const x of p.places) {
        const medal = x.medal === "gold" ? "Gold" : x.medal === "silver" ? "Silver" : "Bronze";
        const label = `${medal}  ${x.name}${x.chestNumber ? ` (${x.chestNumber})` : ""}${x.guest ? " · guest" : ""}`;
        drawText(page, ellipsize(cleanText(label), regular, 9, CONTENT_W - 150), { x: MARGIN + 10, y, size: 9, font: regular, color: INK });
        drawText(page, ellipsize(cleanText(x.club ?? "Independent"), regular, 8, 140), {
          x: MARGIN + CONTENT_W - 140,
          y,
          size: 8,
          font: regular,
          color: MUTED,
        });
        y -= 13;
      }
      y -= 6;
    }
  }

  if (data.tally) {
    newPage();
    drawText(page, "MEDAL TALLY", { x: MARGIN, y: y - 12, size: 14, font: bold, color: INK });
    y -= 34;
    if (data.tally.length === 0) {
      drawText(page, "No medals have been decided yet.", { x: MARGIN, y, size: 9, font: regular, color: MUTED });
    } else {
      const cols = { rank: MARGIN, club: MARGIN + 34, gold: MARGIN + 300, silver: MARGIN + 350, bronze: MARGIN + 405, total: MARGIN + 465 };
      for (const [k, t] of [["rank", "#"], ["club", "Club"], ["gold", "Gold"], ["silver", "Silver"], ["bronze", "Bronze"], ["total", "Total"]] as const) {
        drawText(page, t, { x: cols[k], y, size: 8, font: bold, color: MUTED });
      }
      page.drawLine({ start: { x: MARGIN, y: y - 4 }, end: { x: PAGE_W - MARGIN, y: y - 4 }, thickness: 0.5, color: LINE });
      y -= 18;
      for (const r of data.tally) {
        ensure(16);
        drawText(page, String(r.rank), { x: cols.rank, y, size: 9, font: regular, color: INK });
        drawText(page, ellipsize(cleanText(r.independent ? `${r.label} (Independent)` : r.label), regular, 9, 250), {
          x: cols.club,
          y,
          size: 9,
          font: regular,
          color: INK,
        });
        drawText(page, String(r.gold), { x: cols.gold, y, size: 9, font: regular, color: INK });
        drawText(page, String(r.silver), { x: cols.silver, y, size: 9, font: regular, color: INK });
        drawText(page, String(r.bronze), { x: cols.bronze, y, size: 9, font: regular, color: INK });
        drawText(page, String(r.total), { x: cols.total, y, size: 9, font: bold, color: INK });
        y -= 16;
      }
    }
  }

  // ── Footer on every page ───────────────────────────────────────────────────
  const pages = pdf.getPages();
  pages.forEach((p, index) => {
    drawText(p, `RingFlow · draw state · page ${index + 1} of ${pages.length}`, {
      x: MARGIN,
      y: MARGIN / 2,
      size: 7,
      font: regular,
      color: MUTED,
    });
  });

  return pdf.save();
}
