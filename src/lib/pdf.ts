// ============================================================================
// PDF-Export – ECHTES Vektor-PDF (Text + Linien), nicht mehr als Screenshot.
//
// Frühere Versionen haben die HTML-Seite mit html2canvas "abfotografiert" und
// das Bild in die PDF geklebt. Das war fragil: ob eine Seite sauber wird, hing
// an Font-Laden, Stylesheet-Laden, Klon-Timing, Browser und Speicher – die
// erste Seite kam z. B. gelegentlich ganz ohne Styles heraus. Deshalb musste
// man auf jedem Gerät nachkontrollieren.
//
// Jetzt zeichnen wir die PDF direkt mit jsPDF + autoTable: reiner Text und
// echte Tabellenlinien. Das Ergebnis ist DETERMINISTISCH – auf jedem Handy,
// Browser und In-App-Webview identisch, die Linien können nie "verschwinden",
// die Datei ist winzig, und es gibt kein Timing/keine Schrift zum Abwarten.
//
// Schrift: die eingebaute Helvetica (Standard-14, kein Nachladen). Sie deckt
// Deutsch inkl. Umlaute/ß ab. Vietnamesische Namen werden auf ASCII übertragen
// (siehe T()) – bewusst ohne Diakritika, so gewünscht.
// ============================================================================

import { jsPDF } from "jspdf";
import type { Employee, Schedule, Shift } from "../types";
import {
  datesOfMonth,
  parseIsoDate,
  WEEKDAY_LABELS_DE,
  WEEKDAY_SHORT_DE,
  weekdayKeyOf,
} from "./demand";
import { minutesToDecimalHours, minutesToTime } from "./time";
import { MONTH_NAMES_DE } from "./dateFormat";
import { employmentLabelDe } from "./employment";
import { publicHolidayNames, publicHolidays } from "./holidays";
import { isDayClosed } from "./workHours";
import { format } from "date-fns";

/** Dateiname säubern: Umlaute/Akzente weg, nur unbedenkliche Zeichen behalten. */
export function safeFileName(text: string): string {
  const plain = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // Akzente entfernen: "Tuấn" -> "Tuan"
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
  return plain.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "Stundenzettel";
}

// ── Text für die eingebaute Schrift aufbereiten ────────────────────────────
// Helvetica kann Latin-1 (inkl. ä ö ü ß). Alles darüber (vietnamesische
// Diakritika, Typo-Anführungszeichen, Gedankenstrich) wird auf ein passendes
// ASCII/Latin-1-Zeichen abgebildet, damit nie ein Kästchen/"?" erscheint.
const PUNCT: Record<string, string> = {
  "–": "-", // – en dash
  "—": "-", // — em dash
  "‘": "'",
  "’": "'",
  "‚": ",",
  "“": '"',
  "”": '"',
  "„": '"',
  "…": "...",
  " ": " ", // geschütztes Leerzeichen
};

function T(input: string | undefined | null): string {
  if (!input) return "";
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    if (PUNCT[ch]) {
      out += PUNCT[ch];
    } else if (code <= 0xff) {
      // Latin-1: Deutsch inkl. Umlaute/ß bleibt erhalten.
      out += ch;
    } else if (ch === "đ" || ch === "Đ") {
      out += ch === "đ" ? "d" : "D";
    } else {
      // z. B. vietnamesische Vokale: zerlegen und Diakritika entfernen.
      const stripped = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      out += /^[\x20-\xff]*$/.test(stripped) ? stripped : "";
    }
  }
  return out;
}

// ── gemeinsame Farb-/Maß-Konstanten ────────────────────────────────────────
const INK: [number, number, number] = [15, 23, 42]; // slate-900
const MUTED: [number, number, number] = [100, 116, 139]; // slate-500
const LINE: [number, number, number] = [71, 85, 105]; // slate-600
const GRID: [number, number, number] = [148, 163, 184]; // slate-400
const HEAD_FILL: [number, number, number] = [241, 245, 249]; // slate-100
const SHADE_FILL: [number, number, number] = [248, 250, 252]; // slate-50
const DIVIDER: [number, number, number] = [203, 213, 225]; // slate-300

