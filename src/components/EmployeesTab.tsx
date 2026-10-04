import { useMemo, useState } from "react";
import type { UseScheduleReturn } from "../hooks/useSchedule";
import type { Employee, EmploymentType } from "../types";
import { splitTargetHours } from "../lib/splitTargetHours";
import { WEEKDAY_SHORT_VI, type WeekdayKey } from "../lib/demand";
import { monthlyTargetMinutesFor } from "../lib/contract";
import { employmentLabelVi, employmentShortVi } from "../lib/employment";
import { minutesToShortHours, minutesToTime, timeToMinutes } from "../lib/time";
import type { WorkHoursConfig } from "../lib/workHours";
import { currentPartners, linkPatches, type PartnerChoice, type StoreRoster } from "../lib/sharedPerson";

const inputClass =
  "rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";

/** Voreinstellung der festen Schicht, wenn eingeschaltet: 6:30–14:30. */
const FIXED_START_DEFAULT = "06:30";
const FIXED_END_DEFAULT = "14:30";

const WEEKDAY_ORDER: WeekdayKey[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

/** Số ngày làm (= số ca) cho một mục tiêu, hoặc thông báo lỗi. */
function splitInfo(targetHours: number, type: EmploymentType): { ok: boolean; text: string } {
  if (targetHours <= 0) return { ok: true, text: "—" };
  try {
    const parts = splitTargetHours(Math.round(targetHours), type);
    return { ok: true, text: `${parts.length} ca` };
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : "không hợp lệ" };
  }
}

/**
 * Entwurf, während im Blatt getippt wird. Die Wochenstunden sind ein STRING,
 * damit man das Feld leeren kann, ohne dass es auf 0 zurückspringt.
 */
type Draft = {
  name: string;
  employmentType: EmploymentType;
  /** Wird der Vertrag je Woche oder je Monat geführt? */
  unit: "week" | "month";
  /** Stunden zur gewählten Einheit, als Text – „40,2" mit Komma ist erlaubt. */
  hours: string;
  fixed: boolean;
  fixedStart: string; // "HH:MM"
  fixedEnd: string; // "HH:MM"
  availableWeekdays: WeekdayKey[]; // [] = mọi ngày
  /** Ngày lễ bắt buộc có mặt (Shin: Bá Việt Nguyen). */
  holidayDuty: boolean;
  maxDays: string;
  startDate: string; // "yyyy-MM-dd" hoặc "" = từ đầu tháng
  endDate: string; // "yyyy-MM-dd" hoặc "" = vẫn đang làm
  /** Cùng một người ở quán khác: storeId -> employeeId ("" = không). */
  partners: PartnerChoice;
};

/** Ein anderer Laden, wie ihn das Feld „Cũng làm ở quán khác" braucht. */
type OtherStore = { storeId: string; shortName: string; employees: readonly Employee[]; locked: boolean };

function draftFrom(emp?: Employee, partners: PartnerChoice = {}): Draft {
  return {
    name: emp?.name ?? "",
    employmentType: emp?.employmentType ?? "VOLLZEIT",
    unit: emp?.weeklyHours != null ? "week" : "month",
    hours: emp
      ? String(emp.weeklyHours ?? Math.round((emp.targetMinutes / 60) * 100) / 100).replace(".", ",")
      : "169",
    fixed: !!emp?.fixedShift,
    // Vorhandene feste Schicht übernehmen, sonst die Voreinstellung anzeigen.
    fixedStart: emp?.fixedShift ? minutesToTime(emp.fixedShift.startMinutes) : FIXED_START_DEFAULT,
    fixedEnd: emp?.fixedShift ? minutesToTime(emp.fixedShift.endMinutes) : FIXED_END_DEFAULT,
    availableWeekdays: emp?.availableWeekdays ?? [],
    holidayDuty: emp?.requiredOnHolidays ?? false,
    maxDays: emp?.maxDaysPerWeek ? String(emp.maxDaysPerWeek) : "",
    startDate: emp?.startDate ?? "",
    endDate: emp?.endDate ?? "",
    partners,
  };
}

