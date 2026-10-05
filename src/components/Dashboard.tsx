import { useMemo, useState } from "react";
import type { UseScheduleReturn } from "../hooks/useSchedule";
import type { Employee, Schedule } from "../types";
import { minutesToDecimalHours } from "../lib/time";
import { monthlyTargetMinutesFor } from "../lib/contract";
import { RULES, ruleById } from "../lib/rules";
import { findFixes, issuesOf, type EmployeeChange, type FixResult, type Score, type TrialStore } from "../lib/suggestions";

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
    // „Bỏ qua cảnh báo" gilt nur für fehlende Vertragsstunden.
    warnungen: accepted ? alleWarnungen.filter((w) => w.rule !== "contract-hours") : alleWarnungen,
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
  onApplyFixes,
}: {
  stores: readonly UseScheduleReturn[];
  view: UseScheduleReturn;
  onChooseStore: (storeId: string) => void;
  /** „Áp dụng" eines Vorschlags: Einstellungen ändern und alle Läden neu planen. */
  onApplyFixes: (changes: EmployeeChange[]) => void;
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

      <StoreNotes store={view} stores={stores} onApplyFixes={onApplyFixes} />
    </div>
  );
}

const trialStoreOf = (store: UseScheduleReturn): TrialStore => ({
  storeId: store.storeId,
  shortName: store.storeConfig.shortName,
  schedule: store.schedule,
  rules: store.storeConfig.staffingRules,
  weights: store.storeConfig.dayWeights,
});

/**
 * Hinweise für den gewählten Laden, getrennt nach „Luật cứng" (rot) und
 * „Luật mềm" (gelb, nach Regel gruppiert), dazu „Tìm cách xếp khác".
 */
function StoreNotes({
  store,
  stores,
  onApplyFixes,
}: {
  store: UseScheduleReturn;
  stores: readonly UseScheduleReturn[];
  onApplyFixes: (changes: EmployeeChange[]) => void;
}) {
  const { schedule } = store;
  const { notGenerated, alleWarnungen, accepted } = storeFigures(store);
  const byId = new Map(schedule.employees.map((e) => [e.id, e] as const));
  const name = store.storeConfig.shortName;

  const { issues } = useMemo(() => issuesOf(trialStoreOf(store), schedule.shifts), [store, schedule.shifts]);
  // „Bỏ qua cảnh báo" nach Tạo lịch: fehlende Stunden nicht mehr anzeigen.
  const shown = issues.filter((issue) => !(accepted && issue.rule === "contract-hours"));
  const hard = shown.filter((issue) => issue.hard);
  const soft = shown.filter((issue) => !issue.hard);
  const softGroups = RULES.filter((rule) => rule.kind === "soft")
    .map((rule) => ({ rule, items: soft.filter((issue) => issue.rule === rule.id) }))
    .filter((group) => group.items.length > 0);
  const hasPlan = schedule.shifts.length > 0;

  return (
    <div>
      {notGenerated && schedule.employees.length > 0 && (
        <div className="mt-2 rounded bg-sky-50 border border-sky-200 text-sky-800 text-sm px-3 py-2">
          {name}: chưa có lịch — bấm Tạo lịch.
        </div>
      )}

      {hasPlan && hard.length > 0 && (
        <InfoNote tone="error" summary={`${name}: ${hard.length} lỗi luật cứng — cần sửa`}>
          <ul className="space-y-1.5">
            {hard.map((issue, i) => (
              <li key={i}>
                <span className="mr-1 rounded bg-rose-100 px-1 text-[11px] font-medium">{ruleById(issue.rule).title}</span>
                {issue.message}
              </li>
            ))}
          </ul>
        </InfoNote>
      )}

      {accepted && alleWarnungen.length > 0 && hasPlan && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span>{name}: đã bỏ qua {alleWarnungen.filter((w) => w.rule === "contract-hours").length} cảnh báo thiếu giờ định mức.</span>
          <button
            type="button"
            onClick={() => store.updateMeta({ underQuotaAccepted: undefined })}
            className="underline hover:text-slate-700"
          >
            Hiện lại
          </button>
        </div>
      )}

      {hasPlan && soft.length > 0 && (
        <InfoNote
          tone="warning"
          summary={`${name}: ${soft.length} chỗ chưa đạt luật mềm (lịch vẫn dùng được) — ${softGroups
            .map((g) => `${g.rule.title.toLowerCase()} ${g.items.length}`)
            .join(" · ")}`}
        >
          <div className="space-y-3">
            {softGroups.map(({ rule, items }) => (
              <div key={rule.id}>
                <div className="font-semibold">
                  {rule.title} <span className="font-normal opacity-70">({items.length})</span>
                </div>
                <ul className="mt-1 space-y-1.5">
                  {items.slice(0, 12).map((issue, i) => {
                    const emp = issue.employeeId ? byId.get(issue.employeeId) : undefined;
                    return (
                      <li key={i}>
                        <div>{issue.message}</div>
                        {rule.id === "contract-hours" && (
                          <div className="opacity-80">→ Vì sao: {underQuotaReason(emp, schedule)}</div>
                        )}
                      </li>
                    );
                  })}
                  {items.length > 12 && <li className="opacity-70">… và {items.length - 12} chỗ nữa</li>}
                </ul>
              </div>
            ))}
          </div>
        </InfoNote>
      )}

      {hasPlan && (hard.length > 0 || soft.length > 0) && (
        <FixFinder stores={stores} onApply={onApplyFixes} month={`${schedule.month}/${schedule.year}`} />
      )}

      <RulesList />
    </div>
  );
}