const MARGIN = 14; // mm

function monthLabelDe(year: number, month: number): string {
  return `${MONTH_NAMES_DE[month - 1]} ${year}`;
}

/** Kopfzeile (Titel links, Zeitraum rechts) + Trennlinie. Gibt neues Y zurück. */
function drawHeader(
  doc: jsPDF,
  title: string,
  schedule: Schedule,
  periodLabel: string,
): number {
  const pageW = doc.internal.pageSize.getWidth();
  let y = MARGIN + 1;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...INK);
  doc.text(T(title), MARGIN, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...LINE);
  doc.text(T(periodLabel), pageW - MARGIN, y, { align: "right" });

  y += 4.5;
  doc.setFontSize(9);
  doc.setTextColor(...LINE);
  doc.text(T(schedule.companyName || "—"), MARGIN, y);
  if (schedule.address) {
    y += 3.6;
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(T(schedule.address), MARGIN, y);
  }

  y += 2.4;
  doc.setDrawColor(30, 41, 59); // slate-800
  doc.setLineWidth(0.5);
  doc.line(MARGIN, y, pageW - MARGIN, y);
  return y + 4;
}

/** Zweispaltiger Info-Block; gibt das Y darunter zurück. */
function drawInfoBlock(
  doc: jsPDF,
  pairs: Array<[string, string | null]>, // null = Feld zum Ausfüllen von Hand
  startY: number,
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const colX = [MARGIN, pageW / 2 + 4];
  const labelW = 32;
  let y = startY;
  doc.setFontSize(8);

  for (let i = 0; i < pairs.length; i += 2) {
    for (let c = 0; c < 2; c++) {
      const pair = pairs[i + c];
      if (!pair) continue;
      const [label, value] = pair;
      const x = colX[c];
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...MUTED);
      doc.text(`${T(label)}:`, x, y);
      if (value === null) {
        // Leere Schreiblinie – wird auf dem Papier von Hand ergänzt.
        doc.setDrawColor(...GRID);
        doc.setLineWidth(0.2);
        doc.line(x + labelW, y, x + labelW + 45, y);
      } else {
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...INK);
        doc.text(T(value), x + labelW, y);
      }
    }
    y += 5;
  }
  return y + 1;
}

/** Unterschriftszeilen am Seitenende. */
function drawSignatures(doc: jsPDF, labels: string[], y: number): void {
  const pageW = doc.internal.pageSize.getWidth();
  const gap = (pageW - 2 * MARGIN) / labels.length;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.2);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...LINE);
  labels.forEach((label, i) => {
    const x0 = MARGIN + i * gap;
    const x1 = x0 + gap - 10;
    doc.line(x0, y, x1, y);
    doc.text(T(label), x0, y + 4);
  });
}

// ── Stundenzettel ──────────────────────────────────────────────────────────

type DayRow = {
  shaded: boolean;
  shiftCount: number;
  cells: string[]; // [datum/wd, beginn, ende, pause, arbeitszeit, bemerkung]
};

