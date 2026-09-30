// ============================================================================
// Die Vorgaben des Betriebs für ALLE Filialen (Shin, Coco, Nieu 37):
//   - Ruhetag Montag, offen Di–So 11:30–15:00 und 17:00–22:00
//   - immer jemand bis 15:00 UND bis 22:00 im Dienst (hart)
//   - höchstens 8 h bezahlt am Tag, höchstens 6 Tage am Stück
//   - jeder Monatsvertrag wird auf die halbe Stunde genau erfüllt
//   - Shin: an Feiertagen ist Bá Việt Nguyen im Dienst
//   - wer in zwei Läden arbeitet, steht nie am selben Tag in beiden
// ============================================================================

import { describe, expect, it } from "vitest";
import type { Employee, Shift } from "../../types";
import { generateSchedule } from "../scheduler";
import { validateSchedule } from "../validation";
import { analyzeSchedule } from "../analyze";
import { makeEmployee } from "../sampleData";
import { STORES, initialScheduleFor, storeById, withSharedPersonDefaults, type StoreConfig } from "../stores";
import { DEFAULT_WORK_HOURS, resolveDay } from "../workHours";
import { publicHolidays, publicHolidayNames } from "../holidays";
import { datesOfMonth, parseIsoDate, weekdayKeyOf } from "../demand";
import { workingAt } from "../staffing";
import { maxConsecutiveRun } from "../consecutive";

const MONTHS = [2, 8, 9, 12];
/** Jede Filiale mit ihrer Belegschaft – die Regeln gelten für alle gleich. */
const TEAMS = STORES.map((store) => [store.shortName, store] as const);

function openDatesOf(year: number, month: number): string[] {
  const holidays = publicHolidays(year);
  return datesOfMonth(year, month).filter((d) => !resolveDay(DEFAULT_WORK_HOURS, d, holidays, {}).closed);
}

function teamOf(store: StoreConfig): Employee[] {
  return store.sampleEmployees();
}

function planOf(year: number, month: number, store: StoreConfig, employees = teamOf(store)): Shift[] {
  return generateSchedule({
    year,
    month,
    workHours: DEFAULT_WORK_HOURS,
    employees,
    rules: store.staffingRules,
    weights: store.dayWeights,
    storeTag: store.id,
  });
}

/** Plant alle Filialen nacheinander – genau wie „Tạo lịch làm việc" in der App. */
function planAll(year: number, month: number): Map<string, Shift[]> {
  const busy = new Map<string, Set<string>>();
  const plans = new Map<string, Shift[]>();
  for (const store of STORES) {
    const employees = teamOf(store);
    const blocked: Record<string, string[]> = {};
    for (const employee of employees) {
      const dates = employee.personKey ? busy.get(employee.personKey) : undefined;
      if (dates?.size) blocked[employee.id] = [...dates];
    }
    const shifts = generateSchedule({
      year, month, workHours: DEFAULT_WORK_HOURS, employees,
      rules: store.staffingRules, weights: store.dayWeights, blockedDays: blocked, storeTag: store.id,
    });
    plans.set(store.id, shifts);
    for (const employee of employees) {
      if (!employee.personKey) continue;
      const dates = busy.get(employee.personKey) ?? new Set<string>();
      for (const shift of shifts) if (shift.employeeId === employee.id) dates.add(shift.date);
      busy.set(employee.personKey, dates);
    }
  }
  return plans;
}

describe("Öffnungszeiten und Ruhetag", () => {
  it.each(TEAMS)("%s: plant montags nie, und jeder Dienst liegt in einem Öffnungsblock", (_name, store) => {
    const holidays = publicHolidays(2026);
    for (const month of MONTHS) {
      for (const shift of planOf(2026, month, store)) {
        const day = resolveDay(DEFAULT_WORK_HOURS, shift.date, holidays, {});
        expect(weekdayKeyOf(parseIsoDate(shift.date)), shift.date).not.toBe("monday");
        expect(day.closed, shift.date).toBe(false);
        expect(
          day.blocks.some((b) => shift.startMinutes >= b.startMinutes && shift.endMinutes <= b.endMinutes),
          `${shift.date} ${shift.startMinutes}`,
        ).toBe(true);
      }
    }
  });
});

