// ============================================================================
// Lưu lịch theo tháng (wie Thienlong/Vietpho): beim Monatswechsel wird der Plan
// des offenen Monats ins Archiv gelegt und der gespeicherte Plan des Zielmonats
// (falls vorhanden) wieder geöffnet. So geht kein erzeugter Monat verloren.
// Zusätzlich zu Thienlong merkt sich das Archiv hier je Monat die Sperre
// (lockedAt/printedWeeks) und „Bỏ qua cảnh báo" (underQuotaAccepted).
// ============================================================================

import type { MonthArchive, Schedule, Shift } from "../types";

/** Schlüssel eines Monats im Archiv, z.B. "2026-08". */
export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Monat eines Plans aus seinen Diensten (der Kopf kann schon weiter sein). */
function monthOfShifts(shifts: readonly Shift[]): { year: number; month: number } | null {
  const first = shifts.reduce<string | null>((min, s) => (min == null || s.date < min ? s.date : min), null);
  if (!first) return null;
  const [year, month] = first.split("-").map(Number);
  return { year, month };
}

/** Den offenen Plan als Archiv-Eintrag. */
function entryOf(schedule: Schedule, originalShifts: Shift[], savedAt: string): MonthArchive {
  return {
    shifts: schedule.shifts,
    originalShifts,
    savedAt,
    lockedAt: schedule.lockedAt,
    printedWeeks: schedule.printedWeeks,
    underQuotaAccepted: schedule.underQuotaAccepted,
  };
}

/** Wechselt den Monat, ohne einen erzeugten Plan zu verlieren (rein, ohne Seiteneffekte). */
export function switchMonth(
  schedule: Schedule,
  originalShifts: Shift[],
  year: number,
  month: number,
  savedAt: string = new Date().toISOString(),
): { schedule: Schedule; originalShifts: Shift[] } {
  if (year === schedule.year && month === schedule.month) return { schedule, originalShifts };
  const archive = { ...(schedule.archive ?? {}) };
  if (schedule.shifts.length > 0) {
    // Ältere Stände hatten nach einem Monatswechsel noch die Dienste des
    // Vormonats im offenen Plan – deshalb der Monat aus den Diensten.
    const own = monthOfShifts(schedule.shifts) ?? { year: schedule.year, month: schedule.month };
    archive[monthKey(own.year, own.month)] = entryOf(schedule, originalShifts, savedAt);
  }
  const targetKey = monthKey(year, month);
  const saved = archive[targetKey];
  delete archive[targetKey];
  return {
    schedule: {
      ...schedule,
      year,
      month,
      shifts: saved?.shifts ?? [],
      lockedAt: saved?.lockedAt,
      printedWeeks: saved?.printedWeeks ?? [],
      underQuotaAccepted: saved?.underQuotaAccepted,
      archive,
    },
    originalShifts: saved?.originalShifts ?? [],
  };
}

export type SavedMonth = {
  key: string;
  year: number;
  month: number;
  shiftCount: number;
  totalMinutes: number;
  /** true = đây là tháng đang mở. */
  current: boolean;
  /** Lúc cất vào kho (ISO); tháng đang mở thì không có. */
  savedAt?: string;
};

/** Alle Monate mit Plan (Archiv + aktuell geöffneter), chronologisch. */
export function listSavedMonths(schedule: Schedule): SavedMonth[] {
  const total = (shifts: Shift[]) => shifts.reduce((sum, sh) => sum + sh.paidMinutes, 0);
  const list: SavedMonth[] = Object.entries(schedule.archive ?? {}).map(([key, a]) => ({
    key,
    year: Number(key.slice(0, 4)),
    month: Number(key.slice(5, 7)),
    shiftCount: a.shifts.length,
    totalMinutes: total(a.shifts),
    current: false,
    savedAt: a.savedAt,
  }));
  if (schedule.shifts.length > 0) {
    list.push({
      key: monthKey(schedule.year, schedule.month),
      year: schedule.year,
      month: schedule.month,
      shiftCount: schedule.shifts.length,
      totalMinutes: total(schedule.shifts),
      current: true,
    });
  }
  return list.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Gộp kho lưu của một bản khác (tab/máy khác, hoặc bản đang nằm trong
 * localStorage/Supabase) vào bản của mình: tháng nào mình chưa có thì giữ lại,
 * để một tab cũ không bao giờ xoá mất tháng đã lưu. Tháng đang mở của mình
 * không nằm trong kho; tháng đang mở của bản kia được cất vào kho nếu khác.
 * Trả về chính `mine` nếu không có gì mới.
 */
export function mergeArchives(mine: Schedule, other: Schedule | undefined | null): Schedule {
  if (!other) return mine;
  const openKey = monthKey(mine.year, mine.month);
  const archive = { ...(mine.archive ?? {}) };
  let changed = false;
  const add = (key: string, entry: MonthArchive) => {
    if (key === openKey || archive[key]) return;
    archive[key] = entry;
    changed = true;
  };
  for (const [key, entry] of Object.entries(other.archive ?? {})) add(key, entry);
  if (Array.isArray(other.shifts) && other.shifts.length > 0 && other.year && other.month) {
    const own = monthOfShifts(other.shifts) ?? { year: other.year, month: other.month };
    add(monthKey(own.year, own.month), {
      shifts: other.shifts,
      originalShifts: [],
      savedAt: new Date().toISOString(),
      lockedAt: other.lockedAt,
      printedWeeks: other.printedWeeks,
      underQuotaAccepted: other.underQuotaAccepted,
    });
  }
  return changed ? { ...mine, archive } : mine;
}

/**
 * Übernahme aus der Vorversion („Bản đã lưu", schedule.savedPlans): je Monat der
 * jüngste Stand kommt ins Archiv, sofern es für den Monat noch nichts gibt und
 * es nicht der offene Monat ist. Danach fällt savedPlans weg.
 */
export function archiveFromLegacySavedPlans(schedule: Schedule & { savedPlans?: unknown }): Schedule {
  const legacy = Array.isArray(schedule.savedPlans)
    ? (schedule.savedPlans as Array<{ year: number; month: number; savedAt: string; shifts: Shift[] }>)
    : [];
  const { savedPlans: _drop, ...rest } = schedule;
  void _drop;
  if (legacy.length === 0) return rest;
  const archive = { ...(rest.archive ?? {}) };
  const openKey = monthKey(rest.year, rest.month);
  // savedPlans war jüngster zuerst – der erste Treffer je Monat gewinnt.
  for (const p of legacy) {
    const key = monthKey(p.year, p.month);
    if (key === openKey || archive[key] || !Array.isArray(p.shifts) || p.shifts.length === 0) continue;
    archive[key] = { shifts: p.shifts, originalShifts: [], savedAt: p.savedAt };
  }
  return { ...rest, archive };
}
