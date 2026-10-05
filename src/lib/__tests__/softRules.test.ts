// Weiche Regeln je Mitarbeiter, aus der Thienlong-App übernommen:
// „Độ dài ca", „Rải đều trong tháng", „Khung giờ ưu tiên".
import { describe, expect, it } from "vitest";
import type { Employee, Shift } from "../../types";
import { generateSchedule } from "../scheduler";
import { storeById } from "../stores";
import { DEFAULT_WORK_HOURS } from "../workHours";
import { minutesOutsidePreferred, ownShiftRangeMinutes } from "../preferredWindows";
import { parseIsoDate, weekdayKeyOf } from "../demand";

const shin = storeById("shin");

/** Shin-Team, eine Person angepasst; plant September 2026. */
function planWith(id: string, patch: Partial<Employee>): { shifts: Shift[]; employee: Employee } {
  const employees = shin.sampleEmployees().map((e) => (e.id === id ? { ...e, ...patch } : e));
  const shifts = generateSchedule({
    year: 2026, month: 9, workHours: DEFAULT_WORK_HOURS, employees,
    rules: shin.staffingRules, weights: shin.dayWeights, storeTag: "shin",
  });
  return { shifts: shifts.filter((s) => s.employeeId === id), employee: employees.find((e) => e.id === id)! };
}

const paidByDay = (shifts: Shift[]) => {
  const map = new Map<string, number>();
  for (const s of shifts) map.set(s.date, (map.get(s.date) ?? 0) + s.paidMinutes);
  return map;
};
const total = (shifts: Shift[]) => shifts.reduce((sum, s) => sum + s.paidMinutes, 0);

describe("Độ dài ca", () => {
  it("rundet auf das Raster und die Grenzen 3–8 h", () => {
    expect(ownShiftRangeMinutes({ ...shin.sampleEmployees()[0], shiftHours: { min: 2, max: 3.2 } })).toEqual({ min: 180, max: 180 });
    expect(ownShiftRangeMinutes({ ...shin.sampleEmployees()[0], shiftHours: { min: 5, max: 10 } })).toEqual({ min: 300, max: 480 });
    expect(ownShiftRangeMinutes(shin.sampleEmployees()[0])).toBeNull();
  });

  it("Teilzeit 86 h mit 4–5 h: fast jeder Arbeitstag liegt darin, Soll bleibt erreicht", () => {
    const { shifts, employee } = planWith("shin-6", { shiftHours: { min: 4, max: 5 } });
    const outside = [...paidByDay(shifts)].filter(([, paid]) => paid < 240 || paid > 300);
    // Weich: nur die Randwoche (29./30.09., zwei offene Tage) fasst den Rest nicht in 4–5 h.
    expect(outside.every(([date]) => date >= "2026-09-28"), JSON.stringify(outside)).toBe(true);
    expect(total(shifts)).toBe(employee.targetMinutes);
  });

  it("ist weich: Vollzeit 169 h mit nur 3 h je Tag bekommt trotzdem das volle Soll", () => {
    const { shifts, employee } = planWith("shin-2", { shiftHours: { min: 3, max: 3 } });
    expect(total(shifts)).toBe(employee.targetMinutes);
  });
});

describe("Rải đều trong tháng", () => {
  it("mit Độ dài ca: mehr, dafür kürzere Arbeitstage", () => {
    const normal = planWith("shin-6", { shiftHours: { min: 3, max: 6 } });
    const spread = planWith("shin-6", { shiftHours: { min: 3, max: 6 }, spreadEvenly: true });
    expect(paidByDay(spread.shifts).size).toBeGreaterThan(paidByDay(normal.shifts).size);
    expect(total(spread.shifts)).toBe(total(normal.shifts));
  });
});

describe("Khung giờ ưu tiên", () => {
  const outsideOf = (windows: Employee["preferredWindows"] & object, shifts: Shift[]) =>
    shifts.reduce((sum, s) => sum + minutesOutsidePreferred(windows, weekdayKeyOf(parseIsoDate(s.date)), s), 0);

  it("Teilzeit nur abends Di–So: alle Dienste liegen im Fenster, Stunden bleiben gleich", () => {
    const windows: Employee["preferredWindows"] & object = [
      { days: ["tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"], startMinutes: 17 * 60, endMinutes: 22 * 60 },
    ];
    const before = planWith("shin-6", {});
    const after = planWith("shin-6", { preferredWindows: windows });
    expect(outsideOf(windows, before.shifts)).toBeGreaterThan(0);
    expect(outsideOf(windows, after.shifts)).toBe(0);
    expect(total(after.shifts)).toBe(total(before.shifts));
  });

  it("das Soll geht vor: passt es nicht ins Fenster, wird trotzdem voll geplant", () => {
    // Do–So abends fasst ~18 h je Woche, das Teilzeit-Soll braucht mehr.
    const windows: Employee["preferredWindows"] & object = [
      { days: ["thursday", "friday", "saturday", "sunday"], startMinutes: 17 * 60, endMinutes: 22 * 60 },
    ];
    const { shifts, employee } = planWith("shin-6", { preferredWindows: windows });
    expect(total(shifts)).toBe(employee.targetMinutes);
  });

  it("weicht den Besetzungsregeln: Di–Fr mittags ist Di/Mi schon voll, es wird aber besser", () => {
    const windows: Employee["preferredWindows"] & object = [
      { days: ["tuesday", "wednesday", "thursday", "friday"], startMinutes: 11 * 60 + 30, endMinutes: 15 * 60 },
    ];
    const before = planWith("shin-8", {});
    const after = planWith("shin-8", { preferredWindows: windows });
    expect(outsideOf(windows, after.shifts)).toBeLessThan(outsideOf(windows, before.shifts));
    expect(total(after.shifts)).toBe(total(before.shifts));
  });
});
