import type { Employee, PreferredWindow, Shift } from "../types";
import { DAY_WEIGHTS, datesOfMonth, parseIsoDate, weekdayKeyOf, type WeekdayKey } from "./demand";
import { monthlyTargetMinutesFor, weeklyBudgetMinutes, weeklyTargetMinutes } from "./contract";
import { calculatePause } from "./time";
import { isEmployedOn, mayWorkOn } from "./availability";
import { consecutiveRunLengthWith } from "./consecutive";
import { effectiveWeekdayKey, resolveDay, type DayBlocks, type DayWindow, type OverrideMap, type WorkHoursConfig } from "./workHours";
import { publicHolidays } from "./holidays";
import { weekStartOf } from "./weeks";
import { minutesOutsidePreferred, ownShiftRangeMinutes, preferredWindowsOf } from "./preferredWindows";
import {
  CLOSING_START,
  STAFFING_RULES,
  slotTargets,
  staffingWindows,
  weightedDailyTargets,
  workingAt,
  workloadAt,
  type StaffingRule,
  type StaffingWindow,
} from "./staffing";

/**
 * Was an EINER Filiale anders ist: Tagesgewichte (welche Tage stark sind),
 * Besetzungsregeln und die Tage, an denen jemand schon im anderen Laden
 * eingeteilt ist. Wird durch alle Schritte gereicht, damit zwei Filialen sich
 * weder Regeln noch Zwischenergebnisse teilen.
 */
type Ctx = {
  rules: readonly StaffingRule[];
  weights: Record<WeekdayKey, number>;
  /** employeeId -> Daten, an denen die Person im anderen Laden arbeitet. */
  blocked: Map<string, Set<string>>;
  /** Teil des Cache-Schlüssels, damit Filialen nicht dasselbe Tagesmodell nutzen. */
  tag: string;
  /** „Khung giờ ưu tiên" je employeeId – nur wer welche gesetzt hat. */
  windows: Map<string, PreferredWindow[]>;
};

type WeeklyInput = {
  year: number;
  month: number;
  workHours: WorkHoursConfig;
  overrides?: OverrideMap;
  employees: Employee[];
  holidays?: Set<string>;
  /** Besetzungsregeln dieser Filiale; fehlt = die Standardregeln. */
  rules?: readonly StaffingRule[];
  /** Tagesgewichte dieser Filiale; fehlt = DAY_WEIGHTS. */
  weights?: Record<WeekdayKey, number>;
  /** Wer im anderen Laden schon arbeitet: employeeId -> ISO-Daten. */
  blockedDays?: Record<string, readonly string[]>;
  /** Kennung der Filiale (nur für den internen Cache). */
  storeTag?: string;
};
type Option = { shifts: Shift[]; styleCost: number };
type Choice = { date: string; paid: number; option: Option };
type Allocation = { paid: number; cost: number; mask: number; choices: Choice[] };
type Day = ReturnType<typeof resolveDay>;

const SLOT = 30;
const MIN_SHIFT = 180;
/** Höchste bezahlte Zeit je Tag: 8 h (Vorgabe des Betriebs, siehe validation.ts). */
const MAX_PAID = 480;
/** Cost per (person deviation)² per 30-minute slot against the demand curve. */
const SLOT_DEVIATION_COST = 300;
/** Small preference for one continuous shift over a split shift on the same day. */
const SPLIT_SHIFT_COST = 8;
/**
 * „Khung giờ ưu tiên": Aufschlag je Arbeitsminute außerhalb der Wunschfenster.
 * Ein 3-h-Dienst an einem Tag ohne Fenster kostet 18.000 – mehr als die übliche
 * Abweichung vom Tagesziel (1.500 je Stunde²), damit der Wunsch nicht dem
 * Feinschliff der Kurve weicht. Fehlt eine Besetzungsregel über mehrere halbe
 * Stunden (je 15.000), geht sie trotzdem vor.
 */
const OUTSIDE_WINDOW_COST = 100;

function hash(value: string): number {
  let result = 0;
  for (const char of value) result = (result * 31 + char.charCodeAt(0)) >>> 0;
  return result;
}

function dayOf(date: string): WeekdayKey {
  return weekdayKeyOf(parseIsoDate(date));
}

const openMinutesOfBlocks = (blocks: DayBlocks) =>
  blocks.reduce((sum, block) => sum + (block.endMinutes - block.startMinutes), 0);

function fixedPaid(window: DayWindow): number {
  const presence = window.endMinutes - window.startMinutes;
  for (const pause of [0, 30, 60]) {
    const paid = presence - pause;
    if (paid > 0 && calculatePause(paid) === pause) return paid;
  }
  return 0;
}

/**
 * Valid pause starts (§ 4 ArbZG): at least 1 h after the start and before the
 * end, at most 6 h of work before and after the pause, on the 30-minute grid.
 */
