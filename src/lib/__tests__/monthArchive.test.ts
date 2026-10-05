import { describe, expect, it } from "vitest";
import type { Schedule, Shift } from "../../types";
import { initialScheduleFor, storeById } from "../stores";
import { archiveFromLegacySavedPlans, listSavedMonths, mergeArchives, monthKey, switchMonth } from "../monthArchive";

const shift = (date: string, emp = "e1"): Shift => ({
  id: `${emp}-${date}`, employeeId: emp, date, startMinutes: 600, endMinutes: 900,
  pauseMinutes: 0, paidMinutes: 300, shiftType: "EARLY", generated: true,
});
const sep = (): Schedule => ({
  ...initialScheduleFor(storeById("shin")), year: 2026, month: 9,
  shifts: [shift("2026-09-01"), shift("2026-09-02")], lockedAt: "2026-09-30T10:00:00Z", printedWeeks: ["2026-08-31"],
});

describe("Lịch đã lưu (Monatsarchiv)", () => {
  it("legt den offenen Monat beim Wechsel ab und holt ihn samt Sperre zurück", () => {
    const toOct = switchMonth(sep(), [], 2026, 10, "2026-10-01T08:00:00Z");
    expect(toOct.schedule.shifts).toEqual([]);
    expect(toOct.schedule.lockedAt).toBeUndefined();
    expect(Object.keys(toOct.schedule.archive ?? {})).toEqual(["2026-09"]);
    const oct = { ...toOct.schedule, shifts: [shift("2026-10-05")] };
    const back = switchMonth(oct, [], 2026, 9);
    expect(back.schedule.shifts.map((s) => s.date)).toEqual(["2026-09-01", "2026-09-02"]);
    expect(back.schedule.lockedAt).toBe("2026-09-30T10:00:00Z");
    expect(back.schedule.printedWeeks).toEqual(["2026-08-31"]);
    expect(Object.keys(back.schedule.archive ?? {})).toEqual(["2026-10"]);
  });

  it("legt einen alten Stand unter dem Monat seiner Dienste ab, nicht unter dem Kopfmonat", () => {
    // Vorversion: Kopf schon Oktober, Dienste noch September.
    const stale = { ...sep(), month: 10 };
    const r = switchMonth(stale, [], 2026, 11);
    expect(Object.keys(r.schedule.archive ?? {})).toEqual(["2026-09"]);
  });

  it("listet Archiv und offenen Monat chronologisch", () => {
    const s = switchMonth(sep(), [], 2026, 10).schedule;
    const list = listSavedMonths({ ...s, shifts: [shift("2026-10-05")] });
    expect(list.map((m) => [m.key, m.current])).toEqual([["2026-09", false], ["2026-10", true]]);
    expect(list[0]).toMatchObject({ shiftCount: 2, totalMinutes: 600 });
  });

  it("verliert beim Zusammenführen keinen Monat eines anderen Tabs/Geräts", () => {
    const mine = { ...sep(), year: 2026, month: 10, shifts: [shift("2026-10-05")], archive: {} };
    const other = sep(); // offener September auf dem anderen Gerät
    const merged = mergeArchives(mine, other);
    expect(Object.keys(merged.archive ?? {})).toEqual([monthKey(2026, 9)]);
    expect(mergeArchives(merged, other)).toBe(merged); // nichts Neues -> gleiche Referenz
  });

  it("übernimmt Ban da luu der Vorversion ins Archiv", () => {
    const legacy = {
      ...sep(), year: 2026, month: 10, shifts: [],
      savedPlans: [
        { year: 2026, month: 9, savedAt: "2026-10-04T10:00:00Z", shifts: [shift("2026-09-03")] },
        { year: 2026, month: 9, savedAt: "2026-10-03T10:00:00Z", shifts: [shift("2026-09-01")] },
      ],
    };
    const r = archiveFromLegacySavedPlans(legacy);
    expect(r.archive?.["2026-09"].shifts.map((s) => s.date)).toEqual(["2026-09-03"]);
    expect("savedPlans" in r).toBe(false);
  });
});
