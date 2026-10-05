import { useMemo, useState } from "react";
import type { UseScheduleReturn } from "../hooks/useSchedule";
import type { Shift } from "../types";
import {
  datesOfMonth,
  parseIsoDate,
  WEEKDAY_SHORT_VI,
  weekdayKeyOf,
} from "../lib/demand";
import { minutesToShortHours, minutesToTime } from "../lib/time";
import { signedHours } from "../lib/dateFormat";
import { isDayClosed } from "../lib/workHours";
import { publicHolidays } from "../lib/holidays";
import { ShiftCellEditor } from "./ShiftCellEditor";
import { SavedSchedulesButton } from "./SavedSchedules";
import { ScheduleDayView } from "./ScheduleDayView";
import { weeksOfMonth } from "../lib/weeks";
import { employmentShortVi } from "../lib/employment";
import { monthlyTargetMinutesFor, SCHEDULE_SLOT_MINUTES } from "../lib/contract";
import { StaffingReport } from "./StaffingReport";
import { PauseLabel } from "./PauseLabel";
import type { PeakCoverage } from "../lib/analyze";
import { ruleById, staffingRuleId } from "../lib/rules";

function isWeekendKey(iso: string): boolean {
  const k = weekdayKeyOf(parseIsoDate(iso));
  return k === "saturday" || k === "sunday";
}

function cellClass(shift: Shift | undefined): string {
  if (!shift) return "shift-free";
  const base = shift.shiftType === "EARLY" ? "shift-early" : "shift-late";
  return `${base} ${!shift.generated ? "shift-custom" : ""}`;
}