function stundenzettelRowsFor(
  schedule: Schedule,
  employee: Employee,
  dates: string[],
): { rows: DayRow[]; totalMinutes: number } {
  const byDate = new Map<string, Shift[]>();
  for (const s of schedule.shifts) {
    if (s.employeeId !== employee.id) continue;
    const list = byDate.get(s.date);
    if (list) list.push(s);
    else byDate.set(s.date, [s]);
  }
  for (const list of byDate.values()) list.sort((a, b) => a.startMinutes - b.startMinutes);

  const holidayNames = publicHolidayNames(schedule.year);
  const closedByDate = new Map(
    schedule.dateOverrides.filter((o) => o.closed).map((o) => [o.date, o] as const),
  );

  let totalMinutes = 0;
  const rows: DayRow[] = dates.map((d) => {
    const dienste = byDate.get(d) ?? [];
    totalMinutes += dienste.reduce((a, s) => a + s.paidMinutes, 0);
    const wd = WEEKDAY_LABELS_DE[weekdayKeyOf(parseIsoDate(d))];
    const holiday = holidayNames.get(d);
    const closed = closedByDate.get(d);
    const isWeekend = wd === "Samstag" || wd === "Sonntag";
    const shaded = Boolean(isWeekend || holiday || closed);
    const datum = `${format(parseIsoDate(d), "dd.MM.yyyy")}\n${wd}`;

    if (dienste.length === 0) {
      const bemerkung = closed
        ? closed.note || "Betriebsruhe"
        : holiday
          ? `Frei (Feiertag: ${holiday})`
          : "Frei";
      return { shaded, shiftCount: 0, cells: [datum, "", "", "", "0,00", bemerkung] };
    }

    const beginn = dienste.map((x) => minutesToTime(x.startMinutes)).join("\n");
    const ende = dienste.map((x) => minutesToTime(x.endMinutes)).join("\n");
    const pause = dienste.map((x) => `${x.pauseMinutes} Min`).join("\n");
    const arbeitszeit = dienste.map((x) => minutesToDecimalHours(x.paidMinutes)).join("\n");
    const bemerkung = holiday ? `Feiertag: ${holiday}` : "";
    return {
      shaded,
      shiftCount: dienste.length,
      cells: [datum, beginn, ende, pause, arbeitszeit, bemerkung],
    };
  });

  return { rows, totalMinutes };
}

// Spalten des Stundenzettels: x-Position, Breite, Ausrichtung. Rechte Kante 196.
const SZ_COLS: Array<{ x: number; w: number; align: "left" | "center" }> = [
  { x: 14, w: 30, align: "left" }, // Datum / Wochentag
  { x: 44, w: 26, align: "center" }, // Arbeitsbeginn
  { x: 70, w: 26, align: "center" }, // Arbeitsende
  { x: 96, w: 20, align: "center" }, // Pause
  { x: 116, w: 26, align: "center" }, // Arbeitszeit
  { x: 142, w: 54, align: "left" }, // Bemerkung
];
const SZ_LEFT = 14;
const SZ_RIGHT = 196;
const SZ_HEAD = ["Datum / Wochentag", "Arbeitsbeginn", "Arbeitsende", "Pause", "Arbeitszeit", "Bemerkung"];

/**
 * Zeichnet die Stundenzettel-Tabelle VON HAND (jsPDF-Primitive, ohne autoTable).
 *
 * Warum von Hand: die eingebundene autoTable-Version berechnet zwar alle Zeilen,
 * zeichnet im minifizierten Bundle aber nur einen Teil (ein ganzer Monat wurde
 * ab ~Tag 23 abgeschnitten). Selbst gezeichnet haben wir volle Kontrolle über die
 * Zeilenhöhe – ein ganzer Monat passt garantiert auf EINE Seite – und es gibt
 * keine Fremd-Bibliothek mehr, die Zeilen verschluckt.
 */