function pauseStartCandidates(startMinutes: number, endMinutes: number, pauseMinutes: number): number[] {
  if (pauseMinutes <= 0) return [];
  return Array.from(
    { length: Math.max(0, Math.floor((endMinutes - pauseMinutes - 60 - (startMinutes + 60)) / SLOT) + 1) },
    (_, index) => startMinutes + 60 + index * SLOT,
  ).filter((start) => start - startMinutes <= 360 && endMinutes - start - pauseMinutes <= 360);
}

function makeShift(
  employeeId: string,
  date: string,
  startMinutes: number,
  paidMinutes: number,
  shiftType: "EARLY" | "LATE",
  effectiveWeekday: WeekdayKey | undefined,
  ctx: Ctx,
): Shift {
  const pauseMinutes = calculatePause(paidMinutes);
  const endMinutes = startMinutes + paidMinutes + pauseMinutes;
  const weekday = effectiveWeekday ?? dayOf(date);
  // First guess: quietest part of the demand curve, never the closing window.
  // improveCoverage later moves pauses by the REAL headcount of the day.
  const pauseStartMinutes = pauseMinutes > 0 ? pauseStartCandidates(startMinutes, endMinutes, pauseMinutes).sort((a, b) => {
    const score = (start: number) => Array.from({ length: pauseMinutes / SLOT }, (_, index) => start + index * SLOT)
      .reduce((sum, minute) => sum + workloadAt(minute, weekday, ctx.weights) + (minute >= CLOSING_START ? 100 : 0), 0);
    return score(a) - score(b) || ((a / SLOT + hash(employeeId)) % 7) - ((b / SLOT + hash(employeeId)) % 7);
  })[0] : undefined;
  return {
    id: `weekly-${employeeId}-${date}-${startMinutes}-${paidMinutes}`,
    employeeId, date, startMinutes,
    endMinutes,
    ...(pauseStartMinutes == null ? {} : { pauseStartMinutes }),
    pauseMinutes, paidMinutes, shiftType, generated: true,
  };
}

/** Every start on the 30-minute grid inside the block (plus the block-end anchor). */
function startsInBlock(block: DayWindow, presence: number): number[] {
  const starts: number[] = [];
  for (let start = block.startMinutes; start + presence <= block.endMinutes; start += SLOT) starts.push(start);
  const endAnchored = block.endMinutes - presence;
  if (endAnchored >= block.startMinutes && !starts.includes(endAnchored)) starts.push(endAnchored);
  return starts;
}

function optionsFor(
  employee: Employee,
  date: string,
  paid: number,
  blocks: DayBlocks,
  partialWeek: boolean,
  effectiveWeekday: WeekdayKey | undefined,
  ctx: Ctx,
): Option[] {
  if (paid <= 0 || paid > MAX_PAID) return [];
  if (employee.fixedShift) {
    return fixedPaid(employee.fixedShift) === paid
      ? [{ shifts: [makeShift(employee.id, date, employee.fixedShift.startMinutes, paid, "EARLY", effectiveWeekday, ctx)], styleCost: 0 }]
      : [];
  }
  const options: Option[] = [];
  const add = (shifts: Shift[]) => options.push({ shifts, styleCost: (shifts.length - 1) * SPLIT_SHIFT_COST });
  const placements = (block: DayWindow, duration: number, early: boolean): Shift[] =>
    startsInBlock(block, duration + calculatePause(duration))
      .map((start) => makeShift(employee.id, date, start, duration, early ? "EARLY" : "LATE", effectiveWeekday, ctx));

  blocks.forEach((block, index) => {
    for (const shift of placements(block, paid, index === 0 && block.startMinutes < 16 * 60)) add([shift]);
  });
  // Split shift: one part in the first block, one in the last; the lunch closure is unpaid.
  const minimumEvening = partialWeek ? 120 : MIN_SHIFT;
  if (paid >= MIN_SHIFT + minimumEvening && blocks.length >= 2) {
    const first = blocks[0];
    const last = blocks[blocks.length - 1];
    for (let morning = MIN_SHIFT; morning <= Math.min(paid - minimumEvening, first.endMinutes - first.startMinutes); morning += SLOT) {
      const evenings = placements(last, paid - morning, false);
      for (const early of placements(first, morning, true)) {
        for (const late of evenings) {
          if (early.endMinutes <= late.startMinutes) add([early, late]);
        }
      }
    }
  }
  // Ngày Chủ nhật & ngày mở liên tục (blocks.length === 1): nhân viên làm ca liên tục,
  // không có nghỉ trưa tách ca. Giờ nghỉ giải lao (pause) được xếp vào ca theo đúng luật.
  return options;
}

