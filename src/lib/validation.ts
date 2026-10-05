// ============================================================================
// Validierung des Dienstplans gegen alle geforderten Regeln.
// ============================================================================

import type { Employee, Shift } from "../types";
import { monthlyTargetMinutes, monthlyTargetMinutesFor, SCHEDULE_SLOT_MINUTES } from "./contract";
import { calculatePause, minutesToShortHours } from "./time";
import { maxConsecutiveRun } from "./consecutive";
import { weekStartOf } from "./weeks";
import { validPause } from "./staffing";
import { mayWorkOn } from "./availability";
import { publicHolidayNames } from "./holidays";
import type { WorkHoursConfig } from "./workHours";
import type { RuleId } from "./rules";
import { minutesOutsidePreferred, ownShiftRangeMinutes, preferredWindowsOf } from "./preferredWindows";
import { parseIsoDate, weekdayKeyOf } from "./demand";

export type ValidationError = {
  employeeId?: string;
  date?: string;
  message: string;
  /**
   * "error" = der Plan ist unzulässig und muss korrigiert werden.
   * "warning" = der Plan ist benutzbar, etwas passt nur nicht ideal.
   *
   * Ein zu hohes Monats-Soll ist eine WARNUNG: der Plan bleibt gültig, es
   * fehlen nur Stunden, die der Monat gar nicht hergibt. Das als Fehler zu
   * führen hieße, dem Betrieb einen brauchbaren Plan vorzuenthalten, weil eine
   * Zahl in der Mitarbeiterliste zu groß ist.
   */
  severity?: "error" | "warning";
  /** Welche Regel (rules.ts) – entscheidet „Luật cứng" oder „Luật mềm" in der Anzeige. */
  rule?: RuleId;
};

export type EmployeeSummary = {
  employee: Employee;
  assignedMinutes: number;
  targetMinutes: number;
  diffMinutes: number; // assigned - target
  maxConsecutiveDays: number;
  shiftCount: number;
};

export type ValidationResult = {
  valid: boolean;
  errors: ValidationError[];
  summaries: EmployeeSummary[];
};

/**
 * Höchste bezahlte Zeit an einem Tag: 9 Stunden. Liegt unter der Grenze des
 * Arbeitszeitgesetzes (§ 3 ArbZG: bis zu 10 Stunden, wenn im Halbjahr auf 8
 * ausgeglichen).
 */
const MAX_PAID_MINUTES = 8 * 60;
const MAX_CONSECUTIVE_DAYS = 6;

