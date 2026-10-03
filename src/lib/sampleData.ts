// ============================================================================
// Beispieldaten beider Filialen. Beide rechnen in MONATSstunden (nicht je Woche).
//
// Shin: 169, 173, 169, 160, 180, 86, 169 und 40,2 Stunden (40,2 h = 603 h auf
// 15 Monate umgelegt). Coco: 173, 173, 173, 156, 130, 152, 39 und 43 Stunden.
// ============================================================================

import type { Employee, Schedule } from "../types";
import { DEFAULT_WORK_HOURS } from "./workHours";

export function makeEmployee(
  id: string,
  name: string,
  employmentType: Employee["employmentType"],
  targetHours: number,
): Employee {
  return { id, name, employmentType, targetMinutes: Math.round(targetHours * 60) };
}

/** Mitarbeiter mit WOCHENvertrag (hier nicht im Einsatz, bleibt für die Oberfläche). */
export function makeWeekly(
  id: string,
  name: string,
  employmentType: Employee["employmentType"],
  weeklyHours: number,
): Employee {
  return { id, name, employmentType, targetMinutes: 0, weeklyHours };
}

/**
 * Shin Restaurant, Hans-Thoma-Str. 2, 76448 Durmersheim.
 *
 * Bá Việt Nguyễn muss an FEIERTAGEN im Dienst sein (ausdrückliche Vorgabe).
 * ANNAHME zur Anstellungsart (der Betrieb nennt nur Stunden): ab 160 h Vollzeit,
 * 86 h Teilzeit, 40,2 h Minijob – das ändert nur die Beschriftung auf dem
 * Stundenzettel, nicht die Planung.
 */
export function shinEmployees(): Employee[] {
  return [
    {
      // Arbeitet zusätzlich im Nieu (Minijob 35 h). Damit dort überhaupt Tage
      // frei bleiben, plant Shin ihn auf höchstens 5 Tage je Woche – sonst
      // belegt der Vollzeitvertrag alle sechs Öffnungstage.
      ...makeEmployee("shin-1", "Ba Viet Nguyen", "VOLLZEIT", 169),
      requiredOnHolidays: true,
      personKey: "ba-viet-nguyen",
      maxDaysPerWeek: 5,
    },
    makeEmployee("shin-2", "Quoc Tu Tran", "VOLLZEIT", 173),
    makeEmployee("shin-3", "Quoc Minh Tran", "VOLLZEIT", 169),
    makeEmployee("shin-4", "Van Dang Tran", "VOLLZEIT", 160),
    makeEmployee("shin-5", "Tuyet Trinh Tran", "VOLLZEIT", 180),
    makeEmployee("shin-6", "Ba Nhat Nguyen", "TEILZEIT", 86),
    makeEmployee("shin-7", "Nhu Manh Cao", "VOLLZEIT", 169),
    makeEmployee("shin-8", "Minh Vuong Vu", "MINIJOB", 40.2),
  ];
}

/**
 * Coco Restaurant, Bernhäuser Hauptstraße 17, 70794 Filderstadt.
 *
 * ANNAHME zur Anstellungsart wie oben: ab 130 h Vollzeit, 152 h Vollzeit,
 * 39/43 h Minijob. „152 tiếng × 18,93" ist der Stundenlohn – er gehört nicht in
 * die Planung und steht deshalb nicht in den Daten.
 */
export function cocoEmployees(): Employee[] {
  return [
    {
      // Arbeitet zusätzlich im Nieu (Minijob 43 h, ab September 2026). Wie bei
      // Bá Việt im Shin: höchstens 5 Tage je Woche, damit dort Tage frei bleiben.
      ...makeEmployee("coco-1", "Nguyen Thu Van", "VOLLZEIT", 173),
      personKey: "nguyen-thu-van",
      maxDaysPerWeek: 5,
    },
    makeEmployee("coco-2", "Nguyen Thi Minh Tam", "VOLLZEIT", 173),
    makeEmployee("coco-3", "Duy Phuong Do", "VOLLZEIT", 173),
    makeEmployee("coco-4", "Dinh Trong Huy", "VOLLZEIT", 156),
    makeEmployee("coco-5", "Ba Anh Nguyen", "VOLLZEIT", 130),
    makeEmployee("coco-6", "Viet Trung Nguyen", "VOLLZEIT", 152),
    makeEmployee("coco-7", "Thi Huong Nguyen", "MINIJOB", 39),
    makeEmployee("coco-8", "Viet An Bui", "MINIJOB", 43),
  ];
}

/**
 * Nieu 37 Restaurant, Radgasse 9, 73430 Aalen.
 *
 * Kleineres Team (6 Personen) und schwächere Umsätze als Shin/Coco: normal
 * 1.000–1.500 €, starke Tage 3.000 €. Stark sind hier FREITAG bis SONNTAG.
 *
 * Bá Việt Nguyễn (Vollzeit im Shin) und Thu Vân Nguyễn (Vollzeit im Coco)
 * arbeiten hier zusätzlich als Minijob – über personKey erkennt der Planer
 * dieselbe Person und legt hier keinen Tag hin, an dem sie schon im anderen
 * Laden stehen.
 */
export function nieuEmployees(): Employee[] {
  return [
    makeEmployee("nieu-1", "Cong Danh Bui", "VOLLZEIT", 151.8),
    makeEmployee("nieu-2", "Ngoc So Nguyen", "VOLLZEIT", 169),
    makeEmployee("nieu-3", "Van Hai Nguyen", "VOLLZEIT", 130),
    makeEmployee("nieu-4", "Ba Nam Nguyen", "VOLLZEIT", 169),
    makeEmployee("nieu-5", "Xuan Linh Trinh", "VOLLZEIT", 169),
    { ...makeEmployee("nieu-6", "Ba Viet Nguyen", "MINIJOB", 35), personKey: "ba-viet-nguyen" },
    // Thu Vân arbeitet Vollzeit im Coco – nie am selben Tag in beiden Läden.
    { ...makeEmployee("nieu-7", "Thu Van Nguyen", "MINIJOB", 43), personKey: "nguyen-thu-van" },
  ];
}

/** Belegschaft der Standard-Filiale – für Tests und Altaufrufe. */
export const SAMPLE_EMPLOYEES: Employee[] = shinEmployees();

export function createSampleSchedule(): Schedule {
  return {
    companyName: "Shin Restaurant",
    address: "Hans-Thoma-Str. 2, 76448 Durmersheim",
    year: 2026,
    month: 8, // August
    workHours: structuredClone(DEFAULT_WORK_HOURS),
    dateOverrides: [],
    employees: shinEmployees(),
    shifts: [],
  };
}