function drawStundenzettelTable(
  doc: jsPDF,
  startY: number,
  rows: DayRow[],
  totalMinutes: number,
): void {
  const FS = 6.5; // Schriftgröße (pt)
  const LH = 2.5; // Höhe je Textzeile (mm)
  const PADV = 0.7; // Innenabstand oben/unten (mm)
  const headH = LH + 2 * PADV;
  const footH = LH + 2 * PADV;

  doc.setFontSize(FS);
  doc.setFont("helvetica", "normal");

  // Zellinhalte in Zeilen zerlegen (Bemerkung ggf. auf Spaltenbreite umbrechen).
  const bodyLines = rows.map((r) =>
    r.cells.map((c, ci) => {
      const parts = T(c).split("\n");
      if (ci === 5 && T(c)) {
        return parts.flatMap((p) => (p ? (doc.splitTextToSize(p, SZ_COLS[ci].w - 3) as string[]) : [""]));
      }
      return parts;
    }),
  );
  const rowMax = bodyLines.map((cells) => Math.max(1, ...cells.map((l) => l.length)));
  const rowH = rowMax.map((n) => n * LH + 2 * PADV);

  const drawCellText = (
    text: string,
    ci: number,
    yBaseline: number,
    style: "normal" | "bold",
    color: [number, number, number],
  ) => {
    if (!text) return;
    const col = SZ_COLS[ci];
    doc.setFont("helvetica", style);
    doc.setTextColor(...color);
    const tx = col.align === "center" ? col.x + col.w / 2 : col.x + 1.5;
    doc.text(text, tx, yBaseline, { align: col.align });
  };

  // ---- Kopfzeile ----
  let y = startY;
  doc.setFillColor(...HEAD_FILL);
  doc.rect(SZ_LEFT, y, SZ_RIGHT - SZ_LEFT, headH, "F");
  SZ_HEAD.forEach((h, ci) => drawCellText(h, ci, y + PADV + LH * 0.72, "bold", INK));
  y += headH;

  // ---- Datenzeilen ----
  const rowTops: number[] = [];
  rows.forEach((r, ri) => {
    const h = rowH[ri];
    rowTops.push(y);
    if (r.shaded) {
      doc.setFillColor(...SHADE_FILL);
      doc.rect(SZ_LEFT, y, SZ_RIGHT - SZ_LEFT, h, "F");
    }
    // Ca sáng/ca chiều: dünne Trennlinie zwischen den Diensten (Spalten 1–4).
    if (r.shiftCount >= 2) {
      doc.setDrawColor(...DIVIDER);
      doc.setLineWidth(0.2);
      for (let k = 1; k < r.shiftCount; k++) {
        const yy = y + (h * k) / r.shiftCount;
        doc.line(SZ_COLS[1].x, yy, SZ_COLS[4].x + SZ_COLS[4].w, yy);
      }
    }
    bodyLines[ri].forEach((lines, ci) => {
      const offset = (rowMax[ri] - lines.length) / 2; // vertikal zentrieren
      lines.forEach((ln, j) => {
        const yBase = y + PADV + (offset + j) * LH + LH * 0.72;
        if (ci === 0 && j === 0) drawCellText(ln, ci, yBase, "bold", INK);
        else if (ci === 0 || ci === 5) drawCellText(ln, ci, yBase, "normal", MUTED);
        else drawCellText(ln, ci, yBase, "normal", INK);
      });
    });
    y += h;
  });

  // ---- Fußzeile (Gesamtstunden) ----
  const footTop = y;
  doc.setFillColor(...HEAD_FILL);
  doc.rect(SZ_LEFT, y, SZ_RIGHT - SZ_LEFT, footH, "F");
  drawCellText("Gesamtstunden", 0, y + PADV + LH * 0.72, "bold", INK);
  drawCellText(minutesToDecimalHours(totalMinutes), 4, y + PADV + LH * 0.72, "bold", INK);
  y += footH;
  const tableBottom = y;

  // ---- Gitter (nach den Füllungen, damit die Linien oben liegen) ----
  doc.setDrawColor(...GRID);
  doc.setLineWidth(0.2);
  for (const hy of [startY, ...rowTops, footTop, tableBottom]) doc.line(SZ_LEFT, hy, SZ_RIGHT, hy);
  for (const vx of [SZ_LEFT, ...SZ_COLS.slice(1).map((c) => c.x), SZ_RIGHT]) {
    doc.line(vx, startY, vx, tableBottom);
  }
}

