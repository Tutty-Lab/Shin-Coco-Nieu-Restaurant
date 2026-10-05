// ============================================================================
// Eigene, weiche Regeln je Mitarbeiter (aus der Thienlong-App übernommen):
// „Độ dài ca" und „Khung giờ ưu tiên". Wer keine davon gesetzt hat, wird genau
// wie bisher geplant – alle Funktionen liefern dann null bzw. 0.
// ============================================================================

import type { Employee, PreferredWindow, Shift } from "../types";
import { WEEKDAY_SHORT_VI, type WeekdayKey } from "./demand";
import { minutesToTime } from "./time";

const DAY_ORDER: WeekdayKey[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/** Kürzeste und längste bezahlte Zeit je Tag, die der Planer überhaupt kennt. */
const MIN_DAY = 180;
const MAX_DAY = 480;

/** Nur gültige Fenster (mind. ein Tag, Ende nach Beginn). */
export function preferredWindowsOf(employee: Employee): PreferredWindow[] {
  return (employee.preferredWindows ?? []).filter((w) => w.days.length > 0 && w.endMinutes > w.startMinutes);
}

/**
 * Arbeitsminuten außerhalb der Wunschfenster des Wochentags. An einem Tag ganz
 * ohne Fenster zählt jede Minute; ohne Fenster überhaupt ist das Ergebnis 0.
 * Der Wochentag ist der KALENDERtag – ein Feiertag zählt hier nicht als Sonntag.
 */
export function minutesOutsidePreferred(windows: readonly PreferredWindow[], weekday: WeekdayKey, shift: Shift): number {
  if (windows.length === 0) return 0;
  const today = windows.filter((w) => w.days.includes(weekday));
  let outside = 0;
  for (let t = shift.startMinutes; t < shift.endMinutes; t += 15) {
    const end = Math.min(t + 15, shift.endMinutes);
    if (!today.some((w) => w.startMinutes <= t && end <= w.endMinutes)) outside += end - t;
  }
  return outside;
}

/**
 * „Độ dài ca" in Minuten, auf das 30-Minuten-Raster und die Grenzen des
 * Betriebs (3–8 h je Tag) gebracht. null = nicht gesetzt.
 */
export function ownShiftRangeMinutes(employee: Employee): { min: number; max: number } | null {
  const r = employee.shiftHours;
  if (!r || !(r.min > 0) || !(r.max >= r.min)) return null;
  const min = Math.min(MAX_DAY, Math.max(MIN_DAY, Math.ceil((r.min * 60) / 30) * 30));
  const max = Math.min(MAX_DAY, Math.max(min, Math.floor((r.max * 60) / 30) * 30));
  return { min, max };
}

/** Kurztext für Liste/Hinweise, z. B. „T3–T6 11:30–15:00". */
export function describePreferredWindow(w: PreferredWindow): string {
  return `${describeDays(w.days)} ${minutesToTime(w.startMinutes)}–${minutesToTime(w.endMinutes)}`;
}

function describeDays(days: readonly WeekdayKey[]): string {
  const idx = DAY_ORDER.map((d, i) => (days.includes(d) ? i : -1)).filter((i) => i >= 0);
  if (idx.length === 7) return "Cả tuần";
  const runs: string[] = [];
  for (let k = 0; k < idx.length; ) {
    let j = k;
    while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++;
    const from = WEEKDAY_SHORT_VI[DAY_ORDER[idx[k]]];
    const to = WEEKDAY_SHORT_VI[DAY_ORDER[idx[j]]];
    runs.push(j - k >= 2 ? `${from}–${to}` : j > k ? `${from}, ${to}` : from);
    k = j + 1;
  }
  return runs.join(", ");
}
