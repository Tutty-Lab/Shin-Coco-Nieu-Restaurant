// ============================================================================
// Wann darf eine Person überhaupt eingeplant werden?
//
// Alles steht hier an EINER Stelle, weil der Scheduler an mehreren Stellen
// Termine vergibt: beim ersten Verteilen, beim Umplanen einer Woche und beim
// Verbessern der Besetzung. Eine Regel, die nur in einem Schritt steht, wird
// von den Läufen danach wieder aufgehoben.
// ============================================================================

import type { Employee } from "../types";
import { parseIsoDate, weekdayKeyOf } from "./demand";

/**
 * Arbeitet diese Person an diesem Wochentag überhaupt? Leere/fehlende Liste =
 * keine Einschränkung.
 */
export function worksOnWeekday(employee: Employee, isoDate: string): boolean {
  const tage = employee.availableWeekdays;
  if (!tage || tage.length === 0) return true;
  return tage.includes(weekdayKeyOf(parseIsoDate(isoDate)));
}

/**
 * Hat die Person an diesem Tag schon angefangen? Ohne startDate: immer ja.
 * Der ISO-Stringvergleich reicht, weil "yyyy-MM-dd" lexikografisch = zeitlich.
 */
export function hasStarted(employee: Employee, isoDate: string): boolean {
  return employee.startDate == null || isoDate >= employee.startDate;
}

/**
 * Ist die Person an diesem Tag schon weg? Ohne endDate: nie. Der Austritt ist
 * der LETZTE Arbeitstag, zählt also noch mit.
 */
export function hasLeft(employee: Employee, isoDate: string): boolean {
  return employee.endDate != null && isoDate > employee.endDate;
}

/** Zählt dieser Tag für den Vertrag dieser Person? (Eintritt … Austritt) */
export function isEmployedOn(employee: Employee, isoDate: string): boolean {
  return hasStarted(employee, isoDate) && !hasLeft(employee, isoDate);
}

/**
 * Die eine Frage, die jeder Planungsschritt stellen muss: darf diese Person an
 * diesem Datum arbeiten? (fester freier Wochentag, ein Eintritt nach diesem Tag
 * oder ein Austritt davor sprechen dagegen)
 */
export function mayWorkOn(employee: Employee, isoDate: string): boolean {
  return worksOnWeekday(employee, isoDate) && isEmployedOn(employee, isoDate);
}