/**
 * Everything about a day that does not depend on the shifts, computed once:
 * the 30-minute slots of the open blocks, their target headcount (demand curve)
 * and, per staffing window, which slots it covers and for how many minutes.
 */
type DayModel = {
  minutes: number[];
  targets: number[];
  windows: { slots: number[]; overlap: number[]; minStaff: number; maxStaff: number }[];
};
const dayModelCache = new Map<string, DayModel>();
function dayModel(blocks: DayBlocks, weekday: WeekdayKey, targetHours: number, ctx: Ctx): DayModel {
  const key = `${ctx.tag}|${weekday}|${blocks.map((b) => `${b.startMinutes}-${b.endMinutes}`).join(",")}|${targetHours.toFixed(4)}`;
  const cached = dayModelCache.get(key);
  if (cached) return cached;
  const slotList = slotTargets(blocks, weekday, targetHours, SLOT, ctx.weights);
  const minutes = slotList.map(([minute]) => minute);
  const windows = staffingWindows(blocks, weekday, ctx.rules).map((window: StaffingWindow) => {
    const slots: number[] = [];
    const overlap: number[] = [];
    minutes.forEach((minute, index) => {
      const covered = Math.min(window.endMinutes, minute + SLOT) - Math.max(window.startMinutes, minute);
      if (covered > 0) { slots.push(index); overlap.push(covered); }
    });
    return { slots, overlap, minStaff: window.minStaff, maxStaff: window.maxStaff };
  });
  const model = { minutes, targets: slotList.map(([, target]) => target), windows };
  if (dayModelCache.size > 5000) dayModelCache.clear();
  dayModelCache.set(key, model);
  return model;
}

/**
 * Day cost from headcounts per 30-minute slot (shifts and pauses lie on that grid):
 *  - staffing windows: every missing/extra person-minute costs 500,
 *  - demand curve: squared deviation from the slot target (smooth "mountain"),
 *  - paid hours: squared deviation from the day's weighted hours.
 */
function dayCost(shifts: Shift[], blocks: DayBlocks, weekday: WeekdayKey, targetHours: number | undefined, ctx: Ctx): number {
  if (blocks.length === 0) return 0;
  const model = dayModel(blocks, weekday, targetHours ?? 0, ctx);
  const counts = model.minutes.map((minute) => {
    let staff = 0;
    for (const shift of shifts) if (workingAt(shift, minute)) staff++;
    return staff;
  });
  let cost = 0;
  for (const window of model.windows) {
    for (let k = 0; k < window.slots.length; k++) {
      const staff = counts[window.slots[k]];
      cost += (Math.max(0, window.minStaff - staff) + Math.max(0, staff - window.maxStaff)) * window.overlap[k] * 500;
    }
  }
  for (let i = 0; i < counts.length; i++) cost += (counts[i] - model.targets[i]) ** 2 * SLOT_DEVIATION_COST;
  const paidHours = shifts.reduce((sum, shift) => sum + shift.paidMinutes, 0) / 60;
  cost += (paidHours - (targetHours ?? 0)) ** 2 * 1500;
  for (const shift of shifts) {
    const windows = ctx.windows.get(shift.employeeId);
    if (windows) cost += minutesOutsidePreferred(windows, dayOf(shift.date), shift) * OUTSIDE_WINDOW_COST;
  }
  return cost;
}

function dayLimit(employee: Employee): number {
  return Math.min(6, employee.maxDaysPerWeek ?? 6);
}

/**
 * Woche einer Person planen. Mit „Độ dài ca" zuerst nur in dieser Länge; reicht
 * das für das Wochensoll nicht, gilt die Standardlänge (die Regel ist weich).
 */
function chooseWeek(
  employee: Employee,
  dates: string[],
  target: number,
  existing: Shift[],
  days: Map<string, Day>,
  holidays: Set<string>,
  dailyTargets: Map<string, number>,
  ctx: Ctx,
): Choice[] {
  const own = employee.fixedShift ? null : ownShiftRangeMinutes(employee);
  const withOwn = chooseWeekWith(employee, dates, target, existing, days, holidays, dailyTargets, ctx, own);
  if (!own) return withOwn;
  const paidOf = (choices: Choice[]) => choices.reduce((sum, choice) => sum + choice.paid, 0);
  if (paidOf(withOwn) >= target) return withOwn;
  const plain = chooseWeekWith(employee, dates, target, existing, days, holidays, dailyTargets, ctx, null);
  return paidOf(plain) > paidOf(withOwn) ? plain : withOwn;
}

