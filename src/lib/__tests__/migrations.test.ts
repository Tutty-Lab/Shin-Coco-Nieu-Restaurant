// ============================================================================
// Thu Vân Nguyễn kommt in den GESPEICHERTEN Stand – nicht nur in die
// Startbelegschaft. Der Betrieb hat seine Daten längst in Supabase; ohne diese
// Nachträge sähe er die neue Minijobberin im Nieu nie.
// ============================================================================

import { describe, expect, it } from "vitest";
import type { Schedule } from "../../types";
import { applyMigrations, MIGRATION_THU_VAN_NIEU } from "../migrations";
import { makeEmployee } from "../sampleData";
import { DEFAULT_WORK_HOURS } from "../workHours";

const stand = (employees: Schedule["employees"], migrations?: string[]): Schedule => ({
  companyName: "x",
  address: "y",
  year: 2026,
  month: 9,
  workHours: structuredClone(DEFAULT_WORK_HOURS),
  dateOverrides: [],
  employees,
  shifts: [],
  migrations,
});

describe("Thu Vân: Coco + Nieu", () => {
  it("verknüpft die vorhandene Person im Coco und begrenzt sie auf 5 Tage je Woche", () => {
    const out = applyMigrations("coco", stand([
      makeEmployee("coco-1", "Nguyen Thu Van", "VOLLZEIT", 173),
      makeEmployee("coco-2", "Nguyen Thi Minh Tam", "VOLLZEIT", 173),
    ]));
    expect(out.employees[0]).toMatchObject({ personKey: "nguyen-thu-van", maxDaysPerWeek: 5, targetMinutes: 173 * 60 });
    expect(out.employees[1].personKey).toBeUndefined();
    expect(out.migrations).toContain(MIGRATION_THU_VAN_NIEU);
  });

  it("lässt eine schon gesetzte Tagesgrenze im Coco stehen", () => {
    const out = applyMigrations("coco", stand([
      { ...makeEmployee("coco-1", "Nguyễn Thu Vân", "VOLLZEIT", 173), maxDaysPerWeek: 4 },
    ]));
    expect(out.employees[0]).toMatchObject({ personKey: "nguyen-thu-van", maxDaysPerWeek: 4 });
  });

  it("legt sie im Nieu als Minijob 43 h an – genau einmal", () => {
    const nieu = [makeEmployee("nieu-1", "Cong Danh Bui", "VOLLZEIT", 151.8)];
    const once = applyMigrations("nieu", stand(nieu));
    const thuVan = once.employees.filter((e) => e.personKey === "nguyen-thu-van");
    expect(thuVan).toHaveLength(1);
    expect(thuVan[0]).toMatchObject({ name: "Thu Van Nguyen", employmentType: "MINIJOB", targetMinutes: 43 * 60 });
    expect(applyMigrations("nieu", once)).toBe(once); // schon erledigt: nichts mehr ändern
  });

  it("legt sie NICHT erneut an, wenn der Betrieb sie nach dem Nachtrag gelöscht hat", () => {
    const out = applyMigrations("nieu", stand([], [MIGRATION_THU_VAN_NIEU]));
    expect(out.employees).toHaveLength(0);
  });

  it("verdoppelt sie nicht, wenn sie im Nieu schon von Hand angelegt wurde", () => {
    const out = applyMigrations("nieu", stand([makeEmployee("emp-1", "Thu Van Nguyen", "MINIJOB", 40)]));
    expect(out.employees).toHaveLength(1);
    expect(out.employees[0]).toMatchObject({ id: "emp-1", personKey: "nguyen-thu-van", targetMinutes: 40 * 60 });
  });

  it("weicht auf eine andere Id aus, wenn nieu-7 schon vergeben ist", () => {
    const out = applyMigrations("nieu", stand([makeEmployee("nieu-7", "Jemand Anders", "MINIJOB", 10)]));
    expect(out.employees.map((e) => e.id)).toEqual(["nieu-7", "nieu-thu-van"]);
  });

  it("ändert im Shin nichts an der Belegschaft", () => {
    const shin = [makeEmployee("shin-2", "Quoc Tu Tran", "VOLLZEIT", 173)];
    expect(applyMigrations("shin", stand(shin)).employees).toEqual(shin);
  });
});
