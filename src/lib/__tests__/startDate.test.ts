// ============================================================================
// Eintritt mitten im Monat (startDate):
//   - Tage vor dem Startdatum werden nicht verplant.
//   - Sie zählen nicht ins Monats-Soll -> keine falsche „zu wenig geplant"-Warnung.
// ============================================================================

import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { validateSchedule } from "../validation";
import { DEFAULT_WORK_HOURS, resolveDay } from "../workHours";
import { publicHolidays } from "../holidays";
import { datesOfMonth } from "../demand";
import { monthlyTargetMinutesFor } from "../contract";
import { initialScheduleFor, storeById } from "../stores";
import type { Employee } from "../../types";

const openDatesOf = (year: number, month: number): string[] => {
  const hol = publicHolidays(year);
  return datesOfMonth(year, month).filter((d) => !resolveDay(DEFAULT_WORK_HOURS, d, hol, {}).closed);
};

const wk = (id: string, h: number, x: Partial<Employee> = {}): Employee => ({
  id, name: id, employmentType: "VOLLZEIT", targetMinutes: 0, weeklyHours: h, ...x,
});

describe("Eintritt mitten im Monat (startDate)", () => {
  it("kürzt das Monats-Soll um die Tage vor dem Startdatum", () => {
    const openDates = openDatesOf(2026, 9);
    const full = wk("full", 39);
    const late = wk("late", 39, { startDate: "2026-09-07" });
    // Ohne Startdatum das volle Soll: Sept 2026 = 4 volle Wochen + Di/Mi der
    // Woche ab 28.9. Faktor = Gewicht × Öffnungsminuten (Shin: 510 min je Tag):
    // Di/Mi je 1,0 × 510, volle Woche 2×510 + 4×1,5×510 = 4.080
    // → 39 × (4 + 1.020/4.080). Mit Startdatum weniger.
    expect(monthlyTargetMinutesFor(full, openDates)).toBe(Math.round(39 * 60 * (4 + 1020 / 4080)));
    expect(monthlyTargetMinutesFor(late, openDates)).toBeLessThan(monthlyTargetMinutesFor(full, openDates));
    // Die erste (gesperrte) Woche fehlt komplett: rund eine 39-h-Woche weniger.
    const diff = (monthlyTargetMinutesFor(full, openDates) - monthlyTargetMinutesFor(late, openDates)) / 60;
    expect(diff).toBeGreaterThan(30);
    expect(diff).toBeLessThanOrEqual(39);
  });

  it("verplant keine Tage vor dem Startdatum und meldet keine Fehlstunden-Warnung", () => {
    // Shin arbeitet mit Monatsstunden; zwei Personen treten mitten im Monat ein.
    const base = initialScheduleFor(storeById("shin"));
    const seed = {
      ...base,
      employees: base.employees.map((employee: Employee, index: number) =>
        index === 1
          ? { ...employee, startDate: `${base.year}-${String(base.month).padStart(2, "0")}-07`, targetMinutes: 120 * 60 }
          : index === 2
            ? { ...employee, startDate: `${base.year}-${String(base.month).padStart(2, "0")}-10`, targetMinutes: 100 * 60 }
            : employee,
      ),
    };
    const openDates = openDatesOf(seed.year, seed.month);
    const shifts = generateSchedule({
      year: seed.year, month: seed.month, workHours: seed.workHours, employees: seed.employees,
    });

    for (const emp of seed.employees) {
      if (emp.startDate == null) continue;
      const early = shifts.filter((s) => s.employeeId === emp.id && s.date < emp.startDate!);
      expect(early, `${emp.name} darf vor ${emp.startDate} nicht arbeiten`).toEqual([]);
    }

    const v = validateSchedule(seed.employees, shifts, seed.year, openDates);
    const under = v.errors.filter((e) => e.message.includes("mới xếp được"));
    expect(under, `keine Fehlstunden-Warnung mehr:\n${under.map((e) => e.message).join("\n")}`).toEqual([]);
    // Jede geplante Person trifft ihr (personenbezogenes) Soll im 30-min-Raster.
    for (const emp of seed.employees) {
      const got = shifts.filter((s) => s.employeeId === emp.id).reduce((a, s) => a + s.paidMinutes, 0);
      // 40,2 h/Monat liegen nicht auf dem 30-Minuten-Raster.
      expect(Math.abs(got - monthlyTargetMinutesFor(emp, openDates))).toBeLessThanOrEqual(75);
    }
  });
});

describe("Austritt mitten im Monat (endDate)", () => {
  it("kürzt Wochen- und Monatsvertrag um die Tage nach dem Austritt", () => {
    const openDates = openDatesOf(2026, 9);
    const weekly = wk("w", 39);
    const weeklyOut = wk("w-out", 39, { endDate: "2026-09-15" });
    expect(monthlyTargetMinutesFor(weeklyOut, openDates)).toBeLessThan(monthlyTargetMinutesFor(weekly, openDates));
    // Monatsvertrag: anteilig über die offenen Tage bis einschliesslich Austritt.
    const monthly: Employee = { id: "m", name: "m", employmentType: "VOLLZEIT", targetMinutes: 160 * 60, endDate: "2026-09-15" };
    const bis = openDates.filter((d) => d <= "2026-09-15").length;
    const erwartet = Math.round((160 * 60 * bis) / openDates.length / 30) * 30;
    expect(monthlyTargetMinutesFor(monthly, openDates)).toBe(erwartet);
  });

  it("verplant nach dem Austritt nichts und meldet keine Fehlstunden-Warnung", () => {
    const base = initialScheduleFor(storeById("shin"));
    const ym = `${base.year}-${String(base.month).padStart(2, "0")}`;
    const employees = base.employees.map((employee: Employee, index: number) =>
      index === 1 ? { ...employee, endDate: `${ym}-14` } : employee,
    );
    const openDates = openDatesOf(base.year, base.month);
    const shifts = generateSchedule({ year: base.year, month: base.month, workHours: base.workHours, employees });
    const leaver = employees[1];
    const late = shifts.filter((s) => s.employeeId === leaver.id && s.date > leaver.endDate!);
    expect(late, `${leaver.name} darf nach ${leaver.endDate} nicht arbeiten`).toEqual([]);
    expect(shifts.some((s) => s.employeeId === leaver.id)).toBe(true);
    const v = validateSchedule(employees, shifts, base.year, openDates);
    const under = v.errors.filter((e) => e.employeeId === leaver.id && e.message.includes("mới xếp được"));
    expect(under.map((e) => e.message)).toEqual([]);
    expect(v.errors.filter((e) => e.employeeId === leaver.id && e.severity !== "warning")).toEqual([]);
  });

  it("ist nach dem Austrittsmonat nicht mehr eingeplant", () => {
    const base = initialScheduleFor(storeById("shin"));
    const employees = base.employees.map((employee: Employee, index: number) =>
      index === 1 ? { ...employee, endDate: "2026-08-31" } : employee,
    );
    const shifts = generateSchedule({ year: 2026, month: 9, workHours: base.workHours, employees });
    expect(shifts.filter((s) => s.employeeId === employees[1].id)).toEqual([]);
  });
});