function chooseWeekWith(
  employee: Employee,
  dates: string[],
  target: number,
  existing: Shift[],
  days: Map<string, Day>,
  holidays: Set<string>,
  dailyTargets: Map<string, number>,
  ctx: Ctx,
  own: { min: number; max: number } | null,
): Choice[] {
  // Wer an diesem Tag schon im anderen Laden steht, ist hier nicht verfügbar –
  // die Läden liegen weit auseinander, zwei Dienste am selben Tag gehen nicht.
  const busy = ctx.blocked.get(employee.id);
  const eligible = dates.filter((date) => mayWorkOn(employee, date) && !busy?.has(date));
  const limit = Math.min(dayLimit(employee), eligible.length);
  if (target <= 0 || limit <= 0) return [];
  const fixed = employee.fixedShift ? fixedPaid(employee.fixedShift) : 0;
  if (employee.fixedShift && fixed === 0) return [];
  // Mit „Độ dài ca" folgt die Tageszahl der Wunschlänge; „Rải đều" nimmt das
  // kurze Ende (mehr, dafür kürzere Tage).
  const ownCount = own
    ? employee.spreadEvenly
      ? Math.floor(target / own.min)
      : Math.round(target / ((own.min + own.max) / 2))
    : 0;
  const preferredCount = fixed
    ? Math.min(limit, Math.floor(target / fixed))
    : own
      ? Math.min(limit, Math.max(1, ownCount))
      : Math.min(limit, Math.max(1, Math.floor(target / MIN_SHIFT)));

  // ±1,5 h um den Durchschnitt: genug Spielraum, damit Stoßtage (Gewicht 1,5)
  // längere und Normaltage kürzere Dienste bekommen können.
  const base = Math.round(target / Math.max(1, preferredCount) / SLOT) * SLOT;
  let lo = Math.max(MIN_SHIFT, base - 3 * SLOT);
  let hi = Math.min(MAX_PAID, base + 3 * SLOT);
  while (hi * preferredCount < target && hi < MAX_PAID) hi += SLOT;
  while (lo * preferredCount > target && lo > MIN_SHIFT) lo -= SLOT;
  // Mehr Wochensoll als die freien Tage fassen (z. B. Minijob im zweiten Laden,
  // der nur einen Tag je Woche frei hat): ohne diese Klammer läge lo über hi,
  // es gäbe keine einzige zulässige Dienstlänge, und die Person bekäme in der
  // Woche GAR NICHTS statt der möglichen 8 h.
  if (lo > hi) lo = hi;

  const durations = new Set<number>();
  if (fixed) durations.add(fixed);
  else if (own) {
    for (let duration = own.min; duration <= own.max; duration += SLOT) {
      if (duration <= target) durations.add(duration);
    }
  } else if (target < MIN_SHIFT) durations.add(target);
  else {
    for (let duration = lo; duration <= hi; duration += SLOT) {
      if (duration <= target) durations.add(duration);
    }
  }

  const worked = new Set(existing.filter((shift) => shift.employeeId === employee.id).map((shift) => shift.date));
  const validMasks = new Map<number, boolean>();
  const valid = (mask: number) => {
    const cached = validMasks.get(mask);
    if (cached != null) return cached;
    const set = new Set(worked);
    let ok = true;
    eligible.forEach((date, index) => {
      if ((mask & (1 << index)) === 0) return;
      if (consecutiveRunLengthWith(set, date) > 6) ok = false;
      set.add(date);
    });
    validMasks.set(mask, ok);
    return ok;
  };

  // Ideale Dienstlänge je Tag folgt demselben Faktor wie das Tagesziel
  // (Gewicht × Öffnungsdauer, Tab „Tài liệu") – bei gleicher Wochensumme.
  const factorOf = (date: string) =>
    ctx.weights[effectiveWeekdayKey(date, holidays)] * openMinutesOfBlocks(days.get(date)!.blocks);
  const averageFactor = eligible.reduce((sum, date) => sum + factorOf(date), 0) / eligible.length;

  let states = new Map<number, Allocation>([[0, { paid: 0, cost: 0, mask: 0, choices: [] }]]);
  for (let index = 0; index < eligible.length; index++) {
    const date = eligible[index];
    const day = days.get(date)!;
    const occupied = existing.filter((shift) => shift.date === date);
    const weekday = effectiveWeekdayKey(date, holidays);
    const ideal = averageFactor > 0 ? target / Math.max(1, preferredCount) * factorOf(date) / averageFactor : 0;
    const before = dayCost(occupied, day.blocks, weekday, dailyTargets.get(date), ctx);
    const candidates: { choice: Choice; cost: number }[] = [];
    // Continuous days (CN/lễ, one long block): a single shift always spans the
    // afternoon unless it is short. Allow the full 3–9 h range there and a soft
    // length preference, so lunch-only and evening-only shifts can shape both peaks.
    const continuous = day.blocks.length === 1 && !fixed && !own && target >= MIN_SHIFT;
    const dayDurations = continuous
      ? Array.from({ length: Math.floor((Math.min(MAX_PAID, target) - MIN_SHIFT) / SLOT) + 1 }, (_, i) => MIN_SHIFT + i * SLOT)
      : [...durations];
    const lengthCost = continuous ? 40 : 300;
    for (const paid of dayDurations) {
      let best: Option | undefined;
      let score = Infinity;
      for (const option of optionsFor(employee, date, paid, day.blocks, dates.length < 6, weekday, ctx)) {
        const cost = dayCost([...occupied, ...option.shifts], day.blocks, weekday, dailyTargets.get(date), ctx) - before + option.styleCost;
        if (cost < score) { best = option; score = cost; }
      }
      if (best) candidates.push({
        choice: { date, paid, option: best },
        cost: score + ((paid - ideal) / SLOT) ** 2 * lengthCost,
      });
    }
    const next = new Map(states);
    for (const state of states.values()) {
      if (state.choices.length >= limit) continue;
      const mask = state.mask | (1 << index);
      if (!valid(mask)) continue;
      for (const candidate of candidates) {
        const paid = state.paid + candidate.choice.paid;
        if (paid > target) continue;
        const key = paid * 128 + mask;
        const cost = state.cost + candidate.cost;
        if (cost >= (next.get(key)?.cost ?? Infinity)) continue;
        next.set(key, { paid, cost, mask, choices: [...state.choices, candidate.choice] });
      }
    }
    states = next;
  }
  // Exact weekly minutes take priority. An impossible quota stays short and
  // is reported by validation, never transferred to another week.
  // Feiertagspflicht (requiredOnHolidays): wer an Feiertagen im Dienst sein
  // muss, verliert diesen Tag nicht an eine sonst leicht bessere Verteilung.
  // Unmöglich (Feiertag vor Eintritt, Laden zu) bleibt folgenlos.
  const requiredIndexes = employee.requiredOnHolidays
    ? eligible.map((date, index) => (holidays.has(date) ? index : -1)).filter((index) => index >= 0)
    : [];
  const missingRequired = (mask: number) =>
    requiredIndexes.filter((index) => (mask & (1 << index)) === 0).length;

  let best: Allocation | undefined;
  let bestCost = Infinity;
  for (const state of states.values()) {
    // Vollzeit „thường 6 ngày/tuần": die Tageszahl hält, die Länge je Tag folgt dem Gewicht.
    const cost = state.cost + (state.choices.length - preferredCount) ** 2 * 50000 + missingRequired(state.mask) * 500000;
    if (!best || state.paid > best.paid || (state.paid === best.paid && cost < bestCost)) {
      best = state;
      bestCost = cost;
    }
  }
  return best?.choices ?? [];
}

