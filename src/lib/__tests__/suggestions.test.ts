import { describe, expect, it } from "vitest";
import { STORES, initialScheduleFor } from "../stores";
import { better, findFixes, planAll, scoreOf, type TrialStore } from "../suggestions";
import { RULES } from "../rules";

const trialStores = (): TrialStore[] =>
  STORES.map((store) => ({
    storeId: store.id,
    shortName: store.shortName,
    schedule: initialScheduleFor(store),
    rules: store.staffingRules,
    weights: store.dayWeights,
  }));

describe("Luật cứng / luật mềm", () => {
  it("jede Regel ist genau einer Art zugeordnet", () => {
    expect(RULES.filter((r) => r.kind === "hard").length).toBeGreaterThan(0);
    expect(RULES.filter((r) => r.kind === "soft").length).toBeGreaterThan(0);
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
  });

  it("der Planer bricht keine harte Regel (Startbelegschaft, September)", () => {
    const stores = trialStores();
    expect(scoreOf(stores, planAll(stores)).hard).toBe(0);
  });
});

describe("Tìm cách xếp khác", () => {
  it("Teilzeit nur Di+Mi: 86 h passen nicht – Vorschlag: einen Ruhetag freigeben, danach voll geplant", async () => {
    const stores = trialStores();
    stores[0].schedule = {
      ...stores[0].schedule,
      employees: stores[0].schedule.employees.map((e) =>
        e.id === "shin-6" ? { ...e, availableWeekdays: ["tuesday", "wednesday"] } : e,
      ),
    };
    const result = await findFixes(stores);
    expect(result.baseline.missingMinutes).toBeGreaterThan(0);
    expect(result.options.length).toBeGreaterThan(0);
    for (const option of result.options) expect(better(option.score, result.baseline)).toBe(true);
    const top = result.options[0];
    expect(top.changes[0].label).toMatch(/^Ba Nhat Nguyen \(Shin\): bỏ ngày nghỉ cố định/);
    expect(top.score.missingMinutes).toBeLessThan(result.baseline.missingMinutes);
  }, 120_000);

  it("schlägt nichts vor, was nur verschiebt: Ba Viet einen Tag weniger im Shin fehlt dort mehr", async () => {
    // Startbelegschaft, Nieu montags zu: Ba Viet und Thu Van fehlen dort Stunden.
    const result = await findFixes(trialStores());
    expect(result.baseline.missingMinutes).toBeGreaterThan(0);
    for (const option of result.options) expect(better(option.score, result.baseline)).toBe(true);
    expect(result.options.some((o) => o.changes.some((c) => c.label.startsWith("Ba Viet Nguyen (Shin)")))).toBe(false);
  }, 120_000);
});