const scoreText = (score: Score) =>
  `${score.hard} lỗi luật cứng · thiếu ${minutesToDecimalHours(score.missingMinutes, 1)} h định mức · ${score.soft} chỗ luật mềm`;

/** „Tìm cách xếp khác": Probe-Pläne mit kleinen Änderungen, nur Verbesserungen mit „Áp dụng". */
function FixFinder({
  stores,
  onApply,
  month,
}: {
  stores: readonly UseScheduleReturn[];
  onApply: (changes: EmployeeChange[]) => void;
  month: string;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [result, setResult] = useState<FixResult | null>(null);

  const run = async () => {
    setBusy(true);
    setResult(null);
    await new Promise((resolve) => setTimeout(resolve, 0)); // Knopf zuerst neu zeichnen
    const found = await findFixes(stores.map(trialStoreOf), (done, total) => setProgress([done, total]));
    setResult(found);
    setBusy(false);
    setProgress(null);
  };

  return (
    <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[12rem] text-sm text-emerald-900">
          <b>Tìm cách xếp khác:</b> app thử nới từng thiết lập của nhân viên (ngày nghỉ cố định, số ngày/tuần, độ
          dài ca, khung giờ, người làm 2 quán), tạo lịch thử cả {stores.length} quán và chỉ gợi ý cách nào tốt hơn.
        </div>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {busy ? `Đang thử${progress ? ` ${progress[0]}/${progress[1]}` : ""}…` : "Tìm cách xếp khác"}
        </button>
      </div>

      {result && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-slate-600">Tạo lại lịch theo thiết lập hiện tại: {scoreText(result.baseline)}.</p>
          {result.options.length === 0 ? (
            <p className="text-sm text-slate-700">
              Đã thử nới thiết lập từng người: không cách nào tốt hơn. Cần đổi ở mức quán — thêm giờ mở cửa (Cài
              đặt), thêm người, hoặc giảm giờ hợp đồng — hoặc bấm „Bỏ qua cảnh báo" nếu chấp nhận.
            </p>
          ) : (
            <ul className="space-y-2">
              {result.options.map((option) => {
                const text = option.changes.map((c) => c.label).join(" + ");
                return (
                  <li
                    key={text}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2"
                  >
                    <div className="flex-1 min-w-[12rem] text-sm">
                      <div className="font-medium text-slate-900">{text}</div>
                      <div className="text-xs text-slate-600">Sau khi đổi: {scoreText(option.score)}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (!window.confirm(`Áp dụng: ${text}\n\nThiết lập nhân viên sẽ đổi và lịch tháng ${month} của cả ${stores.length} quán được tạo lại. Các ca sửa tay trong tháng sẽ bị thay.`)) return;
                        onApply(option.changes);
                        setResult(null);
                      }}
                      className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
                    >
                      Áp dụng
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Welche Regeln hart, welche weich – zum Nachlesen. */
function RulesList() {
  return (
    <details className="mt-2 rounded-lg border border-slate-200 bg-white text-sm">
      <summary className="cursor-pointer px-3 py-2 text-slate-600">
        Luật xếp lịch: <b className="text-slate-900">{RULES.filter((r) => r.kind === "hard").length} luật cứng</b> ·{" "}
        <b className="text-slate-900">{RULES.filter((r) => r.kind === "soft").length} luật mềm</b>
      </summary>
      <div className="grid gap-3 border-t border-slate-100 px-3 py-2 sm:grid-cols-2">
        {(["hard", "soft"] as const).map((kind) => (
          <div key={kind}>
            <div className={`font-semibold ${kind === "hard" ? "text-rose-700" : "text-amber-700"}`}>
              {kind === "hard" ? "Luật cứng — app không bao giờ phá" : "Luật mềm — xếp theo khi được, không được thì báo"}
            </div>
            <ul className="mt-1 space-y-1">
              {RULES.filter((r) => r.kind === kind).map((r) => (
                <li key={r.id}>
                  <b>{r.title}.</b> <span className="text-slate-600">{r.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}