describe("Harte Regeln (alle Filialen)", () => {
  it.each(TEAMS)("%s: hält jeden Tag jemanden bis 15:00 und bis 22:00 im Dienst", (_name, store) => {
    for (const month of MONTHS) {
      const shifts = planOf(2026, month, store);
      for (const date of openDatesOf(2026, month)) {
        const onDay = shifts.filter((s) => s.date === date);
        expect(onDay.some((s) => workingAt(s, 14 * 60 + 45)), `${date} 14:45`).toBe(true);
        expect(onDay.some((s) => workingAt(s, 21 * 60 + 45)), `${date} 21:45`).toBe(true);
      }
    }
  });

  it.each(TEAMS)("%s: bleibt bei höchstens 8 bezahlten Stunden je Tag und 6 Tagen am Stück", (_name, store) => {
    for (const month of MONTHS) {
      const shifts = planOf(2026, month, store);
      const perDay = new Map<string, number>();
      for (const s of shifts) {
        const key = `${s.employeeId}#${s.date}`;
        perDay.set(key, (perDay.get(key) ?? 0) + s.paidMinutes);
      }
      for (const [key, minutes] of perDay) expect(minutes, key).toBeLessThanOrEqual(8 * 60);
      for (const employee of teamOf(store)) {
        const dates = new Set(shifts.filter((s) => s.employeeId === employee.id).map((s) => s.date));
        expect(maxConsecutiveRun(dates), `${employee.name} ${month}`).toBeLessThanOrEqual(6);
      }
    }
  });

  it.each(TEAMS)("%s: erfüllt jeden Monatsvertrag auf die halbe Stunde genau", (_name, store) => {
    for (const month of MONTHS) {
      const shifts = planOf(2026, month, store);
      const team = teamOf(store);
      const result = validateSchedule(team, shifts, 2026, openDatesOf(2026, month), DEFAULT_WORK_HOURS);
      expect(result.errors.filter((e) => e.severity !== "warning"), `Monat ${month}`).toEqual([]);
      for (const summary of result.summaries) {
        // Ohne den zweiten Job ist jeder Vertrag erfüllbar; 40,2 h liegen nicht
        // auf dem 30-Minuten-Raster, deshalb bis 75 Minuten Spielraum.
        expect(Math.abs(summary.diffMinutes), `${summary.employee.name} ${month}`).toBeLessThanOrEqual(75);
      }
    }
  });
});

describe("Shin – Feiertagsdienst", () => {
  it("setzt Bá Việt Nguyen an jedem geöffneten Feiertag ein", () => {
    const store = storeById("shin");
    for (const month of [1, 4, 5, 6, 10, 11, 12]) {
      const shifts = planOf(2026, month, store);
      const open = new Set(openDatesOf(2026, month));
      for (const [date, label] of publicHolidayNames(2026)) {
        if (!open.has(date)) continue;
        expect(shifts.some((s) => s.date === date && s.employeeId === "shin-1"), `${date} ${label}`).toBe(true);
      }
    }
  });

  it("meldet es als Warnung, wenn er an einem Feiertag fehlt", () => {
    const employees = [{ ...makeEmployee("x", "Ba Viet Nguyen", "VOLLZEIT", 20), requiredOnHolidays: true }];
    // 03.10.2026 (Tag der Deutschen Einheit) ist ein Samstag – der Laden hat offen.
    const shifts: Shift[] = [
      {
        id: "s1", employeeId: "x", date: "2026-10-02", startMinutes: 17 * 60, endMinutes: 21 * 60,
        pauseMinutes: 0, paidMinutes: 4 * 60, shiftType: "LATE", generated: false,
      },
    ];
    const result = validateSchedule(employees, shifts, 2026, openDatesOf(2026, 10), DEFAULT_WORK_HOURS);
    const warning = result.errors.find((e) => e.date === "2026-10-03" && e.severity === "warning");
    expect(warning?.message).toContain("ngày lễ");
    expect(result.errors.filter((e) => e.severity !== "warning")).toEqual([]);
  });
});

