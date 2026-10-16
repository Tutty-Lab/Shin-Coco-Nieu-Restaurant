// ============================================================================
// Einmalige Datenänderungen am GESPEICHERTEN Stand (LocalStorage und Supabase).
//
// Die Startbelegschaft in sampleData.ts greift nur beim allerersten Öffnen.
// Kommt später jemand dazu, muss das hier nachgetragen werden – sonst sieht der
// Betrieb die Person nie. Jede Änderung läuft genau EINMAL je Filiale (Merker in
// schedule.migrations); löscht der Betrieb die Person danach wieder, wird sie
// nicht erneut angelegt.
// ============================================================================

import type { Employee, Schedule } from "../types";
import { makeEmployee } from "./sampleData";

/** Thu Vân Nguyễn: Vollzeit im Coco, ab September 2026 zusätzlich Minijob 43 h im Nieu. */
export const MIGRATION_THU_VAN_NIEU = "2026-10-thu-van-nieu";
const THU_VAN_KEY = "nguyen-thu-van";

/** Name ohne Akzente, Reihenfolge egal: „Nguyễn Thu Vân" = „Thu Van Nguyen". */
function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

const isThuVan = (employee: Employee) =>
  employee.personKey === THU_VAN_KEY || nameKey(employee.name) === nameKey("Nguyen Thu Van");

function thuVanNieu(storeId: string, employees: Employee[]): Employee[] {
  if (storeId === "coco") {
    // Vorhandene Person im Coco verknüpfen und auf 5 Tage je Woche begrenzen,
    // damit im Nieu Tage frei bleiben (wie Bá Việt im Shin).
    return employees.map((employee) =>
      isThuVan(employee)
        ? { ...employee, personKey: THU_VAN_KEY, maxDaysPerWeek: employee.maxDaysPerWeek ?? 5 }
        : employee,
    );
  }
  if (storeId === "nieu") {
    if (employees.some(isThuVan)) {
      return employees.map((employee) => (isThuVan(employee) ? { ...employee, personKey: THU_VAN_KEY } : employee));
    }
    const id = employees.some((employee) => employee.id === "nieu-7") ? "nieu-thu-van" : "nieu-7";
    return [...employees, { ...makeEmployee(id, "Thu Van Nguyen", "MINIJOB", 43), personKey: THU_VAN_KEY }];
  }
  return employees;
}

/** Wendet alle noch offenen Änderungen auf den Stand einer Filiale an. */
export function applyMigrations(storeId: string, schedule: Schedule): Schedule {
  const done = schedule.migrations ?? [];
  if (done.includes(MIGRATION_THU_VAN_NIEU)) return schedule;
  return {
    ...schedule,
    employees: thuVanNieu(storeId, schedule.employees),
    migrations: [...done, MIGRATION_THU_VAN_NIEU],
  };
}