/** Tóm tắt các thiết lập „Nâng cao" đang bật (dòng dưới tiêu đề), hoặc null nếu chưa đặt gì. */
function advancedSummary(d: Draft, others: readonly OtherStore[] = []): string | null {
  const parts: string[] = [];
  const shared = others.filter((o) => d.partners[o.storeId]).map((o) => o.shortName);
  if (shared.length > 0) parts.push(`cũng làm ở ${shared.join(", ")}`);
  if (d.holidayDuty) parts.push("trực ngày lễ");
  if (d.fixed) parts.push(`ca cố định ${d.fixedStart}–${d.fixedEnd}`);
  if (d.availableWeekdays.length > 0 && d.availableWeekdays.length < WEEKDAY_ORDER.length) {
    const days = WEEKDAY_ORDER.filter((key) => d.availableWeekdays.includes(key)).map((key) => WEEKDAY_SHORT_VI[key]);
    parts.push(`làm ${days.join(", ")}`);
  }
  if (Number(d.maxDays) >= 1) parts.push(`tối đa ${Math.min(7, Math.round(Number(d.maxDays)))} ngày/tuần`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d.startDate)) {
    const [year, month, day] = d.startDate.split("-");
    parts.push(`vào làm ${day}.${month}.${year}`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(d.endDate)) {
    const [year, month, day] = d.endDate.split("-");
    parts.push(`nghỉ việc ${day}.${month}.${year}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Wandelt "HH:MM" in Minuten; bei Unsinn die Voreinstellung. */
function safeMinutes(time: string, fallback: string): number {
  try {
    return timeToMinutes(time);
  } catch {
    return timeToMinutes(fallback);
  }
}

/** Entwurf -> Mitarbeiter-Felder (ohne id). */
function draftToEmployee(d: Draft): Omit<Employee, "id"> {
  const hours = Math.max(0, Number(d.hours.trim().replace(",", ".")) || 0);
  const tage = Number(d.maxDays);
  const fixedStart = safeMinutes(d.fixedStart, FIXED_START_DEFAULT);
  const fixedEnd = safeMinutes(d.fixedEnd, FIXED_END_DEFAULT);
  return {
    name: d.name.trim() || "Nhân viên mới",
    employmentType: d.employmentType,
    // Monatsvertrag: die Stunden stehen direkt im Soll. Wochenvertrag: das
    // Monats-Soll wird je Monat daraus abgeleitet (contract.ts).
    targetMinutes: d.unit === "month" ? Math.round(hours * 60) : 0,
    weeklyHours: d.unit === "week" ? hours : undefined,
    // Ende muss nach Beginn liegen – sonst die feste Schicht ignorieren, statt
    // eine kaputte Zeitspanne zu speichern.
    fixedShift:
      d.fixed && fixedEnd > fixedStart
        ? { startMinutes: fixedStart, endMinutes: fixedEnd }
        : undefined,
    availableWeekdays:
      d.availableWeekdays.length === 0 || d.availableWeekdays.length === 7
        ? undefined
        : [...d.availableWeekdays],
    maxDaysPerWeek: d.maxDays === "" || tage < 1 ? undefined : Math.min(7, Math.round(tage)),
    requiredOnHolidays: d.holidayDuty ? true : undefined,
    // Leeres Feld = von Monatsanfang an dabei (kein Eintrittsdatum).
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(d.startDate) ? d.startDate : undefined,
    // Leeres Feld = arbeitet weiter (kein Austritt).
    endDate: /^\d{4}-\d{2}-\d{2}$/.test(d.endDate) ? d.endDate : undefined,
  };
}

export function EmployeesTab({ store, allStores }: { store: UseScheduleReturn; allStores: readonly UseScheduleReturn[] }) {
  const { schedule, openDays, openDates, addEmployee, updateEmployee, removeEmployee } = store;
  const locked = Boolean(schedule.lockedAt);

  const rosters: StoreRoster[] = allStores.map((s) => ({ storeId: s.storeId, employees: s.schedule.employees }));
  const others: OtherStore[] = allStores
    .filter((s) => s.storeId !== store.storeId)
    .map((s) => ({
      storeId: s.storeId,
      shortName: s.storeConfig.shortName,
      employees: s.schedule.employees,
      locked: Boolean(s.schedule.lockedAt),
    }));
  const partnerLabel = (emp: Employee) =>
    others.filter((o) => currentPartners(rosters, store.storeId, emp)[o.storeId]).map((o) => o.shortName);

  /** personKeys in allen betroffenen Läden setzen bzw. lösen. */
  const saveLinks = (self: { employeeId: string; name: string; personKey?: string }, choice: PartnerChoice) => {
    for (const patch of linkPatches(rosters, { storeId: store.storeId, ...self }, choice)) {
      allStores.find((s) => s.storeId === patch.storeId)?.updateEmployee(patch.employeeId, { personKey: patch.personKey });
    }
  };

  // null = zu; "new" = anlegen; sonst = die id, die bearbeitet wird.
  const [offen, setOffen] = useState<null | "new" | string>(null);
  const bearbeitet = useMemo(
    () =>
      typeof offen === "string" && offen !== "new"
        ? schedule.employees.find((e) => e.id === offen)
        : undefined,
    [offen, schedule.employees],
  );

  return (
    <section className="rounded-lg bg-white border border-slate-200 p-4 sm:p-5 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-semibold text-slate-900">
          Nhân viên
          {schedule.employees.length > 0 && (
            <span className="ml-2 text-sm font-normal text-slate-400">
              {schedule.employees.length}
            </span>
          )}
        </h2>
        <button
          onClick={() => setOffen("new")}
          disabled={locked}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 active:bg-slate-800 disabled:opacity-40"
        >
          + Thêm
        </button>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Hợp đồng nhập theo <b>tháng</b> (hoặc theo tuần nếu người đó ký theo tuần). Giờ được chia cho các
        tuần rồi cho từng ngày theo hệ số ngày đông. Tháng này quán mở <b>{openDays}</b> ngày, mỗi người tối
        đa 6 ngày liên tiếp và 8 giờ công mỗi ngày. Bấm vào một người để sửa.
      </p>

      {locked && (
        <div className="mb-3 rounded bg-amber-50 border border-amber-200 text-amber-900 text-sm px-3 py-2">
          Lịch tháng này đã khoá vì đã in — mở khoá ở tab <b>Bảng chấm công</b> để sửa nhân viên.
        </div>
      )}

      {schedule.employees.length === 0 ? (
        <div className="py-8 text-center text-slate-400">
          Chưa có nhân viên. Bấm <b>+ Thêm</b> để tạo.
        </div>
      ) : (
        <ul className="space-y-2">
          {schedule.employees.map((emp) => (
            <li key={emp.id}>
              <button
                onClick={() => setOffen(emp.id)}
                className="w-full text-left rounded-lg border border-slate-200 p-3 flex items-center gap-3 hover:bg-slate-50 active:bg-slate-100 transition-colors"
              >
                <EmployeeSummaryRow
                  emp={emp}
                  openDates={openDates}
                  workHours={schedule.workHours}
                  sharedWith={partnerLabel(emp)}
                />
                <span className="text-slate-300 text-lg leading-none">›</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!locked && (
        <button
          onClick={() => setOffen("new")}
          aria-label="Thêm nhân viên"
          className="sm:hidden fixed bottom-5 right-5 z-40 h-14 w-14 rounded-full bg-slate-900 text-white text-2xl shadow-lg active:bg-slate-700 flex items-center justify-center"
        >
          +
        </button>
      )}

      {offen !== null && !locked && (
        <EmployeeSheet
          key={bearbeitet?.id ?? "new"}
          employee={bearbeitet}
          others={others}
          partners={currentPartners(rosters, store.storeId, bearbeitet)}
          openDates={openDates}
          workHours={schedule.workHours}
          onClose={() => setOffen(null)}
          onSave={(felder, partners) => {
            if (bearbeitet) {
              updateEmployee(bearbeitet.id, felder);
              saveLinks({ employeeId: bearbeitet.id, name: felder.name, personKey: bearbeitet.personKey }, partners);
            } else {
              const id = addEmployee(felder);
              if (id) saveLinks({ employeeId: id, name: felder.name }, partners);
            }
            setOffen(null);
          }}
          onDelete={
            bearbeitet
              ? () => {
                  removeEmployee(bearbeitet.id);
                  setOffen(null);
                }
              : undefined
          }
        />
      )}
    </section>
  );
}

/** Kompakte Zeile in der Liste: Name, Art, Wochenstunden, Besonderheiten. */
function EmployeeSummaryRow({
  emp,
  openDates,
  workHours,
  sharedWith,
}: {
  emp: Employee;
  openDates: readonly string[];
  workHours: WorkHoursConfig;
  /** Kurznamen der anderen Läden, in denen dieselbe Person arbeitet. */
  sharedWith: string[];
}) {
  const monatMin = monthlyTargetMinutesFor(emp, openDates, workHours);
  const monatH = monatMin / 60;
  const info = splitInfo(monatH, emp.employmentType);

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <span className="font-medium text-slate-900 truncate">{emp.name}</span>
        <span className="shrink-0 rounded bg-slate-100 text-slate-600 text-[11px] px-1.5 py-0.5">
          {employmentShortVi(emp.employmentType)}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
        <span>
          {emp.weeklyHours != null
            ? `${emp.weeklyHours}h/tuần`
            : `${String(Math.round((emp.targetMinutes / 60) * 100) / 100).replace(".", ",")}h/tháng`}{" "}
          · {monatH > 0 ? `${minutesToShortHours(monatMin)} · ` : ""}
          <span className={info.ok ? "" : "text-rose-600"}>{info.text}</span>
        </span>
        {sharedWith.length > 0 ? (
          <span className="rounded bg-sky-50 text-sky-800 px-1.5 py-0.5">cũng làm ở {sharedWith.join(", ")}</span>
        ) : null}
        {emp.requiredOnHolidays ? (
          <span className="rounded bg-amber-50 text-amber-800 px-1.5 py-0.5">trực ngày lễ</span>
        ) : null}
        {emp.fixedShift ? (
          <span className="rounded bg-indigo-50 text-indigo-700 px-1.5 py-0.5">
            ca cố định {minutesToTime(emp.fixedShift.startMinutes)}–
            {minutesToTime(emp.fixedShift.endMinutes)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Ein Blatt zum Anlegen ODER Bearbeiten – auf dem Handy von unten, am Desktop
 * mittig. Alle Felder an einem Ort, statt in der Liste zu suchen.
 */
function EmployeeSheet({
  employee,
  others,
  partners,
  openDates,
  workHours,
  onClose,
  onSave,
  onDelete,
}: {
  employee?: Employee;
  others: readonly OtherStore[];
  partners: PartnerChoice;
  openDates: readonly string[];
  workHours: WorkHoursConfig;
  onClose: () => void;
  onSave: (felder: Omit<Employee, "id">, partners: PartnerChoice) => void;
  onDelete?: () => void;
}) {
  const [d, setD] = useState<Draft>(() => draftFrom(employee, partners));
  const [loeschFrage, setLoeschFrage] = useState(false);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setD((prev) => ({ ...prev, [k]: v }));

  const monatMin = monthlyTargetMinutesFor({ ...draftToEmployee(d), id: employee?.id ?? "preview" }, openDates, workHours);
  const monatH = monatMin / 60;
  const info = splitInfo(monatH, d.employmentType);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-lg bg-white shadow-xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">
            {employee ? "Sửa nhân viên" : "Thêm nhân viên"}
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-3 space-y-4">
          <label className="block">
            <span className="text-xs text-slate-600">Tên</span>
            <input
              autoFocus={!employee}
              className={`${inputClass} w-full mt-1`}
              value={d.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Tên nhân viên"
            />
          </label>

          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs text-slate-600">Hình thức</span>
              <select
                className={`${inputClass} w-full mt-1`}
                value={d.employmentType}
                onChange={(e) => set("employmentType", e.target.value as EmploymentType)}
              >
                <option value="VOLLZEIT">{employmentLabelVi("VOLLZEIT")}</option>
                <option value="TEILZEIT">{employmentLabelVi("TEILZEIT")}</option>
                <option value="MINIJOB">{employmentLabelVi("MINIJOB")}</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-600">Hợp đồng theo</span>
              <select
                className={`${inputClass} w-full mt-1`}
                value={d.unit}
                onChange={(e) => set("unit", e.target.value as Draft["unit"])}
              >
                <option value="month">Tháng</option>
                <option value="week">Tuần</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-600">Số giờ</span>
              <input
                inputMode="decimal"
                className={`${inputClass} w-full mt-1`}
                value={d.hours}
                onChange={(e) => set("hours", e.target.value)}
                placeholder={d.unit === "week" ? "VD 39" : "VD 169"}
              />
            </label>
          </div>
          <div className={`text-xs ${info.ok ? "text-slate-500" : "text-rose-600"}`}>
            Tháng này ≈ <b>{minutesToShortHours(monatMin)}</b> · {info.text}
          </div>

          {/*
            „Nâng cao": selten gebraucht, deshalb eingeklappt. Hat die Person
            schon eine Sonderregel, ist der Block offen – sonst wäre eine aktive
            Einschränkung unsichtbar. Das open-Attribut hängt nur am gespeicherten
            Mitarbeiter (nicht am Entwurf), damit React das Auf-/Zuklappen nicht
            bei jedem Tastendruck zurücksetzt.
          */}
          <details
            open={advancedSummary(draftFrom(employee, partners), others) !== null}
            className="group rounded-lg border border-slate-200"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
              <span>
                Nâng cao
                {advancedSummary(d, others) && (
                  <span className="block text-xs font-normal text-slate-500">{advancedSummary(d, others)}</span>
                )}
              </span>
              <span className="text-slate-400 transition-transform group-open:rotate-90" aria-hidden="true">›</span>
            </summary>
            <div className="space-y-4 border-t border-slate-100 px-3 pb-3 pt-3">
          <div>
            {/* Trực ngày lễ + ca cố định chung một hàng, không ghi chú cho gọn. */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={d.holidayDuty}
                  onChange={(e) => set("holidayDuty", e.target.checked)}
                />
                Trực ngày lễ
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={d.fixed}
                  onChange={(e) => set("fixed", e.target.checked)}
                />
                Ca cố định
              </label>
            </div>

            {d.fixed && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-700">
                <span className="text-xs text-slate-500">Khung giờ</span>
                <input
                  type="time"
                  className={inputClass}
                  value={d.fixedStart}
                  onChange={(e) => set("fixedStart", e.target.value)}
                />
                <span className="text-slate-400">–</span>
                <input
                  type="time"
                  className={inputClass}
                  value={d.fixedEnd}
                  onChange={(e) => set("fixedEnd", e.target.value)}
                />
                {safeMinutes(d.fixedEnd, FIXED_END_DEFAULT) <=
                  safeMinutes(d.fixedStart, FIXED_START_DEFAULT) && (
                  <span className="text-xs text-rose-600">Giờ kết thúc phải sau giờ bắt đầu.</span>
                )}
              </div>
            )}
          </div>

          {/* Ngày làm trong tuần + số ngày/tuần. */}
          <div className="border-t border-slate-100 pt-3">
            <div className="text-xs text-slate-600 mb-1.5">
              Ngày làm trong tuần
              {d.availableWeekdays.length === 0 && (
                <span className="text-slate-400"> — bỏ trống = làm mọi ngày</span>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {WEEKDAY_ORDER.map((key) => {
                const alle = d.availableWeekdays.length === 0;
                const an = alle || d.availableWeekdays.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      const basis = alle ? WEEKDAY_ORDER : d.availableWeekdays;
                      const naechste = basis.includes(key)
                        ? basis.filter((k) => k !== key)
                        : [...basis, key];
                      set("availableWeekdays", naechste);
                    }}
                    className={`rounded px-2 py-1 text-xs border transition-colors ${
                      an
                        ? "bg-slate-800 text-white border-slate-800"
                        : "bg-white text-slate-400 border-slate-200 line-through"
                    }`}
                  >
                    {WEEKDAY_SHORT_VI[key]}
                  </button>
                );
              })}
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
              Số ngày làm mỗi tuần
              <input
                type="number"
                min={1}
                max={7}
                placeholder="—"
                className={`${inputClass} w-16`}
                value={d.maxDays}
                onChange={(e) => set("maxDays", e.target.value)}
              />
              <span className="text-slate-400">bỏ trống = không giới hạn</span>
            </label>
          </div>

          {/* Cùng một người ở quán khác – tạo lịch không xếp hai quán cùng ngày. */}
          {others.length > 0 && (
            <div className="border-t border-slate-100 pt-3">
              <div className="text-xs text-slate-600">Cũng làm ở quán khác</div>
              <div className="mt-2 space-y-2">
                {others.map((o) => (
                  <label key={o.storeId} className="flex items-center gap-2 text-sm text-slate-700">
                    <span className="w-20 shrink-0 text-xs text-slate-600">{o.shortName}</span>
                    <select
                      className={`${inputClass} flex-1 min-w-0`}
                      value={d.partners[o.storeId] ?? ""}
                      disabled={o.locked}
                      onChange={(e) => set("partners", { ...d.partners, [o.storeId]: e.target.value })}
                    >
                      <option value="">— không —</option>
                      {o.employees.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </select>
                    {o.locked && <span className="text-xs text-amber-700">quán này đang khoá</span>}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Ngày vào làm / thôi làm chung một hàng. Bỏ trống = từ đầu tháng / vẫn đang làm. */}
          <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
            {(
              [
                ["startDate", "Ngày vào làm", undefined],
                ["endDate", "Ngày thôi làm", d.startDate || undefined],
              ] as const
            ).map(([key, label, min]) => (
              <label key={key} className="block min-w-0">
                <span className="text-xs text-slate-600">{label}</span>
                <div className="mt-1 flex items-center gap-1">
                  <input
                    type="date"
                    className={`${inputClass} w-full min-w-0`}
                    value={d[key]}
                    min={min}
                    onChange={(e) => set(key, e.target.value)}
                  />
                  {d[key] && (
                    <button
                      type="button"
                      onClick={() => set(key, "")}
                      aria-label={`Xoá ${label.toLowerCase()}`}
                      className="shrink-0 px-1 text-slate-400 hover:text-slate-700"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </label>
            ))}
          </div>
            </div>
          </details>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-slate-200 px-4 py-3">
          {loeschFrage ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-slate-600">Xoá nhân viên này?</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setLoeschFrage(false)}
                  className="rounded px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Không
                </button>
                <button
                  onClick={onDelete}
                  className="rounded bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700"
                >
                  Xoá
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              {onDelete ? (
                <button
                  onClick={() => setLoeschFrage(true)}
                  className="text-rose-600 hover:text-rose-800 text-sm font-medium"
                >
                  Xoá
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="rounded px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                >
                  Huỷ
                </button>
                <button
                  onClick={() => onSave(draftToEmployee(d), d.partners)}
                  className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
                >
                  Lưu
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