/** Zeichnet EINEN Stundenzettel auf die aktuelle Seite. */
function drawStundenzettel(
  doc: jsPDF,
  schedule: Schedule,
  employee: Employee,
  dates: string[],
  periodLabel: string,
): void {
  const startY = drawHeader(doc, "Stundenaufzeichnung", schedule, periodLabel);
  const infoY = drawInfoBlock(
    doc,
    [
      ["Firmenname", schedule.companyName || "—"],
      ["Beschäftigungsart", employmentLabelDe(employee.employmentType)],
      ["Mitarbeiter", employee.name],
      ["Monat", MONTH_NAMES_DE[schedule.month - 1]],
      ["Sollstunden", null], // von Hand einzutragen
      ["Jahr", String(schedule.year)],
    ],
    startY,
  );

  const { rows, totalMinutes } = stundenzettelRowsFor(schedule, employee, dates);

  drawStundenzettelTable(doc, infoY, rows, totalMinutes);

  // Zusammenfassung + Unterschriften: FESTE Positionen im reservierten Band am
  // Seitenende – unabhängig davon, wo die Tabelle endet (keine Kollision mehr).
  const pageH = doc.internal.pageSize.getHeight();
  const pageW = doc.internal.pageSize.getWidth();
  const summaryY = pageH - 30;
  const col3 = (pageW - 2 * MARGIN) / 3;

  const summary: Array<[string, string | null]> = [
    ["Gesamtstunden", `${minutesToDecimalHours(totalMinutes)} h`],
    ["Sollstunden", null],
    ["Differenz", null],
  ];
  summary.forEach(([label, value], i) => {
    const x = MARGIN + i * col3;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text(T(label), x, summaryY);
    if (value === null) {
      doc.setDrawColor(...GRID);
      doc.setLineWidth(0.2);
      doc.line(x, summaryY + 5, x + 26, summaryY + 5);
    } else {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...INK);
      doc.text(T(value), x, summaryY + 5);
    }
  });

  drawSignatures(
    doc,
    ["Unterschrift Mitarbeiter", "Unterschrift Arbeitgeber", "Datum"],
    pageH - 14,
  );
}

/**
 * Baut die Stundenzettel-PDF: eine A4-Seite je Mitarbeiter.
 * `dates` fehlt => ganzer Monat; `periodLabel` fehlt => Monat/Jahr.
 *
 * async + kurzer Yield je Seite: der Fortschritt (X/N) kann gerendert werden
 * und der Haupt-Thread bleibt auch auf schwachen Handys frei. Die Ausgabe
 * selbst ist trotzdem rein deterministisch – der Yield ändert nichts am Inhalt.
 */
export async function buildStundenzettelPdf(
  schedule: Schedule,
  employees: Employee[],
  opts: { dates?: string[]; periodLabel?: string } = {},
  onProgress?: (current: number, total: number) => void,
): Promise<jsPDF> {
  return buildStundenzettelPdfFor([{ schedule, employees }], opts, onProgress);
}

/** Eine Filiale mit den Mitarbeitern, die in die PDF sollen. */
export type StundenzettelJob = { schedule: Schedule; employees: Employee[] };

/**
 * Stundenzettel-PDF über MEHRERE Filialen: alle Seiten landen in EINER Datei,
 * in der Reihenfolge der Filialen. Der Betrieb druckt beide Läden zusammen aus,
 * deshalb ist ein einziges Dokument richtig – nicht zwei Downloads.
 */
export async function buildStundenzettelPdfFor(
  jobs: StundenzettelJob[],
  opts: { dates?: string[]; periodLabel?: string } = {},
  onProgress?: (current: number, total: number) => void,
): Promise<jsPDF> {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  const total = jobs.reduce((sum, job) => sum + job.employees.length, 0);
  let done = 0;

  for (const job of jobs) {
    const dates = opts.dates ?? datesOfMonth(job.schedule.year, job.schedule.month);
    const periodLabel = opts.periodLabel ?? monthLabelDe(job.schedule.year, job.schedule.month);
    for (const employee of job.employees) {
      if (done > 0) doc.addPage();
      drawStundenzettel(doc, job.schedule, employee, dates, periodLabel);
      // Zähler NICHT im optionalen Aufruf hochzählen: ohne onProgress würde
      // onProgress?.(++done) gar nicht ausgewertet – dann lägen alle Seiten
      // übereinander auf Seite 1.
      done += 1;
      onProgress?.(done, total);
      if (total > 1) await new Promise((r) => setTimeout(r, 0));
    }
  }

  return doc;
}

// ── Datei ausliefern ─────────────────────────────────────────────────────────

/**
 * PDF-Blob direkt als Datei herunterladen. MIME application/octet-stream +
 * .pdf-Name => auch iOS Safari / In-App-Browser speichern die Datei, statt sie
 * in einen neuen Tab zu öffnen und dort hängen zu bleiben.
 */
export function deliver(blob: Blob, filename: string): void {
  if (typeof document === "undefined") return;
  const octet = new Blob([blob], { type: "application/octet-stream" });
  const url = URL.createObjectURL(octet);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    if (document.body.contains(a)) document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 60_000);
}

