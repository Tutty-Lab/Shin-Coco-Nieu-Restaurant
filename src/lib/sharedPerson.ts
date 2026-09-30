// ============================================================================
// Ein Mensch, mehrere Läden: Mitarbeiter verschiedener Filialen mit demselben
// personKey sind dieselbe Person. „Tạo lịch làm việc" plant sie dann nie am
// selben Tag in zwei Läden (App.tsx, generateAll). Hier steht, wie das Feld
// „Cũng làm ở quán khác" im Tab Nhân viên die Schlüssel setzt und löst.
// ============================================================================

import type { Employee } from "../types";

export type StoreRoster = { storeId: string; employees: readonly Employee[] };

/** Gewählter Partner je anderer Filiale: storeId -> employeeId ("" = keiner). */
export type PartnerChoice = Record<string, string>;

/**
 * "" heißt „bewusst gelöst": so verbindet withSharedPersonDefaults (stores.ts)
 * einen alten Stand beim nächsten Laden nicht wieder.
 */
export type PersonKeyPatch = { storeId: string; employeeId: string; personKey: string };

/** Die Mitarbeiter ANDERER Filialen, die schon dieselbe Person sind. */
export function currentPartners(rosters: readonly StoreRoster[], storeId: string, employee?: Employee): PartnerChoice {
  const choice: PartnerChoice = {};
  if (!employee?.personKey) return choice;
  for (const roster of rosters) {
    if (roster.storeId === storeId) continue;
    const partner = roster.employees.find((e) => e.personKey === employee.personKey);
    if (partner) choice[roster.storeId] = partner.id;
  }
  return choice;
}

/** Lesbarer, noch nicht vergebener Schlüssel aus dem Namen („ba-viet-nguyen"). */
function freshKey(name: string, rosters: readonly StoreRoster[]): string {
  const base =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/gi, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "person";
  const taken = new Set(rosters.flatMap((r) => r.employees.map((e) => e.personKey)).filter(Boolean));
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
  return key;
}

/**
 * Welche personKeys sich ändern, wenn `self` mit genau den gewählten Partnern
 * verbunden sein soll. Wer bisher dazugehörte und nicht mehr gewählt ist, wird
 * gelöst. `self` darf neu sein (steht dann noch in keinem Roster).
 */
export function linkPatches(
  rosters: readonly StoreRoster[],
  self: { storeId: string; employeeId: string; name: string; personKey?: string },
  choice: PartnerChoice,
): PersonKeyPatch[] {
  const chosen = Object.entries(choice)
    .filter(([storeId, employeeId]) => storeId !== self.storeId && employeeId)
    .map(([storeId, employeeId]) => ({
      storeId,
      employee: rosters.find((r) => r.storeId === storeId)?.employees.find((e) => e.id === employeeId),
    }))
    .filter((c): c is { storeId: string; employee: Employee } => c.employee !== undefined);

  const key =
    chosen.length === 0
      ? ""
      : self.personKey || chosen.find((c) => c.employee.personKey)?.employee.personKey || freshKey(self.name, rosters);

  const patches: PersonKeyPatch[] = [];
  if ((self.personKey ?? "") !== key) patches.push({ storeId: self.storeId, employeeId: self.employeeId, personKey: key });
  for (const c of chosen) {
    if (c.employee.personKey !== key) patches.push({ storeId: c.storeId, employeeId: c.employee.id, personKey: key });
  }
  // Bisherige Partner, die nicht mehr gewählt sind, lösen.
  if (self.personKey) {
    for (const roster of rosters) {
      if (roster.storeId === self.storeId) continue;
      for (const e of roster.employees) {
        if (e.personKey !== self.personKey) continue;
        if (chosen.some((c) => c.storeId === roster.storeId && c.employee.id === e.id)) continue;
        patches.push({ storeId: roster.storeId, employeeId: e.id, personKey: "" });
      }
    }
  }
  return patches;
}
