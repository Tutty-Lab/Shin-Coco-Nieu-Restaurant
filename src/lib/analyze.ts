// ============================================================================
// Auswertung eines fertigen Dienstplans. Rein lesend – verändert nichts.
//
// Beantwortet die Fragen, die man dem Plan von außen ansieht:
//  - Sind die Stoßzeiten (12–13, 17–19 Uhr) durchgehend doppelt besetzt?
//  - Folgt die Stundenverteilung wirklich den Tagesgewichten?
//  - Wie sehen die Schichtlängen aus?
// ============================================================================

import type { Employee, Shift } from "../types";
import {
  DAY_WEIGHTS,
  datesOfMonth,
  parseIsoDate,
  weekdayKeyOf,
  type WeekdayKey,
} from "./demand";
import { publicHolidays } from "./holidays";
import {
  effectiveWeekdayKey,
  resolveDay,
  type OverrideMap,
  type WorkHoursConfig,
} from "./workHours";
import { coveragePoints, staffingWindows, weightedDailyTargets, workingAt, type StaffingRule } from "./staffing";
import { weekStartOf } from "./weeks";
import { mayWorkOn } from "./availability";

export type PeakCoverage = {
  label: string;
  /** Kleinste Besetzung über die ganze Spanne. */
  minStaff: number;
  /** Größte Besetzung über die Spanne – für die Obergrenze. */
  maxStaff: number;
  required: number;
  /** So viele dürfen höchstens da sein. */
  allowed: number;
  ok: boolean;
  startMinutes: number;
  endMinutes: number;
};

export type DayReport = {
  date: string;
  weekday: WeekdayKey;
  closed: boolean;
  shiftCount: number;
  paidHours: number;
  /** Rechnerisches Tages-Soll: Gesamtstunden × Tagesgewicht / Summe Gewichte. */
  targetHours: number;
  peaks: PeakCoverage[];
};

export type WeekdayFit = {
  weekday: WeekdayKey;
  days: number;
  avgHours: number;
  /** Durchschnittliches Tages-Soll dieses Wochentags (aus dem Gewicht). */
  avgTargetHours: number;
  /** avgHours / avgTargetHours - 1, also die relative Abweichung. */
  deviation: number;
};

export type ScheduleAnalysis = {
  days: DayReport[];
  openDays: number;
  totalPaidHours: number;
  /** Tage, an denen mindestens eine Stoßzeit unterbesetzt ist. */
  peakViolations: DayReport[];
  weekdayFit: WeekdayFit[];
  /** Mittlere absolute Abweichung vom Tages-Soll, in Stunden je offenem Tag. */
  meanAbsDeviationHours: number;
  /** Dieselbe Abweichung relativ zum durchschnittlichen Tages-Soll. */
  meanAbsDeviationPercent: number;
  /** Größte Einzelabweichung eines Tages, in Stunden. */
  maxAbsDeviationHours: number;
  /** Schichtlänge (Stunden) -> Anzahl. */
  lengthHistogram: Map<number, number>;
  /** Mitarbeiter-Id -> zugewiesene Stunden. */
  hoursByEmployee: Map<string, number>;
};

export type AnalyzeInput = {
  year: number;
  month: number;
  workHours: WorkHoursConfig;
  overrides?: OverrideMap;
  employees: Employee[];
  shifts: Shift[];
  holidays?: Set<string>;
  /** Besetzungsregeln dieser Filiale; fehlt = die Standardregeln. */
  rules?: readonly StaffingRule[];
  /** Tagesgewichte dieser Filiale; fehlt = DAY_WEIGHTS. */
  weights?: Record<WeekdayKey, number>;
};

