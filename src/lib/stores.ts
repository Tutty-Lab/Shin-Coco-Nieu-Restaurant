// ============================================================================
// Die zwei Filialen dieses Betriebs. Umschalten passiert im Tab „Cài đặt" und
// in der Kopfzeile; jede Filiale hat ihre eigene Zeile in der gemeinsamen
// Supabase-Tabelle (Schlüssel = id) und ihren eigenen LocalStorage-Schlüssel.
//
// Beide Läden haben dieselben Öffnungszeiten, dieselben Besetzungsregeln und
// liegen in Baden-Württemberg (gleiche Feiertage) – unterschiedlich sind Name,
// Anschrift und Belegschaft.
// ============================================================================

import type { Employee, Schedule } from "../types";
import { cocoEmployees, nieuEmployees, shinEmployees } from "./sampleData";
import { DAY_WEIGHTS, type WeekdayKey } from "./demand";
import { STAFFING_RULES, clip, type StaffingRule } from "./staffing";
import { DEFAULT_WORK_HOURS } from "./workHours";

/** Starke Tage bei Nieu: erst ab FREITAG (Shin/Coco schon ab Donnerstag). */
const NIEU_DAY_WEIGHTS: Record<WeekdayKey, number> = {
  monday: 1.0, // Ruhetag
  tuesday: 1.0,
  wednesday: 1.0,
  thursday: 1.0,
  friday: 1.5,
  saturday: 1.5,
  sunday: 1.5,
};

/**
 * Nieu hat sechs Leute und kleinere Umsätze (1.000–1.500 € normal, 3.000 € an
 * starken Tagen) – die Spannen liegen deshalb eine Person unter Shin/Coco.
 * Die harten Regeln bleiben: bis 15:00 und bis 22:00 ist immer jemand da.
 */
const NIEU_STAFFING_RULES: readonly StaffingRule[] = [
  {
    label: "Trong giờ mở cửa", when: "suốt mỗi khung mở", minStaff: 1, maxStaff: Infinity, scaled: false,
    windows: (blocks) => blocks.map((block) => ({ startMinutes: block.startMinutes, endMinutes: block.endMinutes })),
  },
  {
    label: "Chốt ca trưa", when: "14:30–15:00", minStaff: 1, maxStaff: Infinity, scaled: false,
    windows: clip(14 * 60 + 30, 15 * 60),
  },
  { label: "Trưa", when: "12:00–14:00", minStaff: 2, maxStaff: 6, scaled: false, windows: clip(12 * 60, 14 * 60) },
  { label: "Tối", when: "18:00–21:00", minStaff: 3, maxStaff: 6, scaled: false, windows: clip(18 * 60, 21 * 60) },
  {
    label: "Đóng cửa", when: "21:30–22:00", minStaff: 1, maxStaff: Infinity, scaled: false,
    windows: clip(21 * 60 + 30, 22 * 60),
  },
];

export type StoreConfig = {
  /** Schlüssel der Zeile in store_data – nach dem Anlegen NICHT mehr ändern. */
  id: string;
  name: string;
  /** Kurzname für den Umschalter in der Kopfzeile. */
  shortName: string;
  address: string;
  /** Belegschaft beim allerersten Öffnen. */
  sampleEmployees: () => Employee[];
  /** Welche Wochentage stark sind (Umsatz) – steuert die Stundenverteilung. */
  dayWeights: Record<WeekdayKey, number>;
  /** Wie viele Leute wann im Haus sein sollen. */
  staffingRules: readonly StaffingRule[];
};

export const STORES: StoreConfig[] = [
  {
    id: "shin",
    name: "Shin Restaurant",
    shortName: "Shin",
    address: "Hans-Thoma-Str. 2, 76448 Durmersheim",
    sampleEmployees: shinEmployees,
    dayWeights: DAY_WEIGHTS,
    staffingRules: STAFFING_RULES,
  },
  {
    id: "coco",
    name: "Coco Restaurant",
    shortName: "Coco",
    address: "Bernhäuser Hauptstraße 17, 70794 Filderstadt",
    sampleEmployees: cocoEmployees,
    dayWeights: DAY_WEIGHTS,
    staffingRules: STAFFING_RULES,
  },
  {
    id: "nieu",
    name: "Nieu 37 Restaurant",
    shortName: "Nieu 37",
    address: "Radgasse 9, 73430 Aalen",
    sampleEmployees: nieuEmployees,
    dayWeights: NIEU_DAY_WEIGHTS,
    staffingRules: NIEU_STAFFING_RULES,
  },
];

export const DEFAULT_STORE_ID = STORES[0].id;

/** Merkt sich die zuletzt gewählte Filiale auf diesem Gerät. */
const STORE_KEY = "stundenzettel-app:store";

export function loadStoreId(): string {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved && STORES.some((s) => s.id === saved)) return saved;
  } catch {
    /* ignorieren */
  }
  return DEFAULT_STORE_ID;
}

export function saveStoreId(id: string): void {
  try {
    localStorage.setItem(STORE_KEY, id);
  } catch {
    /* ignorieren */
  }
}

export function storeById(id: string): StoreConfig {
  return STORES.find((s) => s.id === id) ?? STORES[0];
}

/**
 * Ältere Stände (gespeichert, bevor Nieu 37 dazukam) kennen noch keinen
 * personKey. Dann erkennt „Tạo lịch làm việc" nicht, dass Bá Việt Nguyen im
 * Shin und im Nieu derselbe Mensch ist, und plant ihn am selben Tag in beiden
 * Läden. Fehlt der personKey, übernimmt ein Mitarbeiter mit derselben id und
 * demselben Namen wie in der Startbelegschaft personKey und – nur in diesem
 * einen Schritt – auch maxDaysPerWeek. Danach steht der personKey im Stand, und
 * ein später geleertes „tối đa … ngày/tuần" bleibt leer.
 */
export function withSharedPersonDefaults(employees: Employee[], store: StoreConfig): Employee[] {
  const starters = new Map(store.sampleEmployees().map((e) => [e.id, e]));
  return employees.map((employee) => {
    const starter = starters.get(employee.id);
    if (employee.personKey || !starter?.personKey || starter.name !== employee.name) return employee;
    return {
      ...employee,
      personKey: starter.personKey,
      maxDaysPerWeek: employee.maxDaysPerWeek ?? starter.maxDaysPerWeek,
    };
  });
}

/** Startstand einer Filiale: September 2026 mit der Belegschaft aus der Angabe. */
export function initialScheduleFor(store: StoreConfig): Schedule {
  return {
    companyName: store.name,
    address: store.address,
    year: 2026,
    month: 9,
    workHours: structuredClone(DEFAULT_WORK_HOURS),
    dateOverrides: [],
    employees: store.sampleEmployees(),
    shifts: [],
  };
}
