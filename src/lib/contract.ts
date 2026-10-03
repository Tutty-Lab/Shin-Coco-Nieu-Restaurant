// ============================================================================
// Wochenvertrag -> Monats-Soll und Wochenbudgets.
//
// Viet Cuisine gibt Verträge in WOCHENstunden an (39 h/Woche = Vollzeit). Der
// Scheduler plant aber einen Monat. Diese Umrechnung steht hier an EINER Stelle,
// damit Scheduler, Prüfung und Anzeige dieselbe Zahl verwenden.
//
// Eine ISO-Woche, die über zwei Monate läuft, wird nach demselben Faktor geteilt
// wie die Tagesziele (Tab „Tài liệu"): Tagesgewicht × Öffnungsdauer. Di+Mi am
// Monatsende tragen 1.200 von 4.635 Faktor-Minuten (≈ 26 %, 39 h → 10 h), ein
// einzelner Sonntag am Monatsanfang 1.035 (≈ 22 %) – genau so viel, wie der
// Sonntag in einer vollen Woche bekommt. Beide Monatsteile ergeben zusammen den
// Wochenvertrag.
//
// Ein Wochenteil trägt aber nie mehr, als an seinen Tagen überhaupt geht:
// höchstens 9 h je offenem Tag. Sonst bekäme ein einzelner Sonntag in einem Monat
// mit geschlossenen Dienstagen 10 h – nicht planbar, und das Monats-Soll wäre
// eine Zahl, die kein Plan erreichen kann.
// ============================================================================

import type { Employee } from "../types";
import { DAY_WEIGHTS, parseIsoDate, weekdayKeyOf, type WeekdayKey } from "./demand";
import { weekStartOf } from "./weeks";
import { isEmployedOn } from "./availability";
import { DEFAULT_WORK_HOURS, type WorkHoursConfig } from "./workHours";

/** ISO "yyyy-MM-dd" + n Tage (UTC, ohne Zeitzonen-Verschiebung). */
function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Offene Tage je Woche: Di–So, der Montag ist zu. */
export const OPEN_DAYS_PER_WEEK = 6;
export const SCHEDULE_SLOT_MINUTES = 30;
/** Höchste bezahlte Zeit je Tag (§ 3 ArbZG, siehe validation.ts). */
export const MAX_PAID_MINUTES_PER_DAY = 8 * 60;

/** Extra opening days in a calendar week do not increase a weekly contract. */
export function contractOpenDays(openDaysByWeek: readonly number[]): number {
  return openDaysByWeek.reduce((sum, openDays) => sum + Math.min(openDays, OPEN_DAYS_PER_WEEK), 0);
}

/**
 * Monats-Soll in Minuten über eine Anzahl offener Tage (Tagesanteil 1/6 je Tag).
 * Nur noch für Personen ohne Datumsliste (Altpfad, einzelne Tests); Scheduler,
 * Prüfung und Anzeige rechnen mit monthlyTargetMinutesFor.
 */
export function monthlyTargetMinutes(emp: Employee, openDaysInMonth: number): number {
  if (emp.weeklyHours != null) {
    return Math.max(0, Math.round((emp.weeklyHours * 60 * openDaysInMonth) / OPEN_DAYS_PER_WEEK));
  }
  return emp.targetMinutes;
}

export type WeekShare = {
  weekStart: string;
  /** Anteil dieser Woche, der in den Monat fällt (0..1). */
  share: number;
  /** Offene Tage dieses Wochenteils ab Eintritt – Obergrenze 9 h je Tag. */
  days: number;
};

/**
 * Faktor eines Wochentags in der NORMALEN Woche: Tagesgewicht × Öffnungsminuten
 * laut Wochenplan. Bewusst der Wochentag, nicht der Feiertag/Override des
 * konkreten Datums – sonst ergäben die beiden Monatsteile einer Woche zusammen
 * mehr oder weniger als eine Woche.
 */
function weekdayFactor(weekday: WeekdayKey, workHours: WorkHoursConfig): number {
  const minutes = workHours.perWeekday[weekday].reduce((sum, block) => sum + (block.endMinutes - block.startMinutes), 0);
  return DAY_WEIGHTS[weekday] * minutes;
}

/**
 * Wochenanteile DIESER Person im Monat (gleicher Faktor wie die Tagesziele).
 *
 * Normale Woche = Wochentage, die in mindestens zwei Wochen des Monats offen
 * sind (ein einmalig geöffneter Montag zählt nicht). Tage vor dem Eintritt
 * (startDate) und nach dem Austritt (endDate) fallen weg.
 */
