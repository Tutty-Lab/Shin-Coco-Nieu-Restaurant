import { useState } from "react";
import type { UseScheduleReturn } from "../hooks/useSchedule";
import type { Employee, Schedule } from "../types";
import { minutesToDecimalHours } from "../lib/time";
import { monthlyTargetMinutesFor } from "../lib/contract";

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg bg-white border border-slate-200 px-2.5 py-1.5 sm:px-3 sm:py-2 shadow-sm">
      <div className="text-[11px] sm:text-xs text-slate-500 leading-tight">{label}</div>
      <div className={`text-base sm:text-lg font-semibold leading-tight ${accent ?? "text-slate-900"}`}>
        {value}
      </div>
    </div>
  );
}

/** "2026-08-27" -> "27.08." – kurz, weil oft mehrere Tage nebeneinander stehen. */
function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}.${month}.`;
}

/**
 * Aufklappbarer Hinweis: eine Zeile mit Zusammenfassung und (i)-Knopf; die
 * ausführliche Begründung erscheint erst beim Klick. So steht bei einer Warnung
 * nicht mehr die ganze Liste dauerhaft auf dem Bildschirm.
 */
function InfoNote({
  tone,
  summary,
  children,
}: {
  tone: "error" | "warning";
  summary: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const cls =
    tone === "error"
      ? "bg-rose-50 border-rose-200 text-rose-900"
      : "bg-amber-50 border-amber-200 text-amber-900";
  const icon = tone === "error" ? "✕" : "!";
  const badge = tone === "error" ? "bg-rose-200 text-rose-800" : "bg-amber-200 text-amber-800";
  return (
    <div className={`mt-2 rounded border text-sm ${cls}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${badge}`}>
          {icon}
        </span>
        <span className="flex-1 font-medium">{summary}</span>
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-current/40 text-xs font-semibold opacity-70"
          title={open ? "Ẩn chi tiết" : "Xem chi tiết vì sao"}
        >
          {open ? "×" : "i"}
        </span>
      </button>
      {open && <div className="border-t border-current/15 px-3 py-2 font-normal">{children}</div>}
    </div>
  );
}

/** Warum erreicht diese Person ihr Soll nicht? Aus ihren Feldern abgeleitet. */
function underQuotaReason(emp: Employee | undefined, schedule: Schedule): string {
  if (!emp) return "tháng này không đủ ngày cho định mức đó.";
  const prefix = `${schedule.year}-${String(schedule.month).padStart(2, "0")}-`;
  const parts: string[] = [];
  if (emp.startDate && emp.startDate.startsWith(prefix)) {
    parts.push(`vào làm từ ${shortDate(emp.startDate)} (các ngày trước không tính)`);
  }
  if (emp.endDate && emp.endDate.startsWith(prefix)) {
    parts.push(`nghỉ việc từ ${shortDate(emp.endDate)} (các ngày sau không tính)`);
  }
  if (emp.availableWeekdays && emp.availableWeekdays.length > 0 && emp.availableWeekdays.length < 6) {
    parts.push(`chỉ làm ${emp.availableWeekdays.length} ngày cố định trong tuần`);
  }
  if (emp.maxDaysPerWeek != null && emp.maxDaysPerWeek < 6) {
    parts.push(`giới hạn ${emp.maxDaysPerWeek} ngày/tuần`);
  }
  if (parts.length === 0) {
    return "hợp đồng cao hơn số giờ quán mở trong tháng (tối đa 8 giờ công/ngày, nghỉ 1 ngày mỗi tuần) — tháng này không đủ ngày để xếp đủ giờ.";
  }
  return `do ${parts.join("; ")}.`;
}

export function Dashboard({ store }: { store: UseScheduleReturn }) {
  const { schedule, validation, peakGaps, openDates } = store;
  const vz = schedule.employees.filter((e) => e.employmentType === "VOLLZEIT").length;
  const tz = schedule.employees.filter((e) => e.employmentType === "TEILZEIT").length;
  const mj = schedule.employees.filter((e) => e.employmentType === "MINIJOB").length;
  const byId = new Map(schedule.employees.map((e) => [e.id, e] as const));
  // Wochenverträge (weeklyHours) haben targetMinutes = 0; das Monats-Soll wird
  // erst über die offenen Tage abgeleitet (contract.ts), genau wie in der Prüfung.
  const targetMin = schedule.employees.reduce((s, e) => s + monthlyTargetMinutesFor(e, openDates, schedule.workHours), 0);
  const plannedMin = schedule.shifts.reduce((s, x) => s + x.paidMinutes, 0);
  const uncoveredMin = Math.max(0, targetMin - plannedMin);
  const notGenerated = schedule.shifts.length === 0;

  // Warnungen und Fehler getrennt: ein zu hohes Monats-Soll macht den Plan nicht
  // unbrauchbar, es fehlen nur Stunden, die der Monat nicht hergibt.
  const warnungen = validation.errors.filter((e) => e.severity === "warning");
  const fehler = validation.errors.filter((e) => e.severity !== "warning");

  const statusValue = notGenerated
    ? "Chưa tạo lịch"
    : fehler.length > 0
      ? `${fehler.length} lỗi`
      : warnungen.length > 0
        ? `${warnungen.length} cảnh báo`
        : "Hợp lệ";
  const statusAccent = notGenerated
    ? "text-slate-500"
    : fehler.length > 0
      ? "text-rose-600"
      : warnungen.length > 0
        ? "text-amber-600"
        : "text-emerald-600";

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
        <Stat label="Số nhân viên" value={String(schedule.employees.length)} />
        <Stat label="Toàn thời gian" value={String(vz)} />
        <Stat label="Bán thời gian" value={String(tz)} />
        <Stat label="Minijob" value={String(mj)} />
        <Stat label="Tổng giờ định mức" value={`${minutesToDecimalHours(targetMin, 1)} h`} />
        <Stat label="Tổng giờ đã xếp" value={`${minutesToDecimalHours(plannedMin, 1)} h`} />
        <Stat label="Giờ chưa thể xếp" value={`${minutesToDecimalHours(uncoveredMin, 1)} h`} accent={uncoveredMin ? "text-amber-600" : "text-emerald-600"} />
        <Stat label="Trạng thái kiểm tra" value={statusValue} accent={statusAccent} />
      </div>

      {notGenerated && schedule.employees.length > 0 && (
        <div className="mt-2 rounded bg-sky-50 border border-sky-200 text-sky-800 text-sm px-3 py-2">
          Chưa có lịch. Sang tab „Lịch làm việc" và bấm „Tạo lịch làm việc".
        </div>
      )}

      {/* Lỗi: gộp sau nút (i). */}
      {fehler.length > 0 && (
        <InfoNote tone="error" summary={`${fehler.length} lỗi cần sửa trước khi dùng lịch`}>
          <ul className="space-y-1">
            {fehler.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        </InfoNote>
      )}

      {/* Cảnh báo thiếu giờ: một dòng + (i) mở chi tiết vì sao từng người. */}
      {warnungen.length > 0 && schedule.shifts.length > 0 && (
        <InfoNote tone="warning" summary={`${warnungen.length} người chưa đủ giờ định mức (lịch vẫn dùng được)`}>
          <ul className="space-y-1.5">
            {warnungen.map((w, i) => {
              const emp = w.employeeId ? byId.get(w.employeeId) : undefined;
              return (
                <li key={i}>
                  <div>{w.message}</div>
                  <div className="opacity-80">→ Vì sao: {underQuotaReason(emp, schedule)}</div>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 opacity-80">
            App đã xếp kín các ngày hợp lệ trong từng tuần và chia đều giờ mỗi người. Không thể tự
            chuyển giờ sang người/tuần khác vì sẽ vượt hợp đồng — muốn thêm giờ thì đổi ngày vào làm,
            ngày nghỉ, availability hoặc hợp đồng của người đó.
          </div>
        </InfoNote>
      )}

      {/* Cao điểm lệch số người: một dòng + (i). */}
      {peakGaps.length > 0 && (
        <InfoNote tone="warning" summary={`${peakGaps.length} ngày lệch số người ở giờ cao điểm`}>
          <div className="space-y-0.5">
            {peakGaps.slice(0, 8).map((d) => (
              <div key={d.date}>
                <b>{shortDate(d.date)}</b>{" "}
                {d.peaks
                  .filter((p) => !p.ok)
                  .map((p) =>
                    p.minStaff < p.required
                      ? `${p.label} thiếu: ${p.minStaff}/${p.required} người`
                      : `${p.label} thừa: ${p.maxStaff}, tối đa ${p.allowed}`,
                  )
                  .join(" · ")}{" "}
                <span className="opacity-70">({d.shiftCount} ca, {d.paidHours}h)</span>
              </div>
            ))}
            {peakGaps.length > 8 && <div className="opacity-70">… và {peakGaps.length - 8} ngày nữa</div>}
          </div>
          <div className="mt-2 opacity-80">
            → Vì sao: tổng giờ trong ngày đủ định mức, nhưng phân bố theo giờ chưa khớp khung yêu cầu
            (trưa 12–14h 3–7 người, tối 18–21h 4–7 người, luôn có người tới 15:00 và 22:00). Cách xử lý:
            tăng định mức/thêm người cho ngày đó, sửa tay ca, hoặc chấp nhận vì lịch vẫn hợp lệ.
          </div>
        </InfoNote>
      )}
    </div>
  );
}
