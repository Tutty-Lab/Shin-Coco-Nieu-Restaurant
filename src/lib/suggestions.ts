// ============================================================================
// „Tìm cách xếp khác" (wie in der Thienlong-App): probiert kleine Änderungen an
// den Einstellungen einzelner Mitarbeiter aus, erzeugt für jede einen
// Probe-Plan ALLER Läden (wegen der Leute in zwei Läden) und zählt, was danach
// noch verletzt ist. Vorgeschlagen wird nur, was wirklich besser ist.
//
// Probiert wird nur, was eine Person selbst einschränkt – Ngày nghỉ cố định,
// Số ngày làm / tuần, Độ dài ca, Khung giờ ưu tiên – und bei Leuten in zwei
// Läden ein Tag weniger im ersten Laden. Harte Regeln des Betriebs bleiben.
// ============================================================================

import type { Employee, Schedule, Shift } from "../types";
import { generateSchedule } from "./scheduler";
import { validateSchedule, type ValidationError } from "./validation";
import { analyzeSchedule } from "./analyze";
import { datesOfMonth, WEEKDAY_SHORT_VI, type WeekdayKey } from "./demand";
import { publicHolidays } from "./holidays";
import { resolveDay, type OverrideMap } from "./workHours";
import type { StaffingRule } from "./staffing";
import { ruleById, staffingRuleId, type RuleId } from "./rules";

export type TrialStore = {
  storeId: string;
  shortName: string;
  schedule: Schedule;
  rules: readonly StaffingRule[];
  weights: Record<WeekdayKey, number>;
};

export type EmployeeChange = {
  storeId: string;
  employeeId: string;
  /** „Thu Van Nguyen (Coco): bỏ ngày nghỉ T4" */
  label: string;
  patch: Partial<Employee>;
};

/** Je kleiner, desto besser – in dieser Reihenfolge verglichen. */
export type Score = {
  /** Verletzte harte Regeln (Fehler, Feiertagsdienst, Mindestbesetzung). */
  hard: number;
  /** Fehlende Vertragsminuten über alle Läden. */
  missingMinutes: number;
  /** Übrige weiche Abweichungen (Stoßzeiten, Độ dài ca, Khung giờ). */
  soft: number;
};

export type FixOption = { changes: EmployeeChange[]; score: Score };
export type FixResult = { baseline: Score; options: FixOption[] };

/** Ein Problem für die Anzeige, mit Regel. */
export type Issue = { storeId: string; rule: RuleId; hard: boolean; message: string; employeeId?: string; date?: string };