export function weekSharesFor(
  emp: Employee,
  openDates: readonly string[],
  workHours: WorkHoursConfig = DEFAULT_WORK_HOURS,
): WeekShare[] {
  const weeksByWeekday = new Map<WeekdayKey, Set<string>>();
  for (const date of openDates) {
    const weekday = weekdayKeyOf(parseIsoDate(date));
    weeksByWeekday.set(weekday, (weeksByWeekday.get(weekday) ?? new Set()).add(weekStartOf(date)));
  }
  const fullWeek = [...weeksByWeekday].reduce(
    (sum, [weekday, weeks]) => sum + (weeks.size >= 2 ? weekdayFactor(weekday, workHours) : 0),
    0,
  );
  if (fullWeek <= 0) return [];

  const byWeek = new Map<string, { factor: number; days: number }>();
  for (const date of openDates) {
    if (!isEmployedOn(emp, date)) continue;
    const week = weekStartOf(date);
    const entry = byWeek.get(week) ?? { factor: 0, days: 0 };
    entry.factor += weekdayFactor(weekdayKeyOf(parseIsoDate(date)), workHours);
    entry.days += 1;
    byWeek.set(week, entry);
  }
  return [...byWeek]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekStart, entry]) => ({ weekStart, share: Math.min(1, entry.factor / fullWeek), days: entry.days }));
}

/**
 * Minuten eines Wochenteils: Vertrag × Anteil. Nur ein ANGEBROCHENER Wochenteil
 * (Monatsrand, Eintritt, Schließtage) wird auf 9 h je offenem Tag gedeckelt – eine
 * volle Woche behält den ganzen Vertrag, damit ein unerfüllbarer Vertrag
 * (z. B. 60 h/Woche) weiter als „tháng này không đủ ngày" gewarnt wird.
 */
function weekPartMinutes(weeklyMinutes: number, week: WeekShare): number {
  if (week.share >= 1) return weeklyMinutes;
  return Math.min(weeklyMinutes * week.share, week.days * MAX_PAID_MINUTES_PER_DAY);
}

/**
 * Monats-Soll dieser Person in Minuten: Summe der Wochenteile (respektiert das
 * Startdatum und die 9-h-Tagesgrenze). Ohne Wochenvertrag bleibt es beim direkt
 * eingetragenen targetMinutes. workHours = Wochenplan des Ladens (Standard:
 * Vorgabe), damit Anzeige, Prüfung und Scheduler dieselbe Zahl rechnen.
 */
/**
 * MONATSvertrag anteilig, wenn jemand mitten im Monat kommt oder geht: wer am
 * 15. anfängt oder aufhört, schuldet in diesem Monat nur den Anteil der offenen
 * Tage, an denen er beschäftigt ist. Auf die halbe Stunde gerundet, damit der
 * Planer die Zahl exakt treffen kann.
 */
function proratedMonthly(emp: Employee, openDates: readonly string[]): number {
  if (emp.startDate == null && emp.endDate == null) return emp.targetMinutes;
  if (openDates.length === 0) return emp.targetMinutes;
  const beschaeftigt = openDates.filter((date) => isEmployedOn(emp, date)).length;
  if (beschaeftigt >= openDates.length) return emp.targetMinutes;
  const anteil = (emp.targetMinutes * beschaeftigt) / openDates.length;
  return Math.max(0, Math.round(anteil / SCHEDULE_SLOT_MINUTES) * SCHEDULE_SLOT_MINUTES);
}

export function monthlyTargetMinutesFor(
  emp: Employee,
  openDates: readonly string[],
  workHours: WorkHoursConfig = DEFAULT_WORK_HOURS,
): number {
  if (emp.weeklyHours == null) return proratedMonthly(emp, openDates);
  const weekly = emp.weeklyHours * 60;
  return Math.max(0, Math.round(weekSharesFor(emp, openDates, workHours).reduce((sum, week) => sum + weekPartMinutes(weekly, week), 0)));
}

/**
 * Wochenbudgets (Minuten im 30-Minuten-Raster) für eine Person mit Wochenvertrag.
 *
 * - Volle Wochen bekommen genau den Vertrag.
 * - Eine Woche am MonatsENDE wird abgerundet, eine am MonatsANFANG aufgerundet –
 *   beide Teile zusammen liegen nie über dem Wochenvertrag.
 * - Kein Wochenteil trägt mehr als 9 h je offenem Tag.
 * - Wochen ganz im Monat teilen die Rundungsreste nach größtem Rest, damit der
 *   Monat höchstens eine halbe Rastereinheit vom Soll abweicht.
 */