/** jsPDF-Dokument als Datei speichern. */
export function savePdf(doc: jsPDF, filename: string): void {
  deliver(doc.output("blob"), filename);
}

// ── Dienstplan (Lịch làm việc, zum Aushang im Laden) ────────────────────────
//
// Auch hier echtes Vektor-PDF statt Screenshot. Zwei Ausrichtungen, genau wie
// der Ausdruck am Bildschirm:
//   "byEmployee" – Mitarbeiter als Zeilen, Tage als Spalten (eine Woche).
//   "byDate"     – Tage als Zeilen, Mitarbeiter als Spalten (ganzer Monat);
//                  quer, weil ein Monat mit vielen Leuten hochkant nicht passt.

export type SchedulePdfLayout = "byEmployee" | "byDate";

type GridColumn = { w: number; align: "left" | "center" | "right" };
type GridRow = { cells: string[][]; shaded: boolean; strong?: boolean };

/**
 * Zeichnet ein Gitter mit festen Spaltenbreiten und gibt die Unterkante zurück.
 * Eine Zelle ist eine Liste von Textzeilen; die erste Zeile ist die „starke".
 */
function drawGrid(
  doc: jsPDF,
  x0: number,
  y0: number,
  columns: GridColumn[],
  head: string[],
  body: GridRow[],
  fontSize: number,
  rowH: number,
): number {
  const width = columns.reduce((sum, c) => sum + c.w, 0);
  const xs: number[] = [];
  let cursor = x0;
  for (const col of columns) {
    xs.push(cursor);
    cursor += col.w;
  }
  const LH = fontSize * 0.36; // mm je Textzeile

  const put = (
    text: string,
    ci: number,
    y: number,
    style: "normal" | "bold",
    color: [number, number, number],
  ) => {
    if (!text) return;
    const col = columns[ci];
    doc.setFont("helvetica", style);
    doc.setTextColor(color[0], color[1], color[2]);
    const tx =
      col.align === "center"
        ? xs[ci] + col.w / 2
        : col.align === "right"
          ? xs[ci] + col.w - 1.5
          : xs[ci] + 1.5;
    doc.text(text, tx, y, { align: col.align });
  };

  doc.setFontSize(fontSize);
  let y = y0;
  doc.setFillColor(HEAD_FILL[0], HEAD_FILL[1], HEAD_FILL[2]);
  doc.rect(x0, y, width, rowH, "F");
  head.forEach((h, ci) => put(T(h), ci, y + rowH / 2 + LH * 0.35, "bold", INK));
  y += rowH;

  const tops: number[] = [];
  for (const row of body) {
    tops.push(y);
    if (row.shaded) {
      doc.setFillColor(SHADE_FILL[0], SHADE_FILL[1], SHADE_FILL[2]);
      doc.rect(x0, y, width, rowH, "F");
    }
    row.cells.forEach((lines, ci) => {
      const used = lines.filter(Boolean);
      const offset = ((used.length - 1) * LH) / 2;
      used.forEach((line, j) => {
        const yy = y + rowH / 2 - offset + j * LH + LH * 0.35;
        const first = j === 0;
        put(T(line), ci, yy, first && (row.strong || ci === 0) ? "bold" : "normal", first ? INK : MUTED);
      });
    });
    y += rowH;
  }

  doc.setDrawColor(GRID[0], GRID[1], GRID[2]);
  doc.setLineWidth(0.2);
  for (const hy of [y0, ...tops, y]) doc.line(x0, hy, x0 + width, hy);
  for (const vx of [...xs, x0 + width]) doc.line(vx, y0, vx, y);
  return y;
}

/** Eine Schicht als zwei Textzeilen: Zeitspanne und Stunden/Pause. */
/**
 * Zellinhalt für einen Tag. Ein Tag kann ZWEI Dienste haben (mittags und
 * abends) – beide müssen auf den Aushang, sonst fehlt die halbe Schicht.
 *
 * Die Zeilenhöhe im Gitter ist fest, deshalb:
 *  - ein Dienst  -> Uhrzeit + Stunden (zwei Zeilen),
 *  - zwei Dienste -> beide Uhrzeiten (zwei Zeilen); die Stundenzahl kommt nur
 *    dazu, wo das Blatt Platz für eine dritte Zeile hat (withHours).
 */
