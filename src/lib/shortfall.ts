// ============================================================================
// „Vì sao thiếu giờ?" – rechnet für EINE Person nach, wie viele Tage im Laden
// überhaupt frei waren und woran die anderen gescheitert sind. Ergebnis sind
// Sätze mit echten Zahlen statt einer allgemeinen Floskel.
// ============================================================================

import type { Employee, Shift } from "../types";
import { isEmployedOn, worksOnWeekday } from "./availability";
import { weekStartOf } from "./weeks";
import { minutesToShortHours } from "./time";

const MAX_DAY = 8 * 60;

export type OtherStorePlan = { shortName: string; employees: readonly Employee[]; shifts: readonly Shift[] };

export type Shortfall = { reasons: string[]; fixes: string[] };

const ddmm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

export function explainShortfall(
  employee: Employee,
  assignedMinutes: number,
  targetMinutes: number,
  openDates: readonly string[],
  others: readonly OtherStorePlan[],
  shortName: string,
): Shortfall {
  const reasons: string[] = [];
  const fixes: string[] = [];

  // Tage, an denen dieselbe Person schon im anderen Laden arbeitet.
  const busy = new Map<string, string>();
  const otherWork: string[] = [];
  const otherNames: string[] = [];
  if (employee.personKey) {
    for (const other of others) {
      const partner = other.employees.find((e) => e.personKey === employee.personKey);
      if (!partner) continue;
      const dates = new Set(other.shifts.filter((s) => s.employeeId === partner.id).map((s) => s.date));
      if (dates.size > 0) {
        otherWork.push(`${other.shortName} ${dates.size} ngày`);
        otherNames.push(other.shortName);
      }
      for (const date of dates) busy.set(date, other.shortName);
    }
  }

  const employed = openDates.filter((date) => isEmployedOn(employee, date));
  const dayOff = employed.filter((date) => !worksOnWeekday(employee, date));
  const blocked = employed.filter((date) => worksOnWeekday(employee, date) && busy.has(date));
  const free = employed.filter((date) => worksOnWeekday(employee, date) && !busy.has(date));

  // Höchstens so viele Tage je Woche (Số ngày làm / tuần, 6-Tage-Regel), je 8 h.
  const perWeek = new Map<string, number>();
  for (const date of free) perWeek.set(weekStartOf(date), (perWeek.get(weekStartOf(date)) ?? 0) + 1);
  const weekLimit = Math.min(6, employee.maxDaysPerWeek ?? 6);
  const usableDays = [...perWeek.values()].reduce((sum, n) => sum + Math.min(n, weekLimit), 0);
  const capacity = usableDays * MAX_DAY;

  reasons.push(
    `Tháng này ${shortName} mở ${openDates.length} ngày` +
      (employed.length < openDates.length ? `, người này làm ${employed.length} ngày trong đó (ngày vào/nghỉ việc)` : "") +
      ".",
  );
  if (blocked.length > 0) {
    reasons.push(
      `Đang làm ở ${otherWork.join(", ")} — ${blocked.length} ngày trùng nên ${shortName} không được xếp (một ngày chỉ làm một quán).`,
    );
  }
  if (dayOff.length > 0) reasons.push(`${dayOff.length} ngày là ngày nghỉ cố định.`);
  reasons.push(
    `Còn ${free.length} ngày trống${free.length > 0 && free.length <= 10 ? ` (${free.map(ddmm).join(", ")})` : ""}` +
      (usableDays < free.length ? `, nhưng tối đa ${weekLimit} ngày/tuần nên dùng được ${usableDays} ngày` : "") +
      `. Mỗi ngày tối đa 8 giờ → tối đa ${minutesToShortHours(capacity)}, hợp đồng cần ${minutesToShortHours(targetMinutes)}.`,
  );

  if (capacity >= targetMinutes) {
    // Tage gäbe es genug – dann fehlte Platz an diesen Tagen (Höchstbesetzung, 6 Tage am Stück).
    reasons.push(
      `Đủ ngày trống, nhưng các ngày đó quán đã đủ người tối đa hoặc chạm luật 6 ngày liên tiếp, nên chỉ xếp được ${minutesToShortHours(assignedMinutes)}.`,
    );
    fixes.push("Bấm „Tìm cách xếp khác\" để app thử đổi thiết lập.");
    return { reasons, fixes };
  }

  if (blocked.length > 0) {
    fixes.push(`Ở ${otherNames.join("/")}: giảm „Số ngày làm / tuần" của người này để ${shortName} có thêm ngày.`);
  }
  fixes.push(`Mở thêm ngày ở ${shortName} (Cài đặt → giờ mở cửa).`);
  if (dayOff.length > 0) fixes.push("Bỏ bớt ngày nghỉ cố định.");
  fixes.push(`Hoặc giảm giờ hợp đồng ở ${shortName} xuống còn ${minutesToShortHours(capacity)}.`);
  return { reasons, fixes };
}