export function weeklyBudgetMinutes(
  emp: Employee,
  openDates: readonly string[],
  monthBounds: { first: string; last: string },
  workHours: WorkHoursConfig = DEFAULT_WORK_HOURS,
): Map<string, number> {
  const result = new Map<string, number>();
  if (emp.weeklyHours == null || emp.weeklyHours <= 0) return result;
  const weeklyMinutes = emp.weeklyHours * 60;
  const contractSlots = Math.floor(weeklyMinutes / SCHEDULE_SLOT_MINUTES + 1e-9);
  const weeks = weekSharesFor(emp, openDates, workHours).map((week) => ({
    weekStart: week.weekStart,
    slots: weekPartMinutes(weeklyMinutes, week) / SCHEDULE_SLOT_MINUTES,
    capSlots: Math.min(contractSlots, Math.floor((week.days * MAX_PAID_MINUTES_PER_DAY) / SCHEDULE_SLOT_MINUTES)),
    endsAfterMonth: addDaysIso(week.weekStart, 6) > monthBounds.last,
    startsBeforeMonth: week.weekStart < monthBounds.first,
  }));

  const whole = new Map<string, number>();
  for (const week of weeks) {
    const rounded = week.endsAfterMonth
      ? Math.floor(week.slots + 1e-9)
      : week.startsBeforeMonth ? Math.ceil(week.slots - 1e-9) : Math.floor(week.slots + 1e-9);
    whole.set(week.weekStart, Math.min(rounded, week.capSlots));
  }
  const interior = weeks.filter((week) => !week.endsAfterMonth && !week.startsBeforeMonth);
  const allocated = () => [...whole.values()].reduce((sum, value) => sum + value, 0);
  let rest = Math.round(weeks.reduce((sum, week) => sum + week.slots, 0)) - allocated();
  const byFraction = [...interior].sort((a, b) => (b.slots % 1) - (a.slots % 1) || a.weekStart.localeCompare(b.weekStart));
  for (const week of byFraction) {
    if (rest <= 0) break;
    if (whole.get(week.weekStart)! >= week.capSlots) continue;
    whole.set(week.weekStart, whole.get(week.weekStart)! + 1);
    rest -= 1;
  }
  for (const week of [...byFraction].reverse()) {
    if (rest >= 0) break;
    if (whole.get(week.weekStart)! <= 0) continue;
    whole.set(week.weekStart, whole.get(week.weekStart)! - 1);
    rest += 1;
  }
  for (const week of weeks) {
    result.set(week.weekStart, whole.get(week.weekStart)! * SCHEDULE_SLOT_MINUTES);
  }
  return result;
}

/**
 * Verteilt ein MONATS-Soll (in Minuten) auf die ISO-Wochen des Monats – für
 * Personen OHNE Wochenvertrag (nach Anzahl offener Tage), oder mit
 * contractedWeeklyMinutes nach dem Tagesanteil 1/6 (Altpfad, Tests).
 *
 * Rückgabe: weekStart (ISO-Montag) -> Soll-Minuten der Woche.
 */
export function weeklyTargetMinutes(
  monthlyMin: number,
  openDaysByWeek: readonly { weekStart: string; openDays: number }[],
  contractedWeeklyMinutes?: number,
): Map<string, number> {
  const result = new Map<string, number>();
  const totalOpen = openDaysByWeek.reduce((a, w) => a + w.openDays, 0);
  if (totalOpen <= 0 || monthlyMin <= 0) {
    for (const w of openDaysByWeek) result.set(w.weekStart, 0);
    return result;
  }

  // A weekly contract never borrows minutes from another week, even for a
  // short month boundary or an extra opening day.
  if (contractedWeeklyMinutes != null) {
    const rawSlots = openDaysByWeek.map((week) => ({
      weekStart: week.weekStart,
      slots: contractedWeeklyMinutes * Math.min(week.openDays, OPEN_DAYS_PER_WEEK) /
        OPEN_DAYS_PER_WEEK / SCHEDULE_SLOT_MINUTES,
    }));
    const targetSlots = Math.round(rawSlots.reduce((sum, week) => sum + week.slots, 0));
    const allocated = rawSlots.map((week) => ({
      ...week,
      wholeSlots: Math.floor(week.slots),
      fraction: week.slots - Math.floor(week.slots),
    }));
    let remainingSlots = targetSlots - allocated.reduce((sum, week) => sum + week.wholeSlots, 0);
    for (const week of [...allocated].sort((a, b) => b.fraction - a.fraction || a.weekStart.localeCompare(b.weekStart))) {
      if (remainingSlots <= 0) break;
      week.wholeSlots += 1;
      remainingSlots -= 1;
    }
    for (const week of allocated) result.set(week.weekStart, week.wholeSlots * SCHEDULE_SLOT_MINUTES);
    return result;
  }

  // Alles im 30-Minuten-Raster verteilen. Sonst bekommt jemand mit 40,2 h im
  // Monat ein Wochenbudget von 101 Minuten, und der Plan zeigt krumme Zeiten
  // wie 20:19–22:00. Der Rest unter einer halben Stunde bleibt ungeplant und
  // liegt damit unter der Warnschwelle der Prüfung.
  const totalSlots = Math.floor(monthlyMin / SCHEDULE_SLOT_MINUTES + 1e-9);
  const raw = openDaysByWeek.map((w) => (totalSlots * w.openDays) / totalOpen);
  const floors = raw.map((x) => Math.floor(x));
  let rest = totalSlots - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const slots = [...floors];
  for (let k = 0; k < order.length && rest > 0; k++, rest--) slots[order[k].i] += 1;
  openDaysByWeek.forEach((w, i) => result.set(w.weekStart, slots[i] * SCHEDULE_SLOT_MINUTES));
  return result;
}