function shiftLines(shifts: Shift[], closed: boolean, withHours = false): string[] {
  if (shifts.length === 0) return [closed ? "-" : "frei"];
  const sorted = [...shifts].sort((a, b) => a.startMinutes - b.startMinutes);
  const stunden = (minutes: number) => minutesToDecimalHours(minutes, 2).replace(",00", "");
  if (sorted.length === 1) {
    const shift = sorted[0];
    return [
      `${minutesToTime(shift.startMinutes)}-${minutesToTime(shift.endMinutes)}`,
      `${stunden(shift.paidMinutes)}h${shift.pauseMinutes > 0 ? ` · P${shift.pauseMinutes}` : ""}`,
    ];
  }
  const zeiten = sorted.map((s) => `${minutesToTime(s.startMinutes)}-${minutesToTime(s.endMinutes)}`);
  const gesamt = sorted.reduce((sum, s) => sum + s.paidMinutes, 0);
  return withHours ? [...zeiten, `${stunden(gesamt)}h`] : zeiten;
}

/**
 * Dienstplan-PDF für einen Zeitraum (eine Seite). Spaltenbreite, Schriftgröße
 * und Zeilenhöhe richten sich nach der Menge, damit alles auf das Blatt passt.
 */
export function buildDienstplanPdf(
  schedule: Schedule,
  opts: { dates: string[]; title: string; layout: SchedulePdfLayout; employeeIds?: string[] },
): jsPDF {
  const doc = newDienstplanDoc(opts.layout);
  drawDienstplan(doc, schedule, opts);
  return doc;
}

/** Eine Filiale mit dem Zeitraum, der auf ihre Dienstplan-Seite soll. */
export type DienstplanJob = {
  schedule: Schedule;
  dates: string[];
  title: string;
  employeeIds?: string[];
};

/** Dienstplan-PDF über MEHRERE Filialen: je Filiale eine Seite, eine Datei. */
export function buildDienstplanPdfFor(jobs: DienstplanJob[], layout: SchedulePdfLayout): jsPDF {
  const doc = newDienstplanDoc(layout);
  jobs.forEach((job, index) => {
    if (index > 0) doc.addPage();
    drawDienstplan(doc, job.schedule, { ...job, layout });
  });
  return doc;
}

/** Leeres Dokument im passenden Format: der Monat liegt quer, die Woche hoch. */
function newDienstplanDoc(layout: SchedulePdfLayout): jsPDF {
  return new jsPDF({
    unit: "mm",
    format: "a4",
    orientation: layout === "byDate" ? "landscape" : "portrait",
    compress: true,
  });
}

