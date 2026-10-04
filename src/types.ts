// ============================================================================
// Zentrale Datentypen. Intern wird IMMER in Minuten (Integer) gerechnet,
// niemals mit Fließkomma-Stunden.
// ============================================================================

import type { WeekdayKey } from "./lib/demand";
import type { DateOverride, DayWindow, WorkHoursConfig } from "./lib/workHours";

/**
 * Anstellungsart. MINIJOB ist arbeitsrechtlich eine Form der Teilzeit und wird
 * bei der Schichtplanung auch genauso behandelt – die Trennung dient der
 * Belegschaftsstruktur und dem Stundenzettel, nicht der Planung selbst.
 */
export type EmploymentType = "VOLLZEIT" | "TEILZEIT" | "MINIJOB";

export type ShiftType = "EARLY" | "LATE" | "CUSTOM";

export type Employee = {
  id: string;
  name: string;
  employmentType: EmploymentType;
  /**
   * Monatliches Soll in Minuten (Integer). 176 h => 10560.
   *
   * Bei Viet Cuisine wird der Vertrag in WOCHENstunden angegeben (39 h/Woche
   * = Vollzeit). Ist weeklyHours gesetzt, ist DAS die Quelle und targetMinutes
   * wird je Monat daraus berechnet (siehe contract.ts). targetMinutes bleibt
   * trotzdem befüllt, damit ältere gespeicherte Daten einen Wert haben.
   */
  targetMinutes: number;
  /**
   * Vertragliche WOCHENstunden. Gesetzt => targetMinutes wird je Monat daraus
   * abgeleitet: Wochenstunden × (offene Tage des Monats ÷ 6 offene Tage/Woche).
   * Sechs offene Tage, weil der Laden montags zu ist (Di–So).
   */
  weeklyHours?: number;
  /**
   * Feste Schicht: diese Person arbeitet an ihren Arbeitstagen IMMER in genau
   * diesem Zeitfenster (Viet Cuisine: eine Kraft nur 6:30–14:30, Vorbereitung
   * ab vor Ladenöffnung). Gesetzt => der Scheduler legt für sie nur Dienste in
   * diesem Fenster an, unabhängig von den Öffnungsblöcken.
   */
  fixedShift?: DayWindow;
  /**
   * Erster Arbeitstag als ISO-Datum "yyyy-MM-dd" (Eintritt/Vertragsbeginn).
   *
   * Gesetzt => Tage VOR diesem Datum sind gesperrt (kein Dienst) UND zählen
   * nicht ins Monats-Soll. So wird ein Eintritt mitten im Monat korrekt
   * abgebildet: die Person schuldet nur die Stunden ab ihrem Startdatum, statt
   * als „zu wenig geplant" gemeldet zu werden. Fehlt = von Monatsanfang an dabei.
   */
  startDate?: string;
  /**
   * Letzter Arbeitstag (Austritt), ISO "yyyy-MM-dd". Danach wird niemand mehr
   * eingeplant, und die Tage nach dem Austritt zählen nicht ins Monats-Soll –
   * wer am 15. aufhört, bekommt für diesen Monat nur das halbe Soll und keine
   * Warnung „zu wenig geplant". Fehlt = arbeitet weiter (kein Austritt).
   */
  endDate?: string;
  /**
   * Wochentage, an denen diese Person überhaupt eingeplant werden darf.
   * Fehlt/leer = jeder Tag ist möglich (keine Einschränkung).
   */
  availableWeekdays?: WeekdayKey[];
  /**
   * Höchstzahl der Arbeitstage je Woche. Fehlt = nur die gesetzliche
   * Sechs-Tage-Regel begrenzt.
   */
  maxDaysPerWeek?: number;
  /**
   * Muss diese Person an FEIERTAGEN im Dienst sein?
   *
   * Vorgabe des Betriebs: „Những ngày lễ phải có bạn Bá Việt Nguyen trong ca".
   * Gesetzt => der Scheduler plant sie an jedem geöffneten Feiertag ein, und
   * die Prüfung meldet es, wenn sie doch fehlt.
   */
  requiredOnHolidays?: boolean;
  /**
   * Dieselbe PERSON in mehreren Filialen (z. B. Bá Việt Nguyễn: Vollzeit im
   * Shin, Minijob im Nieu). Gleicher Schlüssel = gleicher Mensch; der Planer
   * belegt dann keinen Tag doppelt, denn die Läden liegen weit auseinander.
   */
  personKey?: string;
};

export type Shift = {
  /** Explicit unpaid break, excluded from staffing coverage. */
  pauseStartMinutes?: number;
  id: string;
  employeeId: string;
  /** ISO-Datum "yyyy-MM-dd". */
  date: string;
  startMinutes: number;
  endMinutes: number;
  pauseMinutes: number;
  /** Bezahlte Arbeitszeit in Minuten = presence - pause. */
  paidMinutes: number;
  shiftType: ShiftType;
  /** true = automatisch generiert, false = manuell hinzugefügt/geändert. */
  generated: boolean;
};

export type Schedule = {
  companyName: string;
  /** Anschrift des Betriebs (erscheint auf dem Stundenzettel). */
  address: string;
  year: number;
  /** 1-basiert: 1 = Januar ... 12 = Dezember. */
  month: number;
  /** Arbeitszeit-Fenster (giờ làm) je Wochentag + Feiertag. */
  workHours: WorkHoursConfig;
  /** Ausnahmen für einzelne Daten (geschlossen / abweichende Zeiten). */
  dateOverrides: DateOverride[];
  employees: Employee[];
  shifts: Shift[];
  /**
   * Zeitpunkt der ersten Wochen-Ausgabe (ISO). Gesetzt = der Monat ist
   * gesperrt und darf nicht mehr geändert werden.
   *
   * Hintergrund: sobald eine Woche ausgedruckt im Laden hängt, muss der Stand
   * im System exakt dem Papier entsprechen – bei einer Kontrolle wird genau
   * das verglichen. Entsperren geht nur bewusst über die Oberfläche.
   */
  lockedAt?: string;
  /** Bereits gedruckte Wochen, als ISO-Datum des jeweiligen Montags. */
  printedWeeks?: string[];
  /** Bereits angewandte einmalige Datenänderungen (siehe lib/migrations.ts). */
  migrations?: string[];
  /**
   * Der Betrieb hat die Warnungen „chưa đủ giờ định mức" für DIESEN Plan
   * bewusst hingenommen (Popup nach „Tạo lịch"). Ein neuer Plan setzt es zurück.
   */
  underQuotaAccepted?: boolean;
};
