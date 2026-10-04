import { describe, expect, it } from "vitest";
import type { Schedule, Shift } from "../../types";
import { initialScheduleFor, storeById } from "../stores";
import { MAX_SAVED_PLANS, planMonthOf, restoreSavedPlan, withSavedPlan, withoutSavedPlan } from "../savedPlans";

const shift = (date: string, emp = "e1", start = 600): Shift => ({
  id: `${emp}-${date}-${start}`, employeeId: emp, date, startMinutes: start, endMinutes: start + 300,
  pauseMinutes: 0, paidMinutes: 300, shiftType: "EARLY", generated: true,
});
const base = (): Schedule => ({ ...initialScheduleFor(storeById("shin")), year: 2026, month: 10, shifts: [] });

describe("Bản đã lưu", () => {
  it("nimmt den Monat aus den Diensten, nicht aus der Kopfzeile", () => {
    // Kopfzeile schon auf Oktober, Plan noch September.
    const s = { ...base(), shifts: [shift("2026-09-02"), shift("2026-09-01")] };
    expect(planMonthOf(s.shifts)).toEqual({ year: 2026, month: 9 });
    expect(withSavedPlan(s, "auto").savedPlans?.[0]).toMatchObject({ year: 2026, month: 9, kind: "auto" });
  });

  it("legt nichts an ohne Plan und nichts doppelt", () => {
    expect(withSavedPlan(base(), "auto").savedPlans ?? []).toEqual([]);
    const s = withSavedPlan({ ...base(), shifts: [shift("2026-10-01")] }, "auto");
    expect(withSavedPlan(s, "auto").savedPlans).toHaveLength(1);
    // Manuell speichern macht die vorhandene Kopie nur „đã lưu".
    expect(withSavedPlan(s, "manual").savedPlans?.map((p) => p.kind)).toEqual(["manual"]);
  });

  it("hält höchstens MAX Stände, jüngster zuerst", () => {
    let s = base();
    for (let i = 1; i <= MAX_SAVED_PLANS + 3; i++) {
      s = withSavedPlan({ ...s, shifts: [shift("2026-10-01", "e1", 600 + i)] }, "auto", new Date(2026, 9, 1, 8, i));
    }
    expect(s.savedPlans).toHaveLength(MAX_SAVED_PLANS);
    expect(s.savedPlans?.[0].shifts[0].startMinutes).toBe(600 + MAX_SAVED_PLANS + 3);
  });

  it("Khôi phục sichert erst den aktuellen Plan und holt dann den alten zurück", () => {
    const alt = withSavedPlan({ ...base(), shifts: [shift("2026-10-01", "alt")] }, "manual");
    const neu = { ...alt, shifts: [shift("2026-10-02", "neu")], lockedAt: "x" };
    const id = alt.savedPlans![0].id;
    const r = restoreSavedPlan(neu, id);
    expect(r.shifts.map((s) => s.employeeId)).toEqual(["alt"]);
    expect(r.lockedAt).toBeUndefined();
    expect(r.savedPlans?.[0].shifts.map((s) => s.employeeId)).toEqual(["neu"]);
    expect(withoutSavedPlan(r, id).savedPlans?.some((p) => p.id === id)).toBe(false);
  });
});