export function validateSchedule(
  employees: Employee[],
  shifts: Shift[],
  /** Jahr des geplanten Monats. Bleibt für die einheitliche Signatur erhalten. */
  _year: number = new Date().getFullYear(),
  /**
   * Offene Tage des geplanten Monats – nötig, um Wochenverträge (weeklyHours)
   * in ein Monats-Soll umzurechnen. Fehlt der Wert, gilt targetMinutes direkt.
   *
   * Als Zahl: monatsweiter Wert, für alle gleich (Altpfad, z. B. Tests).
   * Als ISO-Datumsliste der offenen Tage: das Soll wird je Person über ihre
   * vertragswirksamen Tage gerechnet – so zählt ein Eintritt mitten im Monat
   * (startDate) korrekt und löst keine falsche „zu wenig geplant"-Warnung aus.
   */
  openDays?: number | readonly string[],
  /** Wochenplan des Ladens – gleicher Faktor für das Monats-Soll wie im Scheduler. */
  workHours?: WorkHoursConfig,
): ValidationResult {
  const errors: ValidationError[] = [];
  const sollOf = (e: Employee): number => {
    if (openDays == null) return e.targetMinutes;
    return typeof openDays === "number"
      ? monthlyTargetMinutes(e, openDays)
      : monthlyTargetMinutesFor(e, openDays, workHours);
  };
  const employeeById = new Map(employees.map((e) => [e.id, e] as const));

  const shiftsByEmployee = new Map<string, Shift[]>();
  for (const emp of employees) shiftsByEmployee.set(emp.id, []);
  for (const shift of shifts) {
    if (!shiftsByEmployee.has(shift.employeeId)) {
      shiftsByEmployee.set(shift.employeeId, []);
    }
    shiftsByEmployee.get(shift.employeeId)!.push(shift);
  }

  // Regeln je einzelner Schicht.
  for (const shift of shifts) {
    const presence = shift.endMinutes - shift.startMinutes;
    const expectedPaid = presence - shift.pauseMinutes;
    const expectedPause = calculatePause(shift.paidMinutes);
    const employee = employeeById.get(shift.employeeId);
    if (employee && !mayWorkOn(employee, shift.date)) errors.push({ employeeId: employee.id, date: shift.date, rule: "days-off",
      message: `${employee.name}: đã xếp vào ngày không thể làm ${shift.date}.`,
    });
    if (shift.pauseStartMinutes != null && !validPause(shift)) errors.push({ employeeId: shift.employeeId, date: shift.date, rule: "shift-length",
      message: `Giờ nghỉ không hợp lệ ngày ${shift.date}.`,
    });
    if (employee?.weeklyHours != null && shift.pauseMinutes > 0 && shift.pauseStartMinutes == null) errors.push({ employeeId: shift.employeeId, date: shift.date, rule: "shift-length",
      message: `Chưa xếp giờ bắt đầu nghỉ ngày ${shift.date}; cần giờ nghỉ cụ thể để kiểm tra đủ người.`,
    });

    if (shift.endMinutes <= shift.startMinutes) {
      errors.push({
        employeeId: shift.employeeId,
        date: shift.date,
        rule: "shift-length",
        message: `Giờ ra không sau giờ vào (${shift.date}).`,
      });
    }
    if (shift.paidMinutes > MAX_PAID_MINUTES) {
      errors.push({
        employeeId: shift.employeeId,
        date: shift.date,
        rule: "shift-length",
        message: `Quá ${MAX_PAID_MINUTES / 60} giờ công ngày ${shift.date}.`,
      });
    }
    if (shift.paidMinutes !== expectedPaid) {
      errors.push({
        employeeId: shift.employeeId,
        date: shift.date,
        rule: "shift-length",
        message: `Giờ công không khớp giờ vào/ra/nghỉ ngày ${shift.date}.`,
      });
    }
    if (shift.pauseMinutes !== expectedPause) {
      errors.push({
        employeeId: shift.employeeId,
        date: shift.date,
        rule: "shift-length",
        message: `Sai giờ nghỉ ngày ${shift.date}: ${shift.pauseMinutes} thay vì ${expectedPause} phút.`,
      });
    }
  }

  const summaries: EmployeeSummary[] = [];

  for (const emp of employees) {
    const empShifts = shiftsByEmployee.get(emp.id) ?? [];

    // Zwei Dienste an einem Tag sind erlaubt, solange sie sich nicht
    // überschneiden – mittags und abends bei einem Laden, der zwischendurch
    // schließt. Verboten bleibt nur, was sich überlappt.
    const seenDates = new Set<string>();
    for (const shift of empShifts) {
      const ueberschneidet = empShifts.some(
        (a) =>
          a !== shift &&
          a.date === shift.date &&
          a.startMinutes < shift.endMinutes &&
          shift.startMinutes < a.endMinutes,
      );
      if (ueberschneidet && !seenDates.has(shift.date)) {
        errors.push({
          employeeId: emp.id,
          date: shift.date,
          rule: "shift-length",
        message: `Có nhiều hơn một ca ngày ${shift.date}.`,
        });
      }
      seenDates.add(shift.date);
    }

    const assignedMinutes = empShifts.reduce((sum, s) => sum + s.paidMinutes, 0);
    for (const date of seenDates) {
      const paid = empShifts.filter((shift) => shift.date === date).reduce((sum, shift) => sum + shift.paidMinutes, 0);
      if (paid > MAX_PAID_MINUTES) errors.push({ employeeId: emp.id, date, rule: "shift-length",
        message: `${emp.name}: tổng giờ công ngày ${date} vượt ${MAX_PAID_MINUTES / 60} giờ.`,
      });
    }
    const maxRun = maxConsecutiveRun(new Set(empShifts.map((s) => s.date)));
    const soll = sollOf(emp);

    if (emp.weeklyHours != null) {
      const weeks = new Map<string, { paid: number; dates: Set<string> }>();
      for (const shift of empShifts) {
        const week = weekStartOf(shift.date);
        const total = weeks.get(week) ?? { paid: 0, dates: new Set<string>() };
        total.paid += shift.paidMinutes;
        total.dates.add(shift.date);
        weeks.set(week, total);
      }
      for (const [week, total] of weeks) {
        if (total.paid > Math.round(emp.weeklyHours * 60)) {
          errors.push({
            employeeId: emp.id,
            date: week,
            rule: "contract-max",
            message: `${emp.name}: tuần ${week} xếp ${total.paid / 60}h, vượt hợp đồng ${emp.weeklyHours}h/tuần.`,
          });
        }
      }
    }

    // „Số ngày làm / tuần" gilt für jeden Vertrag, nicht nur für Wochenverträge.
    if (emp.maxDaysPerWeek != null && emp.maxDaysPerWeek < 6) {
      const datesByWeek = new Map<string, Set<string>>();
      for (const shift of empShifts) {
        const week = weekStartOf(shift.date);
        datesByWeek.set(week, (datesByWeek.get(week) ?? new Set<string>()).add(shift.date));
      }
      for (const [week, dates] of datesByWeek) {
        if (dates.size > emp.maxDaysPerWeek) {
          errors.push({
            employeeId: emp.id,
            date: week,
            rule: "max-days",
            message: `${emp.name}: tuần ${week} làm ${dates.size} ngày, vượt giới hạn ${emp.maxDaysPerWeek} ngày/tuần.`,
          });
        }
      }
    }

    // Weiche Regeln je Person: nur melden, der Plan bleibt gültig.
    const ownRange = ownShiftRangeMinutes(emp);
    if (ownRange) {
      const outside = [...seenDates].filter((date) => {
        const paid = empShifts.filter((shift) => shift.date === date).reduce((sum, shift) => sum + shift.paidMinutes, 0);
        return paid < ownRange.min || paid > ownRange.max;
      });
      if (outside.length > 0) {
        errors.push({
          employeeId: emp.id,
          severity: "warning",
          rule: "own-shift-length",
          message: `${emp.name}: ${outside.length} ngày ngoài độ dài ca ${minutesToShortHours(ownRange.min)}–${minutesToShortHours(ownRange.max)} (${outside.map((d) => d.slice(8, 10) + "." + d.slice(5, 7)).join(", ")}).`,
        });
      }
    }
    const windows = preferredWindowsOf(emp);
    if (windows.length > 0) {
      const outsideShifts = empShifts.filter(
        (shift) => minutesOutsidePreferred(windows, weekdayKeyOf(parseIsoDate(shift.date)), shift) > 0,
      );
      if (outsideShifts.length > 0) {
        errors.push({
          employeeId: emp.id,
          severity: "warning",
          rule: "preferred-windows",
          message: `${emp.name}: ${outsideShifts.length}/${empShifts.length} ca ngoài khung giờ ưu tiên (${[...new Set(outsideShifts.map((s) => s.date.slice(8, 10) + "." + s.date.slice(5, 7)))].join(", ")}).`,
        });
      }
    }

    const targetDifference = assignedMinutes - soll;
    // Randwochen werden so gerundet, dass eine über zwei Monate laufende Woche
    // den Wochenvertrag nie überschreitet (contract.ts). Ein Monat weicht dadurch
    // um weniger als eine Rastereinheit (30 min) vom rechnerischen Wert ab.
    if (Math.abs(targetDifference) >= SCHEDULE_SLOT_MINUTES) {
      // Zu WENIG verteilt heißt: der Monat gibt nicht mehr her (oder eine feste
      // Schicht trifft das Soll nicht ganz genau) – Warnung. Zu VIEL wäre ein
      // echter Fehler im Plan.
      const zuWenig = assignedMinutes < soll;
      errors.push({
        employeeId: emp.id,
        severity: zuWenig ? "warning" : "error",
        rule: zuWenig ? "contract-hours" : "contract-max",
        message: zuWenig
          ? `${emp.name}: thiếu ${minutesToShortHours(soll - assignedMinutes)} — mới xếp được ${minutesToShortHours(assignedMinutes)} / ${minutesToShortHours(soll)}.`
          : `${emp.name}: xếp quá giờ định mức: ${minutesToShortHours(assignedMinutes)} thay vì ${minutesToShortHours(soll)}.`,
      });
    }
    if (maxRun > MAX_CONSECUTIVE_DAYS) {
      errors.push({
        employeeId: emp.id,
        rule: "max-days",
        message: `${emp.name}: làm quá 6 ngày liên tiếp (${maxRun}).`,
      });
    }

    summaries.push({
      employee: emp,
      assignedMinutes,
      targetMinutes: soll,
      diffMinutes: assignedMinutes - soll,
      maxConsecutiveDays: maxRun,
      shiftCount: empShifts.length,
    });
  }

  // Feiertagspflicht: wer requiredOnHolidays trägt, muss an jedem GEÖFFNETEN
  // Feiertag im Dienst sein (Vorgabe des Betriebs). Ohne Datumsliste lässt
  // sich nicht sagen, ob der Laden offen hat – dann wird nicht geprüft.
  const openDateSet = Array.isArray(openDays) ? new Set(openDays) : null;
  if (openDateSet) {
    for (const [date, name] of publicHolidayNames(_year)) {
      if (!openDateSet.has(date)) continue;
      for (const emp of employees) {
        if (!emp.requiredOnHolidays || !mayWorkOn(emp, date)) continue;
        if (shifts.some((shift) => shift.employeeId === emp.id && shift.date === date)) continue;
        errors.push({
          employeeId: emp.id,
          date,
          severity: "warning",
          rule: "holiday-duty",
          message: `${emp.name}: ngày lễ ${date} (${name}) chưa có ca — quán yêu cầu phải có mặt.`,
        });
      }
    }
  }

  // Warnungen machen den Plan nicht ungültig – sonst blockiert eine zu große
  // Zahl in der Mitarbeiterliste das Drucken eines sonst brauchbaren Plans.
  const echteFehler = errors.filter((e) => e.severity !== "warning");
  return { valid: echteFehler.length === 0, errors, summaries };
}
