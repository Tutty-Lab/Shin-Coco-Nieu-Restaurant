import { describe, expect, it } from "vitest";
import type { Employee } from "../../types";
import { makeEmployee } from "../sampleData";
import { currentPartners, linkPatches, type StoreRoster } from "../sharedPerson";

const emp = (id: string, name: string, personKey?: string): Employee => ({
  ...makeEmployee(id, name, "VOLLZEIT", 160),
  personKey,
});

const rosters = (): StoreRoster[] => [
  { storeId: "shin", employees: [emp("shin-1", "Ba Viet Nguyen"), emp("shin-2", "Quoc Tu Tran")] },
  { storeId: "coco", employees: [emp("coco-1", "Nguyen Thu Van")] },
  { storeId: "nieu", employees: [emp("nieu-6", "Ba Viet Nguyen")] },
];

describe("Cũng làm ở quán khác", () => {
  it("verbindet zwei Mitarbeiter mit einem neuen, lesbaren Schlüssel", () => {
    const patches = linkPatches(rosters(), { storeId: "shin", employeeId: "shin-1", name: "Bá Việt Nguyễn" }, { nieu: "nieu-6" });
    expect(patches).toEqual([
      { storeId: "shin", employeeId: "shin-1", personKey: "ba-viet-nguyen" },
      { storeId: "nieu", employeeId: "nieu-6", personKey: "ba-viet-nguyen" },
    ]);
  });

  it("übernimmt den Schlüssel, den der Partner schon hat", () => {
    const r = rosters();
    r[2].employees = [emp("nieu-6", "Ba Viet Nguyen", "bv")];
    expect(linkPatches(r, { storeId: "shin", employeeId: "shin-1", name: "Ba Viet Nguyen" }, { nieu: "nieu-6" })).toEqual([
      { storeId: "shin", employeeId: "shin-1", personKey: "bv" },
    ]);
  });

  it("löst die Verbindung auf beiden Seiten, wenn „không“ gewählt wird", () => {
    const r = rosters();
    r[0].employees = [emp("shin-1", "Ba Viet Nguyen", "bv")];
    r[2].employees = [emp("nieu-6", "Ba Viet Nguyen", "bv")];
    expect(currentPartners(r, "shin", r[0].employees[0])).toEqual({ nieu: "nieu-6" });
    expect(linkPatches(r, { storeId: "shin", employeeId: "shin-1", name: "Ba Viet Nguyen", personKey: "bv" }, { nieu: "" })).toEqual([
      { storeId: "shin", employeeId: "shin-1", personKey: "" },
      { storeId: "nieu", employeeId: "nieu-6", personKey: "" },
    ]);
  });

  it("wechselt den Partner: der alte wird gelöst", () => {
    const r = rosters();
    r[0].employees = [emp("shin-1", "Ba Viet Nguyen", "bv")];
    r[2].employees = [emp("nieu-6", "Ba Viet Nguyen", "bv"), emp("nieu-7", "Jemand")];
    expect(linkPatches(r, { storeId: "shin", employeeId: "shin-1", name: "Ba Viet Nguyen", personKey: "bv" }, { nieu: "nieu-7" })).toEqual([
      { storeId: "nieu", employeeId: "nieu-7", personKey: "bv" },
      { storeId: "nieu", employeeId: "nieu-6", personKey: "" },
    ]);
  });

  it("ein neuer Mitarbeiter ohne Partner bekommt keinen Eintrag", () => {
    expect(linkPatches(rosters(), { storeId: "shin", employeeId: "shin-9", name: "Neu" }, {})).toEqual([]);
  });

  it("nach dem Lösen wieder verbinden", () => {
    const r = rosters();
    r[0].employees = [emp("shin-1", "Ba Viet Nguyen", "")];
    r[2].employees = [emp("nieu-6", "Ba Viet Nguyen", "")];
    const patches = linkPatches(r, { storeId: "shin", employeeId: "shin-1", name: "Ba Viet Nguyen", personKey: "" }, { nieu: "nieu-6" });
    expect(patches.map((p) => p.personKey)).toEqual(["ba-viet-nguyen", "ba-viet-nguyen"]);
  });

  it("vergibt keinen Schlüssel doppelt", () => {
    const r = rosters();
    r[1].employees = [emp("coco-1", "Nguyen Thu Van", "ba-viet-nguyen")];
    const patches = linkPatches(r, { storeId: "shin", employeeId: "shin-1", name: "Ba Viet Nguyen" }, { nieu: "nieu-6" });
    expect(patches[0].personKey).toBe("ba-viet-nguyen-2");
  });
});