/**
 * Nachschlag: die letzten Rest-Minuten an bestehende Dienste hängen.
 *
 * Das Monats-Soll wird je ISO-Woche verteilt und dort exakt geplant. Was beim
 * Runden auf das 30-Minuten-Raster übrig bleibt (oft 30–120 min), konnte bisher
 * nirgendwo mehr unterkommen und endete als Warnung „zu wenig geplant". Hier
 * wächst deshalb zum Schluss ein passender Dienst um 30 Minuten – solange
 * Tagesgrenze, Öffnungsblock und (bei Wochenverträgen) das Wochenbudget das
 * hergeben. Gewählt wird die Stelle, die der Nachfragekurve am wenigsten
 * schadet.
 */
function topUpShortfalls(
  result: Shift[],
  employees: Employee[],
  days: Map<string, Day>,
  holidays: Set<string>,
  dailyTargets: Map<string, number>,
  targets: Map<string, number>,
  weeklyCaps: Map<string, Map<string, number>>,
  ctx: Ctx,
): Shift[] {
  let shifts = [...result];
  for (const employee of employees) {
    if (employee.fixedShift) continue; // feste Schicht bleibt unangetastet
    const target = targets.get(employee.id) ?? 0;
    const paidOf = (list: Shift[]) => list.reduce((sum, shift) => sum + shift.paidMinutes, 0);
    // „Độ dài ca": lieber einen Tag wachsen lassen, der danach noch darin liegt.
    const ownMax = ownShiftRangeMinutes(employee)?.max;
    let guard = 0;
    while (guard++ < 60) {
      const own = shifts.filter((shift) => shift.employeeId === employee.id);
      if (target - paidOf(own) < SLOT) break;
      let best: { old: Shift; next: Shift; cost: number; over: boolean } | undefined;
      for (const shift of own) {
        const day = days.get(shift.date);
        if (!day || day.closed) continue;
        const block = day.blocks.find(
          (candidate) => shift.startMinutes >= candidate.startMinutes && shift.endMinutes <= candidate.endMinutes,
        );
        if (!block) continue;
        const sameDay = own.filter((other) => other.date === shift.date);
        if (paidOf(sameDay) + SLOT > MAX_PAID) continue;
        const over = ownMax != null && paidOf(sameDay) + SLOT > ownMax;
        const paid = shift.paidMinutes + SLOT;
        if (paid > MAX_PAID) continue;
        const week = weekStartOf(shift.date);
        const cap = weeklyCaps.get(employee.id)?.get(week);
        if (cap != null) {
          const inWeek = own.filter((other) => weekStartOf(other.date) === week);
          if (paidOf(inWeek) + SLOT > cap) continue;
        }
        const presence = paid + calculatePause(paid);
        const weekday = effectiveWeekdayKey(shift.date, holidays);
        const onDay = shifts.filter((other) => other.date === shift.date);
        const others = onDay.filter((other) => other !== shift);
        const before = dayCost(onDay, day.blocks, weekday, dailyTargets.get(shift.date), ctx);
        for (const start of [shift.startMinutes, shift.endMinutes - presence, block.endMinutes - presence]) {
          if (start < block.startMinutes || start + presence > block.endMinutes) continue;
          const grown = makeShift(employee.id, shift.date, start, paid, shift.shiftType === "EARLY" ? "EARLY" : "LATE", weekday, ctx);
          const clash = sameDay.some(
            (other) => other !== shift && other.startMinutes < grown.endMinutes && grown.startMinutes < other.endMinutes,
          );
          if (clash) continue;
          const cost = dayCost([...others, grown], day.blocks, weekday, dailyTargets.get(shift.date), ctx) - before;
          if (!best || (best.over && !over) || (best.over === over && cost < best.cost)) {
            best = { old: shift, next: grown, cost, over };
          }
        }
      }
      if (!best) break;
      shifts = shifts.map((shift) => (shift === best!.old ? best!.next : shift));
    }
  }
  return shifts;
}
/**
 * Final per-day polish, keeping every person's paid minutes for the day:
 *  1. move a person's shift(s) to a better start (all 30-minute options),
 *  2. move each pause to the valid pause start that fits the REAL headcount –
 *     pauses chosen only by the demand curve all landed on the same hour
 *     (Sunday: 4 people 14–15 h, 5 people 15–16 h → dip, then a jump at 16 h).
 */