export function analyzeSchedule(input: AnalyzeInput): ScheduleAnalysis {
  const holidays = input.holidays ?? publicHolidays(input.year);
  const overrides = input.overrides ?? {};
  const dates = datesOfMonth(input.year, input.month);

  const byDate = new Map<string, Shift[]>();
  for (const s of input.shifts) {
    const list = byDate.get(s.date);
    if (list) list.push(s);
    else byDate.set(s.date, [s]);
  }

  // Tages-Soll genauso herleiten wie der Scheduler: geschlossene Tage tragen 0.
  const byWeek = new Map<string, string[]>();
  for (const date of dates) {
    if (resolveDay(input.workHours, date, holidays, overrides).closed) continue;
    const week = weekStartOf(date);
    byWeek.set(week, [...(byWeek.get(week) ?? []), date]);
  }
  const dailyTargets = new Map<string, number>();
  for (const weekDates of byWeek.values()) {
    const hours = weekDates.reduce((sum, date) => sum + (byDate.get(date) ?? []).reduce((acc, shift) => acc + shift.paidMinutes, 0), 0) / 60;
    const openMinutesOf = (value: string) => resolveDay(input.workHours, value, holidays, overrides).blocks
      .reduce((sum, block) => sum + (block.endMinutes - block.startMinutes), 0);
    for (const [date, target] of weightedDailyTargets(weekDates, hours, (value) => effectiveWeekdayKey(value, holidays), openMinutesOf, input.weights)) {
      dailyTargets.set(date, target);
    }
  }
  const employeesById = new Map(input.employees.map((employee) => [employee.id, employee]));

  const days: DayReport[] = [];
  for (const date of dates) {
    const day = resolveDay(input.workHours, date, holidays, overrides);
    const onDay = byDate.get(date) ?? [];
    const available = onDay.filter((shift) => {
      const employee = employeesById.get(shift.employeeId);
      return employee && mayWorkOn(employee, date);
    });

    const peaks: PeakCoverage[] = [];
    if (!day.closed) {
      for (const peak of staffingWindows(day.blocks, effectiveWeekdayKey(date, holidays), input.rules)) {
        const from = peak.startMinutes;
        const to = peak.endMinutes;
        const points = coveragePoints(available, from, to).slice(0, -1);
        const counts = points.map((minute) => new Set(available.filter((shift) => workingAt(shift, minute)).map((shift) => shift.employeeId)).size);
        const minStaff = counts.length ? Math.min(...counts) : 0;
        const maxStaff = counts.length ? Math.max(...counts) : 0;
        peaks.push({
          label: peak.label,
          minStaff,
          maxStaff,
          required: peak.minStaff,
          allowed: peak.maxStaff,
          // Nur ZU WENIG Leute ist ein Problem. Zu viele heißt: gut besetzt –
          // Wunsch des Betriebs, deshalb keine Warnung „quá đông" mehr.
          ok: minStaff >= peak.minStaff,
          startMinutes: from,
          endMinutes: to,
        });
      }
    }

    days.push({
      date,
      weekday: weekdayKeyOf(parseIsoDate(date)),
      closed: day.closed,
      shiftCount: onDay.length,
      paidHours: onDay.reduce((sum, s) => sum + s.paidMinutes, 0) / 60,
      targetHours: dailyTargets.get(date) ?? 0,
      peaks,
    });
  }

  const openDayReports = days.filter((d) => !d.closed);
  const deviations = openDayReports.map((d) => Math.abs(d.paidHours - d.targetHours));
  const meanAbsDeviationHours =
    deviations.length > 0 ? deviations.reduce((a, b) => a + b, 0) / deviations.length : 0;
  const avgTargetHours =
    openDayReports.length > 0
      ? openDayReports.reduce((sum, d) => sum + d.targetHours, 0) / openDayReports.length
      : 0;

  // ── Gewichtstreue je Wochentag ────────────────────────────────────────────
  // Verglichen wird Ist gegen das eigene Tages-Soll. Ein Vergleich gegen den
  // Montag als Anker wäre irreführend: liegt der Montag selbst daneben, sähen
  // alle anderen Wochentage falsch aus.
  const sumByWeekday = new Map<WeekdayKey, { hours: number; target: number; days: number }>();
  for (const d of days) {
    if (d.closed) continue;
    const acc = sumByWeekday.get(d.weekday) ?? { hours: 0, target: 0, days: 0 };
    acc.hours += d.paidHours;
    acc.target += d.targetHours;
    acc.days += 1;
    sumByWeekday.set(d.weekday, acc);
  }

  const weekdayFit: WeekdayFit[] = [];
  for (const [weekday, acc] of sumByWeekday) {
    const avgHours = acc.hours / acc.days;
    const avgTargetHours = acc.target / acc.days;
    weekdayFit.push({
      weekday,
      days: acc.days,
      avgHours,
      avgTargetHours,
      deviation: avgTargetHours > 0 ? avgHours / avgTargetHours - 1 : 0,
    });
  }
  const weights = input.weights ?? DAY_WEIGHTS;
  weekdayFit.sort((a, b) => weights[a.weekday] - weights[b.weekday]);

  const lengthHistogram = new Map<number, number>();
  for (const s of input.shifts) {
    const hours = s.paidMinutes / 60;
    lengthHistogram.set(hours, (lengthHistogram.get(hours) ?? 0) + 1);
  }

  const hoursByEmployee = new Map<string, number>();
  for (const e of input.employees) hoursByEmployee.set(e.id, 0);
  for (const s of input.shifts) {
    hoursByEmployee.set(s.employeeId, (hoursByEmployee.get(s.employeeId) ?? 0) + s.paidMinutes);
  }
  for (const [employeeId, minutes] of hoursByEmployee) hoursByEmployee.set(employeeId, minutes / 60);

  return {
    days,
    openDays: days.filter((d) => !d.closed).length,
    totalPaidHours: input.shifts.reduce((sum, s) => sum + s.paidMinutes, 0) / 60,
    peakViolations: days.filter((d) => d.peaks.some((p) => !p.ok)),
    weekdayFit,
    meanAbsDeviationHours,
    meanAbsDeviationPercent: avgTargetHours > 0 ? (meanAbsDeviationHours / avgTargetHours) * 100 : 0,
    maxAbsDeviationHours: deviations.length > 0 ? Math.max(...deviations) : 0,
    lengthHistogram,
    hoursByEmployee,
  };
}