/** Zeichnet EINEN Dienstplan auf die aktuelle Seite. */
function drawDienstplan(
  doc: jsPDF,
  schedule: Schedule,
  opts: { dates: string[]; title: string; layout: SchedulePdfLayout; employeeIds?: string[] },
): void {
  const employees =
    opts.employeeIds && opts.employeeIds.length
      ? schedule.employees.filter((e) => opts.employeeIds!.includes(e.id))
      : schedule.employees;
  // Eine LISTE je Person und Tag – an geteilten Tagen sind es zwei Dienste.
  const byKey = new Map<string, Shift[]>();
  for (const s of schedule.shifts) {
    const key = `${s.employeeId}#${s.date}`;
    byKey.set(key, [...(byKey.get(key) ?? []), s]);
  }

  const holidays = publicHolidays(schedule.year);
  const holidayNames = publicHolidayNames(schedule.year);
  const overrides = Object.fromEntries(schedule.dateOverrides.map((o) => [o.date, o]));
  const closedOn = (date: string) => isDayClosed(schedule.workHours, date, holidays, overrides);

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const startY = drawHeader(doc, "Dienstplan", schedule, opts.title);
  const usableW = pageW - 2 * MARGIN;
  // Unteres Band für die Unterschriften bleibt frei.
  const usableH = pageH - startY - 24;

  if (opts.layout === "byEmployee") {
    const nameW = 32;
    const sumW = 16;
    const dayW = (usableW - nameW - sumW) / Math.max(1, opts.dates.length);
    const columns: GridColumn[] = [
      { w: nameW, align: "left" },
      ...opts.dates.map(() => ({ w: dayW, align: "center" as const })),
      { w: sumW, align: "right" },
    ];
    const head = [
      "Mitarbeiter",
      ...opts.dates.map(
        (d) => `${WEEKDAY_SHORT_DE[weekdayKeyOf(parseIsoDate(d))]} ${format(parseIsoDate(d), "dd.MM.")}`,
      ),
      "Summe",
    ];
    const body: GridRow[] = employees.map((employee) => {
      const own = opts.dates.map((d) => byKey.get(`${employee.id}#${d}`) ?? []);
      const total = own.reduce((sum, list) => sum + list.reduce((a, s) => a + s.paidMinutes, 0), 0);
      return {
        shaded: false,
        cells: [
          [employee.name],
          // Hochformat: hier ist Platz für die dritte Zeile mit den Stunden.
          ...opts.dates.map((d, i) => shiftLines(own[i], closedOn(d), true)),
          [`${minutesToDecimalHours(total, 2).replace(",00", "")}h`],
        ],
      };
    });
    body.push({
      shaded: true,
      strong: true,
      cells: [
        ["Besetzung"],
        ...opts.dates.map((d) => [
          closedOn(d) ? "-" : String(employees.filter((e) => byKey.has(`${e.id}#${d}`)).length),
        ]),
        [""],
      ],
    });
    const rowH = Math.min(9, Math.max(5, usableH / (body.length + 1)));
    drawGrid(doc, MARGIN, startY, columns, head, body, 7, rowH);
  } else {
    const dateW = 20;
    const weekdayW = 26;
    const empW = (usableW - dateW - weekdayW) / Math.max(1, employees.length);
    const columns: GridColumn[] = [
      { w: dateW, align: "left" },
      { w: weekdayW, align: "left" },
      ...employees.map(() => ({ w: empW, align: "center" as const })),
    ];
    const head = ["Datum", "Wochentag", ...employees.map((e) => e.name)];
    const body: GridRow[] = opts.dates.map((d) => {
      const closed = closedOn(d);
      const holiday = holidayNames.get(d);
      return {
        shaded: closed,
        cells: [
          [format(parseIsoDate(d), "dd.MM.yyyy")],
          [WEEKDAY_LABELS_DE[weekdayKeyOf(parseIsoDate(d))] + (holiday ? ` · ${holiday}` : "")],
          ...employees.map((e) => shiftLines(byKey.get(`${e.id}#${d}`) ?? [], closed)),
        ],
      };
    });
    const rowH = Math.min(8, Math.max(4.2, usableH / (body.length + 1)));
    const fontSize = employees.length > 9 ? 5.5 : employees.length > 6 ? 6 : 6.5;
    drawGrid(doc, MARGIN, startY, columns, head, body, fontSize, rowH);
  }

  drawSignatures(doc, ["Unterschrift Arbeitgeber", "Datum"], pageH - 14);
}

export type ShareResult = "shared" | "cancelled" | "unsupported" | "failed";

/**
 * Bảng Chia sẻ của hệ thống („Lưu vào Tệp", gửi qua Zalo …) cho trình duyệt nhúng.
 * Phải gọi TRỰC TIẾP trong lúc người dùng bấm nút: tạo PDF mất vài giây, gọi
 * share sau đó thì trình duyệt coi như không có thao tác người dùng và từ chối.
 */
export async function sharePdf(blob: Blob, filename: string): Promise<ShareResult> {
  if (typeof navigator === "undefined" || typeof File === "undefined") return "unsupported";
  const file = new File([blob], filename, { type: "application/pdf" });
  if (!navigator.canShare?.({ files: [file] })) return "unsupported";
  try {
    await navigator.share({ files: [file], title: filename });
    return "shared";
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return "cancelled";
    return "failed";
  }
}