describe("Besetzung", () => {
  it.each(TEAMS)("%s: hält die Spannen der eigenen Filiale ein", (_name, store) => {
    for (const month of MONTHS) {
      const shifts = planOf(2026, month, store);
      const analysis = analyzeSchedule({
        year: 2026, month, workHours: DEFAULT_WORK_HOURS, employees: teamOf(store), shifts,
        rules: store.staffingRules, weights: store.dayWeights,
      });
      expect(analysis.peakViolations.map((d) => d.date), `Monat ${month}`).toEqual([]);
    }
  });

  it.each(TEAMS)("%s: legt an den starken Tagen der Filiale mehr Stunden", (_name, store) => {
    const shifts = planOf(2026, 9, store);
    const perDay = (busy: boolean) => {
      const days = new Map<string, number>();
      for (const s of shifts) {
        const weekday = weekdayKeyOf(parseIsoDate(s.date));
        if ((store.dayWeights[weekday] > 1) !== busy) continue;
        days.set(s.date, (days.get(s.date) ?? 0) + s.paidMinutes);
      }
      return [...days.values()].reduce((sum, m) => sum + m, 0) / days.size;
    };
    expect(perDay(true) / perDay(false)).toBeGreaterThan(1.2);
  });
});

describe("Drei Filialen", () => {
  it("führt jede Filiale getrennt: eigene Anschrift, eigene Belegschaft, eigene Ids", () => {
    expect(STORES.map((s) => s.id)).toEqual(["shin", "coco", "nieu"]);
    const all = STORES.flatMap((store) => initialScheduleFor(store).employees);
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
    expect(initialScheduleFor(storeById("nieu")).address).toContain("Aalen");
    expect(initialScheduleFor(storeById("nieu")).employees).toHaveLength(6);
  });

  it("Nieu ist erst ab Freitag stark, Shin und Coco schon ab Donnerstag", () => {
    expect(storeById("nieu").dayWeights.thursday).toBe(1);
    expect(storeById("shin").dayWeights.thursday).toBe(1.5);
    // Kleineres Team: die Abendspanne liegt eine Person tiefer.
    const evening = (store: StoreConfig) => store.staffingRules.find((r) => r.label === "Tối")!;
    expect(evening(storeById("nieu")).minStaff).toBe(3);
    expect(evening(storeById("shin")).minStaff).toBe(4);
  });

  it("wer in zwei Läden arbeitet, steht nie am selben Tag in beiden", () => {
    for (const month of [1, 9]) {
      const plans = planAll(2026, month);
      const perPerson = new Map<string, Map<string, Set<string>>>();
      for (const store of STORES) {
        for (const employee of teamOf(store)) {
          if (!employee.personKey) continue;
          const byDate = perPerson.get(employee.personKey) ?? new Map<string, Set<string>>();
          for (const shift of plans.get(store.id)!.filter((s) => s.employeeId === employee.id)) {
            byDate.set(shift.date, (byDate.get(shift.date) ?? new Set()).add(store.id));
          }
          perPerson.set(employee.personKey, byDate);
        }
      }
      expect(perPerson.size).toBeGreaterThan(0);
      for (const [person, byDate] of perPerson) {
        for (const [date, shops] of byDate) {
          expect([...shops], `${person} ${date}`).toHaveLength(1);
        }
        // Auch über beide Läden zusammen gelten 6 Tage am Stück.
        expect(maxConsecutiveRun(new Set(byDate.keys())), person).toBeLessThanOrEqual(6);
      }
    }
  });
});

