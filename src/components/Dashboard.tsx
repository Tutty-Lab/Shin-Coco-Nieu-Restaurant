import { useState } from "react";
import type { UseScheduleReturn } from "../hooks/useSchedule";
import type { Employee, Schedule } from "../types";
import { minutesToDecimalHours } from "../lib/time";
import { monthlyTargetMinutesFor } from "../lib/contract";

function Stat({
  label,
  value,
  accent,
  detail,
  detailOnPhone = false,
}: {
  label: string;
  value: string;
  accent?: string;
  /** Kleine Zeile darunter, z. B. die Aufteilung je Laden. */
  detail?: React.ReactNode;
  /** Auf dem Handy nur zeigen, wo sie nötig ist – sonst wird die Kachel zu hoch. */
  detailOnPhone?: boolean;
}) {
  return (
    <div className="rounded-lg bg-white border border-slate-200 px-2.5 py-1.5 sm:px-3 sm:py-2 shadow-sm">
      <div className="text-[11px] sm:text-xs text-slate-500 leading-tight">{label}</div>
      <div className={`text-base sm:text-lg font-semibold leading-tight ${accent ?? "text-slate-900"}`}>
        {value}
      </div>
      {detail && (
        <div className={`mt-0.5 text-[11px] leading-tight text-slate-400 ${detailOnPhone ? "" : "hidden sm:block"}`}>
          {detail}
        </div>
      )}
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

/** Kennzahlen EINES Ladens – Grundlage für die Summen und für die Hinweise. */
function storeFigures(store: UseScheduleReturn) {
  const { schedule, validation, openDates } = store;
  // Wochenverträge (weeklyHours) haben targetMinutes = 0; das Monats-Soll wird
  // erst über die offenen Tage abgeleitet (contract.ts), genau wie in der Prüfung.
  const targetMin = schedule.employees.reduce((s, e) => s + monthlyTargetMinutesFor(e, openDates, schedule.workHours), 0);
  const plannedMin = schedule.shifts.reduce((s, x) => s + x.paidMinutes, 0);
  // Warnungen und Fehler getrennt: ein zu hohes Monats-Soll macht den Plan nicht
  // unbrauchbar, es fehlen nur Stunden, die der Monat nicht hergibt.
  const alleWarnungen = validation.errors.filter((e) => e.severity === "warning");
  // Vom Chủ quán im Popup nach „Tạo lịch" bewusst übergangen -> nicht mehr anzeigen.
  const accepted = schedule.underQuotaAccepted === true;
  return {
    targetMin,
    plannedMin,
    uncoveredMin: Math.max(0, targetMin - plannedMin),
    notGenerated: schedule.shifts.length === 0,
    alleWarnungen,
    accepted,
    warnungen: accepted ? [] : alleWarnungen,
    fehler: validation.errors.filter((e) => e.severity !== "warning"),
  };
}

const hours = (min: number) => `${minutesToDecimalHours(min, 1)} h`;
/** Aufteilung je Laden: ganze Stunden reichen und halten die Zeile kurz. */
const roundHours = (min: number) => `${minutesToDecimalHours(min, 0)} h`;

/**
 * Kennzahlen als SUMME aller Läden („Tạo lịch" plant alle zusammen), darunter
 * je Laden aufgeteilt. Die Hinweise darunter gelten für den gewählten Laden;
 * ein Klick auf einen Laden im Prüfstatus wechselt dorthin.
 */
export function Dashboard({
  stores,
  view,
  onChooseStore,
}: {
  stores: readonly UseScheduleReturn[];
  view: UseScheduleReturn;
  onChooseStore: (storeId: string) => void;
}) {
  const figures = stores.map((s) => ({ store: s, f: storeFigures(s) }));
  const sum = (pick: (f: ReturnType<typeof storeFigures>) => number) => figures.reduce((t, x) => t + pick(x.f), 0);
  const perStore = (text: (x: (typeof figures)[number]) => string) =>
    figures.map((x) => `${x.store.storeConfig.shortName} ${text(x)}`).join(" · ");

  const allEmployees = stores.flatMap((s) => s.schedule.employees);
  // Wer in mehreren Läden arbeitet (gleicher personKey), ist EIN Mensch.
  const people = new Set(
    stores.flatMap((s) => s.schedule.employees.map((e) => e.personKey || `${s.storeId}:${e.id}`)),
  ).size;
  const sharedPeople = allEmployees.length - people;
  const countType = (type: Employee["employmentType"]) => allEmployees.filter((e) => e.employmentType === type).length;

  const targetMin = sum((f) => f.targetMin);
  const plannedMin = sum((f) => f.plannedMin);
  const uncoveredMin = sum((f) => f.uncoveredMin);
  const fehlerCount = sum((f) => f.fehler.length);
  const warnCount = sum((f) => f.warnungen.length);
  const notGeneratedCount = figures.filter((x) => x.f.notGenerated && x.store.schedule.employees.length > 0).length;

  const statusValue =
    notGeneratedCount === stores.length
      ? "Chưa tạo lịch"
      : fehlerCount > 0
        ? `${fehlerCount} lỗi`
        : warnCount > 0
          ? `${warnCount} cảnh báo`
          : notGeneratedCount > 0
            ? `${notGeneratedCount} quán chưa có lịch`
            : "Hợp lệ";
  const statusAccent =
    notGeneratedCount === stores.length
      ? "text-slate-500"
      : fehlerCount > 0
        ? "text-rose-600"
        : warnCount > 0 || notGeneratedCount > 0
          ? "text-amber-600"
          : "text-emerald-600";

  // Je Laden ein Kurzstatus zum Antippen – so sieht man, WO das Problem liegt.
  const storeStatus = figures.map(({ store, f }) => {
    const [text, cls] = f.notGenerated
      ? ["chưa tạo", "text-slate-400"]
      : f.fehler.length > 0
        ? [`${f.fehler.length} lỗi`, "text-rose-600"]
        : f.warnungen.length > 0
          ? [`${f.warnungen.length} cảnh báo`, "text-amber-600"]
          : ["ổn", "text-emerald-600"];
    return (
      <button
        key={store.storeId}
        type="button"
        onClick={() => onChooseStore(store.storeId)}
        className={`underline-offset-2 hover:underline ${store.storeId === view.storeId ? "font-semibold" : ""}`}
      >
        {store.storeConfig.shortName} <span className={cls}>{text}</span>
      </button>
    );
  });

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
        <Stat
          label="Số nhân viên"
          value={String(people)}
          detailOnPhone
          detail={
            <>
              {perStore((x) => String(x.store.schedule.employees.length))}
              {sharedPeople > 0 && <> · {sharedPeople} người làm nhiều quán</>}
            </>
          }
        />
        <Stat label="Toàn thời gian" value={String(countType("VOLLZEIT"))} />
        <Stat label="Bán thời gian" value={String(countType("TEILZEIT"))} />
        <Stat label="Minijob" value={String(countType("MINIJOB"))} />
        <Stat label="Tổng giờ định mức" value={hours(targetMin)} detail={perStore((x) => roundHours(x.f.targetMin))} />
        <Stat label="Tổng giờ đã xếp" value={hours(plannedMin)} detail={perStore((x) => roundHours(x.f.plannedMin))} />
        <Stat
          label="Giờ chưa thể xếp"
          value={hours(uncoveredMin)}
          accent={uncoveredMin ? "text-amber-600" : "text-emerald-600"}
          detail={perStore((x) => roundHours(x.f.uncoveredMin))}
        />
        <Stat
          label="Trạng thái kiểm tra"
          value={statusValue}
          accent={statusAccent}
          detailOnPhone
          detail={<span className="flex flex-wrap gap-x-2">{storeStatus}</span>}
        />
      </div>

      <StoreNotes store={view} />
    </div>
  );
}

/** Hinweise (Fehler, fehlende Stunden, Spitzenzeiten) für den gewählten Laden. */
function StoreNotes({ store }: { store: UseScheduleReturn }) {
  const { schedule, peakGaps } = store;
  const { notGenerated, fehler, warnungen, alleWarnungen, accepted } = storeFigures(store);
  const byId = new Map(schedule.employees.map((e) => [e.id, e] as const));
  const name = store.storeConfig.shortName;

  return (
    <div>
      {notGenerated && schedule.employees.length > 0 && (
        <div className="mt-2 rounded bg-sky-50 border border-sky-200 text-sky-800 text-sm px-3 py-2">
          {name}: chưa có lịch — bấm Tạo lịch.
        </div>
      )}

      {/* Lỗi: gộp sau nút (i). */}
      {fehler.length > 0 && (
        <InfoNote tone="error" summary={`${name}: ${fehler.length} lỗi cần sửa trước khi dùng lịch`}>
          <ul className="space-y-1">
            {fehler.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        </InfoNote>
      )}

      {accepted && alleWarnungen.length > 0 && schedule.shifts.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span>{name}: đã bỏ qua {alleWarnungen.length} cảnh báo thiếu giờ định mức.</span>
          <button
            type="button"
            onClick={() => store.updateMeta({ underQuotaAccepted: undefined })}
            className="underline hover:text-slate-700"
          >
            Hiện lại
          </button>
        </div>
      )}

      {/* Cảnh báo thiếu giờ: một dòng + (i) mở chi tiết vì sao từng người. */}
      {warnungen.length > 0 && schedule.shifts.length > 0 && (
        <InfoNote tone="warning" summary={`${name}: ${warnungen.length} người chưa đủ giờ định mức (lịch vẫn dùng được)`}>
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
        <InfoNote tone="warning" summary={`${name}: ${peakGaps.length} ngày lệch số người ở giờ cao điểm`}>
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