function improveCoverage(result: Shift[], employees: Employee[], days: Map<string, Day>, holidays: Set<string>, dailyTargets: Map<string, number>, ctx: Ctx): Shift[] {
  const output: Shift[] = [];
  for (const [date, day] of days) {
    let onDay = result.filter((shift) => shift.date === date);
    const weekday = effectiveWeekdayKey(date, holidays);
    const target = dailyTargets.get(date);
    const partialWeek = [...days].filter(([otherDate, otherDay]) => !otherDay.closed && weekStartOf(otherDate) === weekStartOf(date)).length < 6;
    for (let pass = 0; pass < 4; pass++) {
      const baseline = dayCost(onDay, day.blocks, weekday, target, ctx);
      let changed = false;
      for (const employee of employees) {
        const own = onDay.filter((shift) => shift.employeeId === employee.id);
        if (own.length === 0) continue;
        const paid = own.reduce((sum, shift) => sum + shift.paidMinutes, 0);
        const others = onDay.filter((shift) => shift.employeeId !== employee.id);
        let bestCost = dayCost(onDay, day.blocks, weekday, target, ctx);
        let best: Shift[] | undefined;
        for (const option of optionsFor(employee, date, paid, day.blocks, partialWeek, weekday, ctx)) {
          const cost = dayCost([...others, ...option.shifts], day.blocks, weekday, target, ctx);
          if (cost < bestCost - 1e-9) { best = option.shifts; bestCost = cost; }
        }
        if (best) { onDay = [...others, ...best]; changed = true; }
      }
      for (let i = 0; i < onDay.length; i++) {
        const shift = onDay[i];
        if (shift.pauseMinutes <= 0) continue;
        const others = onDay.filter((_, k) => k !== i);
        let bestCost = dayCost(onDay, day.blocks, weekday, target, ctx);
        let best: Shift | undefined;
        for (const start of pauseStartCandidates(shift.startMinutes, shift.endMinutes, shift.pauseMinutes)) {
          if (start === shift.pauseStartMinutes) continue;
          const moved = { ...shift, pauseStartMinutes: start };
          const cost = dayCost([...others, moved], day.blocks, weekday, target, ctx);
          if (cost < bestCost - 1e-9) { best = moved; bestCost = cost; }
        }
        if (best) { onDay = [...others.slice(0, i), best, ...others.slice(i)]; changed = true; }
      }
      // Continuous days (CN/lễ): hand over the closing role. With 9 h shifts the
      // closers can only start at noon, so nobody ramps up before the lunch peak;
      // a single-person move never sees "B closes instead, A starts earlier".
      if (day.blocks.length === 1) {
        const blockEnd = day.blocks[0].endMinutes;
        const byId = new Map(employees.map((employee) => [employee.id, employee] as const));
        for (const closer of onDay.filter((shift) => shift.endMinutes === blockEnd)) {
          for (const other of onDay.filter((shift) => shift.endMinutes !== blockEnd)) {
            if (!onDay.includes(closer) || !onDay.includes(other)) continue;
            const empA = byId.get(closer.employeeId);
            const empB = byId.get(other.employeeId);
            if (!empA || !empB || empA.fixedShift || empB.fixedShift) continue;
            const rest = onDay.filter((shift) => shift !== closer && shift !== other);
            const newClosers = optionsFor(empB, date, other.paidMinutes, day.blocks, partialWeek, weekday, ctx)
              .filter((option) => option.shifts[option.shifts.length - 1].endMinutes === blockEnd);
            if (newClosers.length === 0) continue;
            const movesA = optionsFor(empA, date, closer.paidMinutes, day.blocks, partialWeek, weekday, ctx);
            let bestCost = dayCost(onDay, day.blocks, weekday, target, ctx);
            let best: Shift[] | undefined;
            for (const optionB of newClosers) for (const optionA of movesA) {
              const cost = dayCost([...rest, ...optionB.shifts, ...optionA.shifts], day.blocks, weekday, target, ctx);
              if (cost < bestCost - 1e-9) { best = [...optionB.shifts, ...optionA.shifts]; bestCost = cost; }
            }
            if (best) { onDay = [...rest, ...best]; changed = true; }
          }
        }
      }
      if (!changed || dayCost(onDay, day.blocks, weekday, target, ctx) >= baseline) break;
    }
    output.push(...onDay);
  }
  return output;
}