describe("alter Stand ohne personKey", () => {
  // So lag der Shin-Stand vor Nieu 37 in Supabase: ohne personKey und ohne Tagesgrenze.
  const oldShin = () =>
    teamOf(storeById("shin")).map(({ personKey: _k, maxDaysPerWeek: _d, ...rest }) => rest as Employee);

  it("übernimmt personKey und 5 Tage je Woche aus der Startbelegschaft", () => {
    const migrated = withSharedPersonDefaults(oldShin(), storeById("shin"));
    const baViet = migrated.find((e) => e.id === "shin-1")!;
    expect(baViet.personKey).toBe("ba-viet-nguyen");
    expect(baViet.maxDaysPerWeek).toBe(5);
    expect(migrated.filter((e) => e.personKey)).toHaveLength(1);
  });

  it("lässt eine spätere Änderung stehen", () => {
    const edited = oldShin().map((e) =>
      e.id === "shin-1" ? { ...e, personKey: "ba-viet-nguyen", maxDaysPerWeek: undefined } : e,
    );
    expect(withSharedPersonDefaults(edited, storeById("shin"))[0].maxDaysPerWeek).toBeUndefined();
    // Anderer Mensch unter derselben id: nicht verknüpfen.
    const renamed = oldShin().map((e) => (e.id === "shin-1" ? { ...e, name: "Jemand Neues" } : e));
    expect(withSharedPersonDefaults(renamed, storeById("shin"))[0].personKey).toBeUndefined();
  });
});

describe("Schichtzuschnitt", () => {
  it.each(TEAMS)("%s: jede Uhrzeit liegt auf dem 30-Minuten-Raster", (_name, store) => {
    for (const month of MONTHS) {
      for (const shift of planOf(2026, month, store)) {
        expect(shift.startMinutes % 30, `${shift.date} ${shift.startMinutes}`).toBe(0);
        expect(shift.endMinutes % 30, `${shift.date} ${shift.endMinutes}`).toBe(0);
      }
    }
  });

  it.each(TEAMS)("%s: ein EINZELNER Dienst am Tag ist nie kürzer als 3 h", (_name, store) => {
    for (const month of MONTHS) {
      const shifts = planOf(2026, month, store);
      for (const shift of shifts) {
        const sameDay = shifts.filter((s) => s.employeeId === shift.employeeId && s.date === shift.date);
        if (sameDay.length === 1) {
          expect(shift.paidMinutes, `${shift.date} ${shift.employeeId}`).toBeGreaterThanOrEqual(180);
        } else {
          // Ein geteilter Tag (mittags + abends) darf ein kürzeres Stück haben,
          // mindestens aber 2 h; der Tag selbst bleibt über 3 h.
          expect(shift.paidMinutes, `${shift.date} ${shift.employeeId}`).toBeGreaterThanOrEqual(120);
          const day = sameDay.reduce((sum, s) => sum + s.paidMinutes, 0);
          expect(day, `${shift.date} ${shift.employeeId}`).toBeGreaterThanOrEqual(180);
        }
      }
    }
  });

  it.each(TEAMS)("%s: niemand wird über den Vertrag hinaus verplant", (_name, store) => {
    for (const month of MONTHS) {
      const shifts = planOf(2026, month, store);
      const result = validateSchedule(teamOf(store), shifts, 2026, openDatesOf(2026, month), DEFAULT_WORK_HOURS);
      for (const summary of result.summaries) {
        expect(summary.assignedMinutes, `${summary.employee.name} ${month}`).toBeLessThanOrEqual(summary.targetMinutes);
      }
    }
  });

  it("verschiebt einen Rest unter 3 h aus der Randwoche in die Nachbarwoche", () => {
    // Januar 2026 beginnt mitten in der Woche ab 29.12. – dort landete früher
    // ein 1,5-Stunden-Dienst für die kleinen Verträge.
    const shifts = planOf(2026, 1, storeById("shin"));
    const single = shifts.filter((shift) => {
      const sameDay = shifts.filter((s) => s.employeeId === shift.employeeId && s.date === shift.date);
      return sameDay.length === 1 && shift.paidMinutes < 180;
    });
    expect(single).toEqual([]);
  });
});
