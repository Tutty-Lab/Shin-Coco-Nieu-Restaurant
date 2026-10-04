// ============================================================================
// Gespeicherte Stände des Dienstplans („Bản đã lưu").
//
// Ein Laden hält immer nur EINEN aktuellen Plan. „Tạo lịch" überschrieb ihn
// bisher ohne Rückweg – auch den Plan des Vormonats, wenn man den Monat
// gewechselt und neu erzeugt hat. Deshalb wird vor jedem Überschreiben
// automatisch eine Kopie abgelegt, und der Chủ quán kann selbst Stände
// sichern und zurückholen. Die Kopien liegen im Schedule und werden damit
// wie alles andere lokal und in Supabase gespeichert.
// ============================================================================

import type { Schedule, Shift } from "../types";

export type SavedPlan = {
  id: string;
  /** ISO-Zeitpunkt des Speicherns. */
  savedAt: string;
  year: number;
  month: number;
  /** "auto" = vor dem Überschreiben automatisch gesichert. */
  kind: "auto" | "manual";
  shifts: Shift[];
};

/** Höchstens so viele Stände je Laden – die Zeile in Supabase soll klein bleiben. */
export const MAX_SAVED_PLANS = 10;

/** Monat eines Plans aus seinen Diensten (nicht aus der Kopfzeile – die kann schon weiter sein). */
export function planMonthOf(shifts: readonly Shift[]): { year: number; month: number } | null {
  const first = shifts.reduce<string | null>((min, s) => (min == null || s.date < min ? s.date : min), null);
  if (!first) return null;
  const [year, month] = first.split("-").map(Number);
  return { year, month };
}

/** Gleiche Dienste (Reihenfolge egal)? Dann muss nicht noch einmal gesichert werden. */
function sameShifts(a: readonly Shift[], b: readonly Shift[]): boolean {
  if (a.length !== b.length) return false;
  const key = (s: Shift) => `${s.employeeId}|${s.date}|${s.startMinutes}|${s.endMinutes}|${s.pauseMinutes}`;
  const set = new Set(a.map(key));
  return b.every((s) => set.has(key(s)));
}

/**
 * Den aktuellen Plan als Kopie ablegen. Kein Plan oder derselbe Stand wie die
 * jüngste Kopie => unverändert. Die ältesten Kopien fallen über MAX heraus.
 */
export function withSavedPlan(schedule: Schedule, kind: SavedPlan["kind"], now = new Date()): Schedule {
  const shifts = schedule.shifts;
  const period = planMonthOf(shifts);
  if (!period) return schedule;
  const list = schedule.savedPlans ?? [];
  if (list.length > 0 && sameShifts(list[0].shifts, shifts)) {
    // Schon gesichert – ein manuelles Speichern macht die Kopie nur „manuell".
    if (kind === "manual" && list[0].kind !== "manual") {
      return { ...schedule, savedPlans: [{ ...list[0], kind: "manual", savedAt: now.toISOString() }, ...list.slice(1)] };
    }
    return schedule;
  }
  const plan: SavedPlan = {
    id: `plan-${now.getTime()}-${Math.floor(Math.random() * 1e6)}`,
    savedAt: now.toISOString(),
    ...period,
    kind,
    shifts: shifts.map((s) => ({ ...s })),
  };
  return { ...schedule, savedPlans: [plan, ...list].slice(0, MAX_SAVED_PLANS) };
}

/** Einen gespeicherten Stand zurückholen; der aktuelle wird vorher gesichert. */
export function restoreSavedPlan(schedule: Schedule, id: string, now = new Date()): Schedule {
  const plan = (schedule.savedPlans ?? []).find((p) => p.id === id);
  if (!plan) return schedule;
  const gesichert = withSavedPlan(schedule, "auto", now);
  return {
    ...gesichert,
    year: plan.year,
    month: plan.month,
    shifts: plan.shifts.map((s) => ({ ...s })),
    lockedAt: undefined,
    printedWeeks: [],
    underQuotaAccepted: undefined,
  };
}

export function withoutSavedPlan(schedule: Schedule, id: string): Schedule {
  return { ...schedule, savedPlans: (schedule.savedPlans ?? []).filter((p) => p.id !== id) };
}