export function ScheduleTab({
  store,
  openMonth,
}: {
  store: UseScheduleReturn;
  /** Gespeicherten Monat öffnen – für ALLE Läden (App.setPeriod). */
  openMonth?: (year: number, month: number) => void;
}) {
  // Drucken (Monat/Woche) und Entsperren liegen im Tab „Bảng chấm công" –
  // dort sitzt alles, was Papier erzeugt.
  // Nút „Tạo lịch làm việc" và popup nằm trên thanh tab (App.tsx).
  const { schedule, validation, isLocked, openDates } = store;
  const [selected, setSelected] = useState<{ employeeId: string; date: string } | null>(null);
  // Mặc định luôn là cả tháng (theo yêu cầu của quán).
  const [view, setView] = useState<"grid" | "day" | "week">("grid");
  const [weekIndex, setWeekIndex] = useState(0);

  const dates = useMemo(
    () => datesOfMonth(schedule.year, schedule.month),
    [schedule.year, schedule.month],
  );

  const weeks = useMemo(
    () => weeksOfMonth(schedule.year, schedule.month),
    [schedule.year, schedule.month],
  );

  /**
   * Tage, die im Raster gezeigt werden. In der Wochenansicht nur die der
   * gewählten Woche – gerechnet wird trotzdem immer mit dem ganzen Monat,
   * die Summen rechts bleiben also Monatssummen.
   */
  const gridDates = useMemo(() => {
    if (view !== "week") return dates;
    return weeks[Math.min(weekIndex, weeks.length - 1)]?.dates ?? dates;
  }, [view, weekIndex, weeks, dates]);

  // Tra nhanh: employeeId#date -> ALLE Dienste des Tages.
  //
  // Es kann zwei geben (mittags und abends). Vorher stand hier eine Map auf
  // EINEN Dienst, und der zweite verschwand lautlos aus der Anzeige – der Plan
  // sah dann anders aus, als er war.
  const shiftMap = useMemo(() => {
    const m = new Map<string, Shift[]>();
    for (const s of schedule.shifts) {
      const key = `${s.employeeId}#${s.date}`;
      const liste = m.get(key);
      if (liste) liste.push(s);
      else m.set(key, [s]);
    }
    for (const liste of m.values()) liste.sort((a, b) => a.startMinutes - b.startMinutes);
    return m;
  }, [schedule.shifts]);

  const summaryByEmp = useMemo(
    () => new Map(validation.summaries.map((s) => [s.employee.id, s] as const)),
    [validation.summaries],
  );

  const overridesByDate = useMemo(
    () => new Map(schedule.dateOverrides.map((o) => [o.date, o] as const)),
    [schedule.dateOverrides],
  );

  // Geschlossene Tage (Sonntag + Feiertag-Overrides + Betriebsruhe) vorab.
  const closedByDate = useMemo(() => {
    const holidays = publicHolidays(schedule.year);
    const ovMap = Object.fromEntries(schedule.dateOverrides.map((o) => [o.date, o]));
    const set = new Set<string>();
    for (const d of dates) {
      if (isDayClosed(schedule.workHours, d, holidays, ovMap)) set.add(d);
    }
    return set;
  }, [dates, schedule.workHours, schedule.year, schedule.dateOverrides]);

  // Tổng theo ngày cho các dòng chân bảng.
  const dayStats = useMemo(() => {
    // „Số nhân viên" zählt PERSONEN, nicht Dienste: wer mittags und abends
    // arbeitet, ist trotzdem eine Person. Die Zahl der Dienste steht daneben,
    // sonst sieht ein Tag mit lauter geteilten Diensten doppelt besetzt aus.
    const stats = new Map<string, { people: Set<string>; shifts: number; total: number; early: number; late: number }>();
    for (const d of dates) stats.set(d, { people: new Set(), shifts: 0, total: 0, early: 0, late: 0 });
    for (const s of schedule.shifts) {
      const st = stats.get(s.date);
      if (!st) continue;
      st.people.add(s.employeeId);
      st.shifts += 1;
      st.total += s.paidMinutes;
      if (s.shiftType === "EARLY") st.early += 1;
      else st.late += 1; // LATE hoặc CUSTOM tính là ca tối
    }
    return stats;
  }, [dates, schedule.shifts]);

  // Chân bảng „ít nhất … người" je Besetzungsregel (wie Thienlong, ohne Bếp/Bồi):
  // dieselben Zahlen, die auch die Prüfung benutzt – Tag → Label → Spannen.
  const peaksByDay = useMemo(() => {
    const map = new Map<string, { targetHours: number; byLabel: Map<string, PeakCoverage[]> }>();
    for (const day of store.analysis.days) {
      const byLabel = new Map<string, PeakCoverage[]>();
      for (const peak of day.peaks) byLabel.set(peak.label, [...(byLabel.get(peak.label) ?? []), peak]);
      map.set(day.date, { targetHours: day.targetHours, byLabel });
    }
    return map;
  }, [store.analysis]);
  const staffingRows = store.storeConfig.staffingRules;

  const hasEmployees = store.activeEmployees.length > 0;

  return (
    <section>
      {/* Alles Sichtbare liegt im no-print-Block; beim Drucken bleibt nur der
          Druckbereich ganz unten übrig. */}
      <div className="no-print">
      {/*
        Nur ein kurzer Hinweis - Drucken und Entsperren sitzen im Tab
        "Bang cham cong". Ohne diesen Hinweis klickt man hier auf eine Zelle
        und nichts passiert, ohne zu erfahren warum.
      */}
      {isLocked && (
        <div className="mb-3 rounded bg-amber-50 border border-amber-200 text-amber-900 text-sm px-3 py-2">
          Lịch tháng này đã khóa vì đã in
          {schedule.lockedAt && ` lúc ${new Date(schedule.lockedAt).toLocaleString("vi-VN")}`} — chỉ
          xem, không sửa được. Mở khóa ở tab <b>Bảng chấm công</b>, hoặc bấm <b>Tạo lịch</b> để
          tạo lại.
        </div>
      )}

      {/* Chuyển chế độ xem: Tháng (mặc định) · Tuần · Ngày. Tuần chọn bằng một ô gọn. */}
      {hasEmployees && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            {(
              [
                ["grid", "Tháng"],
                ["week", "Tuần"],
                ["day", "Ngày"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setView(id)}
                aria-pressed={view === id}
                className={`px-3 py-1.5 text-sm rounded-md ${view === id ? "bg-slate-900 text-white" : "text-slate-600"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {view === "week" && weeks.length > 0 && (
            <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white">
              <button
                type="button"
                onClick={() => setWeekIndex((i) => Math.max(0, i - 1))}
                disabled={weekIndex === 0}
                aria-label="Tuần trước"
                className="px-2.5 py-1.5 text-slate-600 disabled:opacity-30"
              >
                ‹
              </button>
              <select
                aria-label="Tuần"
                value={Math.min(weekIndex, weeks.length - 1)}
                onChange={(e) => setWeekIndex(Number(e.target.value))}
                className="border-x border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800"
              >
                {weeks.map((w, idx) => (
                  <option key={w.weekStart} value={idx}>
                    {w.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setWeekIndex((i) => Math.min(weeks.length - 1, i + 1))}
                disabled={weekIndex >= weeks.length - 1}
                aria-label="Tuần sau"
                className="px-2.5 py-1.5 text-slate-600 disabled:opacity-30"
              >
                ›
              </button>
            </div>
          )}
          {openMonth && <SavedSchedulesButton store={store} openMonth={openMonth} />}
        </div>
      )}

      {schedule.shifts.length > 0 && <StaffingReport analysis={store.analysis} />}

      {/* Lỗi kiểm tra */}
      {!validation.valid && schedule.shifts.length > 0 && (
        <div className="mb-3 rounded bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2">
          <div className="font-medium mb-1">Lỗi kiểm tra ({validation.errors.length}):</div>
          <ul className="list-disc pl-5 space-y-0.5 max-h-40 overflow-auto">
            {validation.errors.slice(0, 30).map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Chú thích (bảng tháng và bảng tuần dùng chung lưới) */}
      {(view === "grid" || view === "week") && (
        <div className="flex flex-wrap gap-3 mb-2 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded border shift-early" /> Ca sáng
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded border shift-late" /> Ca tối
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded border shift-free" /> Nghỉ
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded border shift-custom bg-white" /> Đã sửa tay
          </span>
        </div>
      )}

      {!hasEmployees ? (
        <div className="rounded bg-white border border-slate-200 p-6 text-center text-slate-400">
          Vui lòng thêm nhân viên trước.
        </div>
      ) : view === "day" ? (
        <ScheduleDayView store={store} onEdit={(employeeId, date) => setSelected({ employeeId, date })} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white -mx-3 sm:mx-0">
          <table className="border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 bg-slate-100 border-b border-r border-slate-200 px-2 py-2 text-left min-w-[130px]">
                  Nhân viên
                </th>
                <th className="bg-slate-100 border-b border-slate-200 px-2 py-2 text-left">Loại</th>
                <th className="bg-slate-100 border-b border-slate-200 px-2 py-2 text-right">Định mức</th>
                {gridDates.map((d) => {
                  const day = parseIsoDate(d).getDate();
                  const wk = WEEKDAY_SHORT_VI[weekdayKeyOf(parseIsoDate(d))];
                  const ov = overridesByDate.get(d);
                  const closed = closedByDate.has(d);
                  const headerBg = closed
                    ? "bg-rose-100"
                    : ov
                      ? "bg-sky-100"
                      : isWeekendKey(d)
                        ? "bg-slate-200"
                        : "bg-slate-100";
                  return (
                    <th
                      key={d}
                      title={
                        closed
                          ? `Đóng cửa${ov?.note ? " · " + ov.note : ""}`
                          : ov
                            ? `Giờ riêng${ov.note ? " · " + ov.note : ""}`
                            : undefined
                      }
                      className={`border-b border-l border-slate-200 px-1 py-1 text-center min-w-[88px] ${headerBg}`}
                    >
                      <div className="font-semibold">{day}</div>
                      <div className="text-[10px] text-slate-500">{wk}</div>
                      {closed && <div className="text-[9px] text-rose-600 font-medium">Đóng cửa</div>}
                      {!closed && ov && <div className="text-[9px] text-sky-700 font-medium">Giờ riêng</div>}
                    </th>
                  );
                })}
                <th className="bg-slate-100 border-b border-l border-slate-200 px-2 py-2 text-right min-w-[64px]">
                  Đã xếp
                </th>
                <th className="bg-slate-100 border-b border-l border-slate-200 px-2 py-2 text-right min-w-[70px]">
                  Chênh lệch
                </th>
              </tr>
            </thead>
            <tbody>
              {store.activeEmployees.map((emp) => {
                const sum = summaryByEmp.get(emp.id);
                const sollMin = monthlyTargetMinutesFor(emp, openDates, schedule.workHours);
                const diff = sum?.diffMinutes ?? -sollMin;
                return (
                  <tr key={emp.id} className="hover:bg-slate-50/50">
                    <td className="sticky left-0 z-10 bg-white border-b border-r border-slate-200 px-2 py-1 font-medium whitespace-nowrap">
                      {emp.name}
                    </td>
                    <td className="border-b border-slate-100 px-2 py-1 text-slate-500">
                      {employmentShortVi(emp.employmentType)}
                    </td>
                    <td className="border-b border-slate-100 px-2 py-1 text-right text-slate-500">
                      {minutesToShortHours(sollMin)}
                    </td>
                    {gridDates.map((d) => {
                      const dienste = shiftMap.get(`${emp.id}#${d}`) ?? [];
                      const shift = dienste[0];
                      return (
                        <td
                          key={d}
                          onClick={() => setSelected({ employeeId: emp.id, date: d })}
                          className={`border-b border-l border-slate-200 px-1 py-1 text-center cursor-pointer align-middle ${cellClass(
                            shift,
                          )}`}
                          title="Bấm để sửa"
                        >
                          {shift ? (
                            <div className="leading-tight space-y-1">
                              {dienste.map((x, idx) => {
                                const isMulti = dienste.length > 1;
                                const shiftTag = isMulti
                                  ? idx === 0
                                    ? "Ca sáng"
                                    : idx === 1
                                      ? "Ca chiều"
                                      : `Ca ${idx + 1}`
                                  : null;
                                return (
                                  <div
                                    key={x.id}
                                    className={idx > 0 ? "border-t border-slate-200/90 pt-1 mt-0.5" : ""}
                                  >
                                    <div className="font-medium flex items-center justify-center gap-1">
                                      {shiftTag && (
                                        <span className="inline-block text-[9px] font-semibold text-slate-600 bg-slate-100/90 border border-slate-300/80 rounded px-1">
                                          {shiftTag}
                                        </span>
                                      )}
                                      <span>
                                        {minutesToTime(x.startMinutes)}–{minutesToTime(x.endMinutes)}
                                      </span>
                                    </div>
                                    <div className="text-[10px] opacity-80">
                                      {minutesToShortHours(x.paidMinutes)} · <PauseLabel shift={x} />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <span className="text-[11px]">Nghỉ</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="border-b border-l border-slate-200 px-2 py-1 text-right font-medium">
                      {minutesToShortHours(sum?.assignedMinutes ?? 0)}
                    </td>
                    <td
                      className={`border-b border-l border-slate-200 px-2 py-1 text-right font-medium ${
                        Math.abs(diff) <= SCHEDULE_SLOT_MINUTES / 2 ? "text-emerald-600" : "text-rose-600"
                      }`}
                    >
                      {Math.abs(diff) <= SCHEDULE_SLOT_MINUTES / 2 ? "≈0,0" : signedHours(diff)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <SummaryRow label="Số nhân viên" dates={gridDates} value={(d) => String(dayStats.get(d)!.people.size)} />
              <SummaryRow label="Số ca" dates={gridDates} value={(d) => String(dayStats.get(d)!.shifts)} />
              <SummaryRow
                label="Tổng giờ"
                dates={gridDates}
                value={(d) => minutesToShortHours(dayStats.get(d)!.total)}
              />
              <SummaryRow
                label="Giờ mục tiêu"
                hint="theo hệ số ngày"
                dates={gridDates}
                value={(d) => {
                  const day = peaksByDay.get(d);
                  return day && day.targetHours > 0 ? minutesToShortHours(Math.round(day.targetHours * 2) * 30) : "–";
                }}
              />
              <SummaryRow label="Ca sáng" dates={gridDates} value={(d) => String(dayStats.get(d)!.early)} />
              <SummaryRow label="Ca tối" dates={gridDates} value={(d) => String(dayStats.get(d)!.late)} />
              {schedule.shifts.length > 0 && staffingRows.map((rule) => (
                <CoverageRow
                  key={rule.label}
                  label={rule.label}
                  when={rule.when}
                  hard={ruleById(staffingRuleId(rule.label)).kind === "hard"}
                  dates={gridDates}
                  peaks={(d) => peaksByDay.get(d)?.byLabel.get(rule.label)}
                />
              ))}
            </tfoot>
          </table>
        </div>
      )}

      {/* Bearbeiten ist bei gesperrtem Monat gar nicht erst möglich. */}
      {selected && !isLocked && (
        <ShiftCellEditor
          store={store}
          employeeId={selected.employeeId}
          date={selected.date}
          onClose={() => setSelected(null)}
        />
      )}
      </div>
    </section>
  );
}

function SummaryRow({
  label,
  hint,
  dates,
  value,
}: {
  label: string;
  hint?: string;
  dates: string[];
  value: (d: string) => string;
}) {
  return (
    <tr className="bg-slate-50 text-slate-600">
      <td className="sticky left-0 z-10 bg-slate-50 border-t border-r border-slate-200 px-2 py-1 font-medium whitespace-nowrap">
        {label}
        {hint && <span className="ml-1 text-[11px] font-normal text-slate-400">{hint}</span>}
      </td>
      <td className="border-t border-slate-200" />
      <td className="border-t border-slate-200" />
      {dates.map((d) => (
        <td key={d} className="border-t border-l border-slate-200 px-1 py-1 text-center">
          {value(d)}
        </td>
      ))}
      <td className="border-t border-l border-slate-200" />
      <td className="border-t border-l border-slate-200" />
    </tr>
  );
}

/**
 * Eine Besetzungsregel als Zeile: wie viele Leute in der Spanne da sind, als
 * „vắng–đông" (kleinste–größte Zahl; bei „Trong giờ mở cửa" über beide Blöcke).
 * Nur die kleinste Zahl zu zeigen las sich wie „abends weniger Leute", obwohl
 * nur die letzte Stunde dünner war. Zu wenig → roter Rahmen „cần N",
 * zu viele → gelber Rahmen „tối đa N". Gleiche Zahlen wie in der Prüfung.
 */
function CoverageRow({
  label,
  when,
  hard,
  dates,
  peaks,
}: {
  label: string;
  when: string;
  hard: boolean;
  dates: string[];
  peaks: (d: string) => PeakCoverage[] | undefined;
}) {
  return (
    <tr className="bg-slate-50 text-slate-600">
      <td
        className="sticky left-0 z-10 bg-slate-50 border-t border-r border-slate-200 px-2 py-1 font-medium whitespace-nowrap"
        title={`${hard ? "Luật cứng" : "Luật mềm"}: ${label} ${when}`}
      >
        {label} <span className="text-[11px] font-normal text-slate-400">{when} · người (vắng–đông)</span>
        <span
          className={`ml-1 rounded px-1 text-[10px] font-medium ${hard ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"}`}
        >
          {hard ? "cứng" : "mềm"}
        </span>
      </td>
      <td className="border-t border-slate-200" />
      <td className="border-t border-slate-200" />
      {dates.map((d) => {
        const list = peaks(d);
        if (!list || list.length === 0) {
          return (
            <td key={d} className="border-t border-l border-slate-200 px-1 py-1 text-center text-slate-300">
              –
            </td>
          );
        }
        const min = Math.min(...list.map((p) => p.minStaff));
        const max = Math.max(...list.map((p) => p.maxStaff));
        const need = Math.max(...list.map((p) => p.required));
        const allowed = Math.min(...list.map((p) => p.allowed));
        const short = list.some((p) => p.minStaff < p.required);
        const over = list.some((p) => p.maxStaff > p.allowed);
        return (
          <td
            key={d}
            className={`border-t border-l border-slate-200 px-1 py-1 text-center ${
              short
                ? "bg-rose-50 font-semibold text-rose-700 outline outline-2 -outline-offset-2 outline-rose-500"
                : over
                  ? "bg-amber-50 text-amber-800 outline outline-2 -outline-offset-2 outline-amber-400"
                  : ""
            }`}
            title={`ít nhất ${min}, đông nhất ${max} · luật: ${need}${Number.isFinite(allowed) ? `–${allowed}` : "+"} người`}
          >
            {min === max ? min : `${min}–${max}`}
            {short && <span className="block text-[10px] leading-none">cần {need}</span>}
            {!short && over && <span className="block text-[10px] leading-none">tối đa {allowed}</span>}
          </td>
        );
      })}
      <td className="border-t border-l border-slate-200" />
      <td className="border-t border-l border-slate-200" />
    </tr>
  );
}