const DAY_ORDER: WeekdayKey[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function overridesOf(schedule: Schedule): OverrideMap {
  const map: OverrideMap = {};
  for (const ov of schedule.dateOverrides) map[ov.date] = ov;
  return map;
}

export function openDatesOf(schedule: Schedule): string[] {
  const holidays = publicHolidays(schedule.year);
  const overrides = overridesOf(schedule);
  return datesOfMonth(schedule.year, schedule.month).filter(
    (date) => !resolveDay(schedule.workHours, date, holidays, overrides).closed,
  );
}

/** Wie „Tạo lịch": Läden nacheinander, Leute in zwei Läden am selben Tag gesperrt. */
export function planAll(stores: readonly TrialStore[]): Map<string, Shift[]> {
  const busy = new Map<string, Set<string>>();
  const plans = new Map<string, Shift[]>();
  for (const store of stores) {
    const { schedule } = store;
    const blocked: Record<string, string[]> = {};
    for (const employee of schedule.employees) {
      const dates = employee.personKey ? busy.get(employee.personKey) : undefined;
      if (dates?.size) blocked[employee.id] = [...dates];
    }
    const shifts = generateSchedule({
      year: schedule.year,
      month: schedule.month,
      workHours: schedule.workHours,
      overrides: overridesOf(schedule),
      employees: schedule.employees,
      rules: store.rules,
      weights: store.weights,
      blockedDays: blocked,
      storeTag: store.storeId,
    });
    plans.set(store.storeId, shifts);
    for (const employee of schedule.employees) {
      if (!employee.personKey) continue;
      const dates = busy.get(employee.personKey) ?? new Set<string>();
      for (const shift of shifts) if (shift.employeeId === employee.id) dates.add(shift.date);
      busy.set(employee.personKey, dates);
    }
  }
  return plans;
}

/** Alle Probleme eines Ladens: Prüfung + Besetzung je Tag, nach Regel eingeordnet. */
export function issuesOf(store: TrialStore, shifts: Shift[]): { issues: Issue[]; missingMinutes: number } {
  const { schedule } = store;
  const openDates = openDatesOf(schedule);
  const validation = validateSchedule(schedule.employees, shifts, schedule.year, openDates, schedule.workHours);
  const issues: Issue[] = validation.errors.map((error: ValidationError) => {
    const rule: RuleId = error.rule ?? (error.severity === "warning" ? "contract-hours" : "shift-length");
    return { storeId: store.storeId, rule, hard: ruleById(rule).kind === "hard", message: error.message, employeeId: error.employeeId, date: error.date };
  });
  const missingMinutes = validation.summaries.reduce((sum, s) => sum + Math.max(0, -s.diffMinutes), 0);
  if (shifts.length > 0) {
    const analysis = analyzeSchedule({
      year: schedule.year,
      month: schedule.month,
      workHours: schedule.workHours,
      overrides: overridesOf(schedule),
      employees: schedule.employees,
      shifts,
      rules: store.rules,
      weights: store.weights,
    });
    for (const day of analysis.peakViolations) {
      for (const peak of day.peaks.filter((p) => !p.ok)) {
        const rule = staffingRuleId(peak.label);
        issues.push({
          storeId: store.storeId,
          rule,
          hard: rule === "closing",
          date: day.date,
          message:
            peak.minStaff < peak.required
              ? `${day.date.slice(8, 10)}.${day.date.slice(5, 7)} ${peak.label}: thiếu người (${peak.minStaff}/${peak.required}).`
              : `${day.date.slice(8, 10)}.${day.date.slice(5, 7)} ${peak.label}: quá đông (${peak.maxStaff}, tối đa ${peak.allowed}).`,
        });
      }
    }
  }
  return { issues, missingMinutes };
}

export function scoreOf(stores: readonly TrialStore[], plans: Map<string, Shift[]>): Score {
  let hard = 0;
  let soft = 0;
  let missingMinutes = 0;
  for (const store of stores) {
    const result = issuesOf(store, plans.get(store.storeId) ?? []);
    missingMinutes += result.missingMinutes;
    for (const issue of result.issues) {
      if (issue.hard) hard++;
      else if (issue.rule !== "contract-hours") soft++;
    }
  }
  return { hard, missingMinutes, soft };
}

/** a besser als b? Harte Regeln zuerst, dann fehlende Stunden, dann der Rest. */
export function better(a: Score, b: Score): boolean {
  if (a.hard !== b.hard) return a.hard < b.hard;
  if (a.missingMinutes !== b.missingMinutes) return a.missingMinutes < b.missingMinutes;
  return a.soft < b.soft;
}

function withChanges(stores: readonly TrialStore[], changes: readonly EmployeeChange[]): TrialStore[] {
  return stores.map((store) => ({
    ...store,
    schedule: {
      ...store.schedule,
      employees: store.schedule.employees.map((employee) => {
        const patches = changes.filter((c) => c.storeId === store.storeId && c.employeeId === employee.id);
        return patches.reduce((e, c) => ({ ...e, ...c.patch }), employee);
      }),
    },
  }));
}

/** Was die Person selbst einschränkt – jede Lockerung ist ein Kandidat. */
function relaxations(store: TrialStore, employee: Employee, openDates: readonly string[]): EmployeeChange[] {
  const who = `${employee.name} (${store.shortName})`;
  const base = { storeId: store.storeId, employeeId: employee.id };
  const out: EmployeeChange[] = [];
  const available = employee.availableWeekdays;
  if (available && available.length > 0 && available.length < 7) {
    const openWeekdays = new Set(openDates.map((date) => DAY_ORDER[(new Date(`${date}T12:00:00`).getDay() + 6) % 7]));
    for (const day of DAY_ORDER.filter((d) => !available.includes(d) && openWeekdays.has(d))) {
      const next = [...available, day];
      out.push({
        ...base,
        label: `${who}: bỏ ngày nghỉ cố định ${WEEKDAY_SHORT_VI[day]}`,
        patch: { availableWeekdays: next.length >= 7 ? undefined : DAY_ORDER.filter((d) => next.includes(d)) },
      });
    }
  }
  if (employee.maxDaysPerWeek != null && employee.maxDaysPerWeek < 6) {
    const next = employee.maxDaysPerWeek + 1;
    out.push({
      ...base,
      label: `${who}: số ngày làm/tuần ${employee.maxDaysPerWeek} → ${next >= 6 ? "Tự" : next}`,
      patch: { maxDaysPerWeek: next >= 6 ? undefined : next },
    });
  }
  if (employee.shiftHours) out.push({ ...base, label: `${who}: bỏ độ dài ca riêng`, patch: { shiftHours: undefined, spreadEvenly: undefined } });
  if (employee.preferredWindows?.length) out.push({ ...base, label: `${who}: bỏ khung giờ ưu tiên`, patch: { preferredWindows: undefined } });
  return out;
}

/** Bei Leuten in zwei Läden: im früher geplanten Laden einen Tag je Woche freigeben. */
function partnerChanges(stores: readonly TrialStore[], storeIndex: number, employee: Employee): EmployeeChange[] {
  if (!employee.personKey) return [];
  const out: EmployeeChange[] = [];
  stores.forEach((store, index) => {
    if (index >= storeIndex) return;
    const partner = store.schedule.employees.find((e) => e.personKey === employee.personKey);
    if (!partner) return;
    const current = partner.maxDaysPerWeek ?? 6;
    if (current <= 1) return;
    out.push({
      storeId: store.storeId,
      employeeId: partner.id,
      label: `${partner.name} (${store.shortName}): số ngày làm/tuần ${partner.maxDaysPerWeek ?? "Tự"} → ${current - 1} (để ${stores[storeIndex].shortName} có thêm ngày)`,
      patch: { maxDaysPerWeek: current - 1 },
    });
  });
  return out;
}

const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Sucht bis zu 4 Änderungen (einzeln oder zu zweit), die den Plan besser machen.
 * `onProgress` für „Đang thử 3/9…".
 */
export async function findFixes(
  stores: readonly TrialStore[],
  onProgress?: (done: number, total: number) => void,
): Promise<FixResult> {
  const basePlans = planAll(stores);
  const baseline = scoreOf(stores, basePlans);

  // Kandidaten: Leute mit eigenem Problem zuerst, bei Besetzungslücken alle mit Einschränkungen.
  const candidates: EmployeeChange[] = [];
  const seen = new Set<string>();
  const add = (change: EmployeeChange) => {
    const key = `${change.storeId}|${change.employeeId}|${JSON.stringify(change.patch)}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(change);
  };
  stores.forEach((store, index) => {
    const openDates = openDatesOf(store.schedule);
    const { issues } = issuesOf(store, basePlans.get(store.storeId) ?? []);
    const people = new Set(issues.map((issue) => issue.employeeId).filter((id): id is string => Boolean(id)));
    const staffing = issues.some((issue) => issue.rule === "closing" || issue.rule === "peak-staff");
    for (const employee of store.schedule.employees) {
      if (!people.has(employee.id) && !staffing) continue;
      relaxations(store, employee, openDates).forEach(add);
      if (people.has(employee.id)) partnerChanges(stores, index, employee).forEach(add);
    }
  });
  const singles = candidates.slice(0, 12);

  const total = singles.length + Math.min(3, (singles.length * (singles.length - 1)) / 2);
  let done = 0;
  const step = async () => {
    done += 1;
    onProgress?.(done, total);
    await nextTick();
  };

  const tried: FixOption[] = [];
  const evaluate = (changes: EmployeeChange[]) => {
    const trial = withChanges(stores, changes);
    return { changes, score: scoreOf(trial, planAll(trial)) };
  };
  for (const change of singles) {
    tried.push(evaluate([change]));
    await step();
  }
  // Paare aus den drei besten Einzeländerungen (z. B. ein Tag mehr + Khung giờ weg).
  const best = tried.filter((o) => better(o.score, baseline)).sort((a, b) => (better(a.score, b.score) ? -1 : 1)).slice(0, 3);
  for (let i = 0; i < best.length; i++) {
    for (let j = i + 1; j < best.length; j++) {
      const a = best[i].changes[0];
      const b = best[j].changes[0];
      if (a.storeId === b.storeId && a.employeeId === b.employeeId) continue;
      tried.push(evaluate([a, b]));
      await step();
    }
  }
  const options = tried
    .filter((o) => better(o.score, baseline))
    .sort((a, b) => (better(a.score, b.score) ? -1 : better(b.score, a.score) ? 1 : a.changes.length - b.changes.length))
    .slice(0, 4);
  return { baseline, options };
}