export function generateWeeklySchedule(input: WeeklyInput, existing: Shift[] = []): Shift[] {
  const ctx: Ctx = {
    rules: input.rules ?? STAFFING_RULES,
    weights: input.weights ?? DAY_WEIGHTS,
    blocked: new Map(Object.entries(input.blockedDays ?? {}).map(([id, dates]) => [id, new Set(dates)])),
    tag: input.storeTag ?? "default",
    windows: new Map(
      input.employees
        .map((employee) => [employee.id, preferredWindowsOf(employee)] as const)
        .filter(([, windows]) => windows.length > 0),
    ),
  };
  const holidays = input.holidays ?? publicHolidays(input.year);
  const days = new Map(datesOfMonth(input.year, input.month).map((date) => [
    date, resolveDay(input.workHours, date, holidays, input.overrides ?? {}),
  ]));
  const openDates = [...days].filter(([, day]) => !day.closed).map(([date]) => date);
  const byWeek = new Map<string, string[]>();
  for (const date of openDates) {
    const week = weekStartOf(date);
    byWeek.set(week, [...(byWeek.get(week) ?? []), date]);
  }
  const weekInfo = [...byWeek].map(([weekStart, weekDates]) => ({ weekStart, openDays: weekDates.length }));
  const weeks = [...byWeek].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const typeRank = (employee: Employee) => employee.employmentType === "VOLLZEIT" ? 0 : employee.employmentType === "TEILZEIT" ? 1 : 2;
  const employees = [...input.employees].sort((a, b) =>
    Number(Boolean(b.fixedShift)) - Number(Boolean(a.fixedShift)) || typeRank(a) - typeRank(b) || a.id.localeCompare(b.id),
  );
  let result = [...existing];
  const monthDates = [...days.keys()];
  const monthBounds = { first: monthDates[0], last: monthDates[monthDates.length - 1] };
  // Wochenbudget je Person: Wochenvertrag × Anteil der Woche in diesem Monat nach
  // Tagesgewicht (contract.ts) – Randtage am Monatsende werden nicht überbesetzt.
  // Ohne Wochenvertrag: Monats-Soll nach offenen Tagen (ab Eintritt) verteilt.
  const budgets = new Map(employees.map((employee) => {
    if (employee.weeklyHours != null) return [employee.id, weeklyBudgetMinutes(employee, openDates, monthBounds, input.workHours)] as const;
    const empWeekInfo = weekInfo.map((week) => ({
      weekStart: week.weekStart,
      openDays: (byWeek.get(week.weekStart) ?? []).filter((date) => isEmployedOn(employee, date)).length,
    }));
    // Anteiliges Monats-Soll, wenn Eintritt oder Austritt in den Monat fallen.
    return [employee.id, weeklyTargetMinutes(monthlyTargetMinutesFor(employee, openDates, input.workHours), empWeekInfo)] as const;
  }));
  // Ein Wochenbudget unter der Mindestschichtlänge (Monatsrand: ein oder zwei
  // offene Tage) ergäbe einen 1–2-Stunden-Dienst. Bei einem MONATSvertrag darf
  // dieser Rest in die Nachbarwoche wandern; ein WOCHENvertrag bleibt hart an
  // seiner Woche.
  for (const employee of employees) {
    if (employee.weeklyHours != null) continue;
    const weekly = budgets.get(employee.id)!;
    const order = [...weekly.keys()].sort();
    for (let index = 0; index < order.length; index++) {
      const week = order[index];
      const minutes = weekly.get(week) ?? 0;
      if (minutes <= 0 || minutes >= MIN_SHIFT) continue;
      const room = (other: string) =>
        (byWeek.get(other)?.length ?? 0) * MAX_PAID - (weekly.get(other) ?? 0);
      const neighbour = [order[index - 1], order[index + 1]]
        .filter((other): other is string => Boolean(other) && room(other) >= minutes)
        .sort((a, b) => room(b) - room(a))[0];
      if (!neighbour) continue;
      weekly.set(neighbour, (weekly.get(neighbour) ?? 0) + minutes);
      weekly.set(week, 0);
    }
  }

  // Tab „Tài liệu": giờ ngày = giờ tuần × (hệ số × phút mở) ÷ Σ(hệ số × phút mở),
  // chuẩn hoá trong từng ISO-week; ngày lễ tính như Chủ nhật (effectiveWeekdayKey).
  const dailyTargets = new Map<string, number>();
  const spreadByWeight = (weekDates: string[], total: number) => {
    const targets = weightedDailyTargets(
      weekDates,
      total,
      (date) => effectiveWeekdayKey(date, holidays),
      (date) => openMinutesOfBlocks(days.get(date)!.blocks),
      ctx.weights,
    );
    for (const [date, hours] of targets) dailyTargets.set(date, hours);
  };
  for (const [weekStart, weekDates] of byWeek) {
    const weekMinutes = [...budgets.values()].reduce((sum, weekly) => sum + (weekly.get(weekStart) ?? 0), 0);
    spreadByWeight(weekDates, weekMinutes / 60);
  }
  for (const employee of employees) {
    const weekly = budgets.get(employee.id)!;
    for (const [weekStart, weekDates] of weeks) {
      const choices = chooseWeek(employee, weekDates, weekly.get(weekStart) ?? 0, result, days, holidays, dailyTargets, ctx);
      result.push(...choices.flatMap((choice) => choice.option.shifts));
    }
  }
  // Refit to actual available hours (new hires can reduce a week's budget).
  for (const [, weekDates] of byWeek) {
    const actual = result.filter((s) => weekDates.includes(s.date)).reduce((sum, s) => sum + s.paidMinutes, 0) / 60;
    spreadByWeight(weekDates, actual);
  }
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const [weekStart, weekDates] of weeks) for (const employee of [...employees].reverse()) {
      const own = result.filter((s) => s.employeeId === employee.id && weekStartOf(s.date) === weekStart);
      const paid = own.reduce((sum, s) => sum + s.paidMinutes, 0);
      if (!paid || employee.fixedShift) continue;
      const others = result.filter((s) => !own.includes(s));
      const choices = chooseWeek(employee, weekDates, paid, others, days, holidays, dailyTargets, ctx);
      const next = choices.flatMap((choice) => choice.option.shifts);
      if (next.reduce((sum, s) => sum + s.paidMinutes, 0) !== paid) continue;
      const score = (shifts: Shift[]) => weekDates.reduce((sum, date) => sum + dayCost(
        [...others.filter((s) => s.date === date), ...shifts.filter((s) => s.date === date)],
        days.get(date)!.blocks, effectiveWeekdayKey(date, holidays), dailyTargets.get(date), ctx), 0);
      if (score(next) < score(own) - 0.01) {
        result = [...others, ...next];
        changed = true;
      }
    }
    if (!changed) break;
  }
  // Rest-Minuten aus der Wochenrundung noch unterbringen (siehe topUpShortfalls).
  const monthlyTargets = new Map(
    employees.map((employee) => [
      employee.id,
      employee.weeklyHours != null
        ? [...(budgets.get(employee.id)?.values() ?? [])].reduce((sum, minutes) => sum + minutes, 0)
        : monthlyTargetMinutesFor(employee, openDates, input.workHours),
    ] as const),
  );
  // Ein WOCHENvertrag ist eine harte Grenze je Woche; ein Monatsvertrag nicht.
  const weeklyCaps = new Map(
    employees
      .filter((employee) => employee.weeklyHours != null)
      .map((employee) => [employee.id, budgets.get(employee.id)!] as const),
  );
  result = topUpShortfalls(result, employees, days, holidays, dailyTargets, monthlyTargets, weeklyCaps, ctx);

  return improveCoverage(result, employees, days, holidays, dailyTargets, ctx)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes || a.employeeId.localeCompare(b.employeeId));
}
