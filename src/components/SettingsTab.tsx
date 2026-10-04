import { useMemo, useState } from "react";
import type { UseScheduleReturn } from "../hooks/useSchedule";
import { minutesToTime, timeToMinutes } from "../lib/time";
import { MONTH_NAMES_VI } from "../lib/dateFormat";
import {
  WEEKDAY_LABELS_VI,
  WEEKDAY_SHORT_VI,
  datesOfMonth,
  parseIsoDate,
  weekdayKeyOf,
  type WeekdayKey,
} from "../lib/demand";
import type { DayBlocks, DayWindow, WorkHoursConfig } from "../lib/workHours";
import { publicHolidayNames } from "../lib/holidays";
import { isoLabel } from "../lib/shiftOps";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-slate-700 mb-1">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";

const timeClass =
  "rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";

const WEEKDAY_ORDER: WeekdayKey[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

/**
 * Eine Zeile je Wochentag – mit BELIEBIG VIELEN Blöcken, damit sich eine
 * Mittagsschließung (Di–Sa 14:30–16:30) eintragen lässt.
 */
function BlockRow({
  label,
  hint,
  blocks,
  onChange,
  closed,
  onToggleClosed,
}: {
  label: string;
  hint?: string;
  blocks: DayBlocks;
  onChange: (next: DayBlocks) => void;
  /** Optional: Schließen-Umschalter (z.B. Montag). */
  closed?: boolean;
  onToggleClosed?: (next: boolean) => void;
}) {
  const setBlock = (i: number, patch: Partial<DayWindow>) =>
    onChange(blocks.map((b, k) => (k === i ? { ...b, ...patch } : b)));

  return (
    <div className="flex items-start gap-2 py-1.5">
      <div className="w-24 sm:w-40 shrink-0 pt-1.5">
        <div className="text-sm text-slate-700 leading-tight">{label}</div>
        {hint && <div className="text-[11px] text-slate-400">{hint}</div>}
      </div>

      {closed ? (
        <div className="flex-1 pt-1.5 text-sm font-medium text-rose-600">Đóng cửa</div>
      ) : (
        <div className="flex-1 space-y-1">
          {blocks.map((b, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="time"
                className={`${timeClass} min-w-0 flex-1 sm:flex-none`}
                value={minutesToTime(b.startMinutes)}
                onChange={(e) => {
                  try {
                    setBlock(i, { startMinutes: timeToMinutes(e.target.value) });
                  } catch {
                    /* nhập chưa xong */
                  }
                }}
              />
              <span className="text-slate-400">–</span>
              <input
                type="time"
                className={`${timeClass} min-w-0 flex-1 sm:flex-none`}
                value={minutesToTime(b.endMinutes)}
                onChange={(e) => {
                  try {
                    setBlock(i, { endMinutes: timeToMinutes(e.target.value) });
                  } catch {
                    /* nhập chưa xong */
                  }
                }}
              />
              {blocks.length > 1 && (
                <button
                  type="button"
                  onClick={() => onChange(blocks.filter((_, k) => k !== i))}
                  className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
                  title="Xoá khung này"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              onChange([
                ...blocks,
                { startMinutes: blocks[blocks.length - 1]?.endMinutes ?? 0, endMinutes: 22 * 60 },
              ])
            }
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            + Thêm khung giờ
          </button>
        </div>
      )}
      {onToggleClosed && (
        <label className="flex items-center gap-1 text-[11px] text-slate-500 shrink-0 ml-1">
          <input
            type="checkbox"
            checked={!!closed}
            onChange={(e) => onToggleClosed(e.target.checked)}
          />
          Nghỉ
        </label>
      )}
    </div>
  );
}

export function SettingsTab({ store }: { store: UseScheduleReturn }) {
  const { schedule, updateMeta, upsertOverride, removeOverride, changePassword } = store;

  // ---- Ngày đặc biệt (Ausnahmen) ----
  const monthDates = useMemo(
    () => datesOfMonth(schedule.year, schedule.month),
    [schedule.year, schedule.month],
  );
  const [ovDate, setOvDate] = useState<string>("");
  const [ovMode, setOvMode] = useState<"closed" | "custom">("closed");
  const [ovStart, setOvStart] = useState("11:30");
  const [ovEnd, setOvEnd] = useState("15:00");
  const [ovNote, setOvNote] = useState("");

  const effectiveOvDate = ovDate || monthDates[0];

  function addOverride() {
    if (!effectiveOvDate) return;
    if (ovMode === "closed") {
      upsertOverride({ date: effectiveOvDate, closed: true, note: ovNote.trim() || undefined });
    } else {
      try {
        upsertOverride({
          date: effectiveOvDate,
          closed: false,
          window: { startMinutes: timeToMinutes(ovStart), endMinutes: timeToMinutes(ovEnd) },
          note: ovNote.trim() || undefined,
        });
      } catch {
        return;
      }
    }
    setOvNote("");
  }

  function setWeekdayWindow(key: WeekdayKey, next: DayBlocks) {
    const workHours: WorkHoursConfig = {
      ...schedule.workHours,
      perWeekday: { ...schedule.workHours.perWeekday, [key]: next },
    };
    updateMeta({ workHours });
  }

  function setHolidayWindow(next: DayBlocks) {
    updateMeta({ workHours: { ...schedule.workHours, holiday: next } });
  }

  function setWeekdayClosed(key: WeekdayKey, closed: boolean) {
    const workHours: WorkHoursConfig = {
      ...schedule.workHours,
      closedWeekdays: { ...schedule.workHours.closedWeekdays, [key]: closed },
    };
    updateMeta({ workHours });
  }

  const overridesByDate = useMemo(
    () => new Map(schedule.dateOverrides.map((o) => [o.date, o] as const)),
    [schedule.dateOverrides],
  );

  // Feiertage (Bayern) im gewählten Monat.
  const holidaysThisMonth = useMemo(() => {
    const names = publicHolidayNames(schedule.year);
    const monthDates = new Set(datesOfMonth(schedule.year, schedule.month));
    return [...names.entries()]
      .filter(([iso]) => monthDates.has(iso))
      .sort(([a], [b]) => a.localeCompare(b));
  }, [schedule.year, schedule.month]);

  return (
    <div className="space-y-4 max-w-3xl">
      <section className="rounded-lg bg-white border border-slate-200 p-4 sm:p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Cài đặt chung</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Field label="Cửa hàng">
              <div className="w-full rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                {schedule.companyName}
              </div>
            </Field>
          </div>

          <div className="md:col-span-2">
            <Field label="Địa chỉ (in trên tờ chấm công)">
              <div className="w-full rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                {schedule.address}
              </div>
            </Field>
          </div>

          <div className="md:col-span-2 text-xs text-slate-500">
            Tháng/năm chọn chung cho mọi quán ở thanh trên cùng — bản in của hai quán phải cùng kỳ.
          </div>
        </div>
      </section>

      {/* „Nâng cao": khung giờ từng thứ ít khi đổi – thu gọn mặc định, bấm để mở. */}
      <details className="group rounded-lg bg-white border border-slate-200 shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg p-4 sm:p-5 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
          <h2 className="text-base font-semibold text-slate-900">Nâng cao · Giờ làm theo ngày</h2>
          <span className="text-lg text-slate-400 transition-transform group-open:rotate-90" aria-hidden="true">›</span>
        </summary>
        <div className="border-t border-slate-100 p-4 sm:p-5">
        <p className="text-xs text-slate-500 mb-3">
          Đây là <span className="font-medium">khung giờ làm</span> (giờ xếp ca) cho mỗi ngày trong
          tuần. Ca sáng bắt đầu ở đầu khung, ca tối kết thúc ở cuối khung — có thể khác giờ mở cửa cho
          khách.
        </p>

        {/* Chọn nhanh: số ngày + các ngày làm trong tuần. Bấm để bật/tắt. */}
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="text-sm font-medium text-slate-700 mb-2">Ngày làm trong tuần</div>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_ORDER.map((key) => {
              const open = !schedule.workHours.closedWeekdays?.[key];
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={open}
                  onClick={() => setWeekdayClosed(key, open)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium border transition-colors ${
                    open
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-300 bg-white text-slate-400 line-through"
                  }`}
                >
                  {WEEKDAY_SHORT_VI[key]}
                </button>
              );
            })}
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Mở{" "}
            <b>
              {WEEKDAY_ORDER.filter((k) => !schedule.workHours.closedWeekdays?.[k]).length} ngày/tuần
            </b>{" "}
            · bấm vào thứ để bật/tắt ngày làm. Định mức tháng tự tính lại theo số ngày mở.
          </div>
        </div>

        <div>
          {WEEKDAY_ORDER.map((key) => (
            <BlockRow
              key={key}
              label={WEEKDAY_LABELS_VI[key]}
              blocks={schedule.workHours.perWeekday[key]}
              onChange={(next) => setWeekdayWindow(key, next)}
              closed={schedule.workHours.closedWeekdays?.[key]}
              onToggleClosed={(next) => setWeekdayClosed(key, next)}
            />
          ))}
          <div className="my-2 border-t border-slate-200" />
          <BlockRow
            label="Ngày lễ"
            hint="Tự áp dụng cho ngày lễ Baden-Württemberg"
            blocks={schedule.workHours.holiday}
            onChange={setHolidayWindow}
          />
        </div>

        {holidaysThisMonth.length > 0 && (
          <div className="mt-3 rounded bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
            <div className="font-medium mb-1">
              Ngày lễ Baden-Württemberg trong {MONTH_NAMES_VI[schedule.month - 1]} {schedule.year}:
            </div>
            <ul className="space-y-1">
              {holidaysThisMonth.map(([iso, name]) => {
                const ov = overridesByDate.get(iso);
                return (
                  <li key={iso} className="flex items-center gap-2 flex-wrap">
                    <span>
                      {isoLabel(iso)} — {name}
                    </span>
                    {ov?.closed ? (
                      <span className="text-rose-600 font-medium">· đã đóng cửa</span>
                    ) : (
                      <button
                        onClick={() =>
                          upsertOverride({ date: iso, closed: true, note: name })
                        }
                        className="rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] text-amber-800 hover:bg-amber-100"
                      >
                        Đóng cửa ngày này
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        </div>
      </details>

      {/* Ngày đặc biệt: thu gọn như Nâng cao; số ngày đã đặt hiện ngay trên tiêu đề. */}
      <details className="group rounded-lg bg-white border border-slate-200 shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg p-4 sm:p-5 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
          <h2 className="text-base font-semibold text-slate-900">Ngày đặc biệt
            {schedule.dateOverrides.length > 0 && (
              <span className="ml-2 text-sm font-normal text-slate-500">({schedule.dateOverrides.length} ngày)</span>
            )}</h2>
          <span className="text-lg text-slate-400 transition-transform group-open:rotate-90" aria-hidden="true">›</span>
        </summary>
        <div className="border-t border-slate-100 p-4 sm:p-5">
        <p className="text-xs text-slate-500 mb-3">
          Cài đặt riêng cho một ngày cụ thể: <span className="font-medium">đóng cửa cả ngày</span> hoặc
          <span className="font-medium"> giờ làm riêng</span> (VD nghỉ nửa ngày). Sẽ ghi đè giờ theo thứ
          và ngày lễ khi tạo lịch.
        </p>

        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3 rounded bg-slate-50 border border-slate-200 p-3">
          <label className="flex flex-col sm:w-40">
            <span className="text-xs text-slate-600 mb-1">Ngày</span>
            <input
              type="date"
              className={`${timeClass} w-full`}
              min={monthDates[0]}
              max={monthDates[monthDates.length - 1]}
              value={effectiveOvDate}
              onChange={(e) => setOvDate(e.target.value)}
            />
          </label>
          <label className="flex flex-col sm:w-44">
            <span className="text-xs text-slate-600 mb-1">Kiểu</span>
            <select
              className={`${timeClass} w-full`}
              value={ovMode}
              onChange={(e) => setOvMode(e.target.value as "closed" | "custom")}
            >
              <option value="closed">Đóng cửa cả ngày</option>
              <option value="custom">Giờ làm riêng</option>
            </select>
          </label>
          {ovMode === "custom" && (
            <label className="flex flex-col">
              <span className="text-xs text-slate-600 mb-1">Giờ làm</span>
              <div className="flex items-center gap-1">
                <input
                  type="time"
                  className={`${timeClass} min-w-0 flex-1 sm:flex-none`}
                  value={ovStart}
                  onChange={(e) => setOvStart(e.target.value)}
                />
                <span className="text-slate-400">–</span>
                <input
                  type="time"
                  className={`${timeClass} min-w-0 flex-1 sm:flex-none`}
                  value={ovEnd}
                  onChange={(e) => setOvEnd(e.target.value)}
                />
              </div>
            </label>
          )}
          <label className="flex flex-col sm:grow sm:min-w-[140px]">
            <span className="text-xs text-slate-600 mb-1">Ghi chú (tuỳ chọn)</span>
            <input
              className={`${timeClass} w-full`}
              value={ovNote}
              onChange={(e) => setOvNote(e.target.value)}
              placeholder="VD: nghỉ nửa ngày"
            />
          </label>
          <button
            onClick={addOverride}
            className="rounded bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700 active:bg-slate-800"
          >
            Lưu ngày này
          </button>
        </div>

        {schedule.dateOverrides.length > 0 ? (
          <ul className="mt-3 divide-y divide-slate-100">
            {schedule.dateOverrides.map((ov) => {
              const wd = WEEKDAY_SHORT_VI[weekdayKeyOf(parseIsoDate(ov.date))];
              return (
                <li key={ov.date} className="flex items-center gap-2 py-2 text-sm flex-wrap">
                  <span className="font-medium w-28">
                    {isoLabel(ov.date)} ({wd})
                  </span>
                  {ov.closed ? (
                    <span className="text-rose-600 font-medium">Đóng cửa</span>
                  ) : (
                    <span className="text-slate-700">
                      {minutesToTime(ov.window!.startMinutes)}–{minutesToTime(ov.window!.endMinutes)}
                    </span>
                  )}
                  {ov.note && <span className="text-slate-400">· {ov.note}</span>}
                  <button
                    onClick={() => {
                      setOvDate(ov.date);
                      setOvMode(ov.closed ? "closed" : "custom");
                      if (ov.window) {
                        setOvStart(minutesToTime(ov.window.startMinutes));
                        setOvEnd(minutesToTime(ov.window.endMinutes));
                      }
                      setOvNote(ov.note ?? "");
                    }}
                    className="ml-auto text-slate-500 hover:text-slate-800"
                  >
                    Sửa
                  </button>
                  <button
                    onClick={() => removeOverride(ov.date)}
                    className="text-rose-600 hover:text-rose-800"
                  >
                    Xoá
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-slate-400">Chưa có ngày đặc biệt nào.</p>
        )}
        </div>
      </details>

      <PasswordSection onChange={changePassword} />
    </div>
  );
}

/**
 * Passwort der Filiale ändern.
 *
 * Steht in den Einstellungen, weil es zum Laden gehört und nicht zu einem
 * einzelnen Monat. Das alte Passwort wird abgefragt, damit nicht jeder, der
 * gerade vor dem offenen Tablet steht, die Filiale aussperren kann.
 */
function PasswordSection({
  onChange,
}: {
  onChange: (alt: string, neu: string) => Promise<string | null>;
}) {
  const [alt, setAlt] = useState("");
  const [neu, setNeu] = useState("");
  const [wieder, setWieder] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [fertig, setFertig] = useState(false);
  const [laeuft, setLaeuft] = useState(false);

  async function absenden(e: React.FormEvent) {
    e.preventDefault();
    setFehler(null);
    setFertig(false);
    if (neu !== wieder) {
      setFehler("Hai ô mật khẩu mới không giống nhau.");
      return;
    }
    setLaeuft(true);
    const problem = await onChange(alt, neu);
    setLaeuft(false);
    if (problem) {
      setFehler(problem);
      return;
    }
    setAlt("");
    setNeu("");
    setWieder("");
    setFertig(true);
  }

  return (
    <details className="group rounded-lg bg-white border border-slate-200 shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg p-4 sm:p-5 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        <h2 className="text-base font-semibold text-slate-900">Mật khẩu vào ứng dụng</h2>
        <span className="text-lg text-slate-400 transition-transform group-open:rotate-90" aria-hidden="true">›</span>
      </summary>
      <div className="border-t border-slate-100 p-4 sm:p-5">

      <form onSubmit={absenden} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col sm:w-44">
          <span className="text-xs text-slate-600 mb-1">Mật khẩu hiện tại</span>
          <input
            type="password"
            autoComplete="current-password"
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            className={`${inputClass} w-full`}
          />
        </label>
        <label className="flex flex-col sm:w-44">
          <span className="text-xs text-slate-600 mb-1">Mật khẩu mới</span>
          <input
            type="password"
            autoComplete="new-password"
            value={neu}
            onChange={(e) => setNeu(e.target.value)}
            className={`${inputClass} w-full`}
          />
        </label>
        <label className="flex flex-col sm:w-44">
          <span className="text-xs text-slate-600 mb-1">Nhập lại mật khẩu mới</span>
          <input
            type="password"
            autoComplete="new-password"
            value={wieder}
            onChange={(e) => setWieder(e.target.value)}
            className={`${inputClass} w-full`}
          />
        </label>
        <button
          type="submit"
          disabled={laeuft || !alt || !neu}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
        >
          {laeuft ? "Đang lưu…" : "Đổi mật khẩu"}
        </button>
      </form>

      {fehler && <p className="mt-2 text-sm text-rose-600">{fehler}</p>}
      {fertig && <p className="mt-2 text-sm text-emerald-700">Đã đổi mật khẩu.</p>}
      </div>
    </details>
  );
}
