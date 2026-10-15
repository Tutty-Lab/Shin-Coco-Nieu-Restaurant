import { useMemo, useState } from "react";
import type { UseScheduleReturn } from "../hooks/useSchedule";
import type { Employee } from "../types";
import { minutesToDecimalHours } from "../lib/time";
import { monthlyTargetMinutesFor } from "../lib/contract";
import { RULES, ruleById, staffingRuleId } from "../lib/rules";
import { explainShortfall } from "../lib/shortfall";
import { findFixes, issuesOf, type EmployeeChange, type FixResult, type Score, type TrialStore } from "../lib/suggestions";

/** Eine Zeile je Warnungsart im Popup; Klick klappt die Einzelheiten auf. */
function WarningGroup({ title, cls, children }: { title: string; cls: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="border-t border-slate-100 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className={`text-sm font-semibold ${cls}`}>{title}</span>
        <span className="text-slate-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="px-4 pb-3 text-sm text-slate-700">{children}</div>}
    </section>
  );
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
  // Trong giờ mở / chốt ca 15:00 & 22:00 không có ai (luật cứng „closing").
  // Lịch vẫn được tạo; trạng thái báo thành cảnh báo thay vì „Hợp lệ".
  const emptyGaps = schedule.shifts.length === 0
    ? 0
    : store.analysis.peakViolations.reduce(
        (n, day) => n + day.peaks.filter((p) => !p.ok && p.minStaff < p.required && staffingRuleId(p.label) === "closing").length,
        0,
      );
  return {
    emptyGaps,
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

  const targetMin = sum((f) => f.targetMin);
  const plannedMin = sum((f) => f.plannedMin);
  const uncoveredMin = sum((f) => f.uncoveredMin);
  const fehlerCount = sum((f) => f.fehler.length);
  const warnCount = sum((f) => f.warnungen.length);
  const gapCount = sum((f) => f.emptyGaps);
  const notGeneratedCount = figures.filter((x) => x.f.notGenerated && x.store.schedule.employees.length > 0).length;

  const statusValue =
    notGeneratedCount === stores.length
      ? "Chưa tạo lịch"
      : fehlerCount > 0
        ? `${fehlerCount} lỗi`
        : gapCount > 0
          ? `⚠ ${gapCount} chỗ trống người`
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
        : gapCount > 0 || warnCount > 0 || notGeneratedCount > 0
          ? "text-amber-600"
          : "text-emerald-600";

  // Je Laden ein Kurzstatus zum Antippen – so sieht man, WO das Problem liegt.
  const storeStatus = figures.map(({ store, f }) => {
    const [text, cls] = f.notGenerated
      ? ["chưa tạo", "text-slate-400"]
      : f.fehler.length > 0
        ? [`${f.fehler.length} lỗi`, "text-rose-600"]
        : f.emptyGaps > 0 || f.warnungen.length > 0
          ? [`${f.emptyGaps + f.warnungen.length} cảnh báo`, "text-amber-600"]
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

  const multiStore = stores.length > 1;
  const pct = targetMin > 0 ? Math.min(100, Math.round((plannedMin / targetMin) * 100)) : 0;
  const statusPill =
    statusAccent === "text-emerald-600"
      ? "bg-emerald-50 text-emerald-700"
      : statusAccent === "text-rose-600"
        ? "bg-rose-50 text-rose-700"
        : statusAccent === "text-amber-600"
          ? "bg-amber-50 text-amber-700"
          : "bg-slate-100 text-slate-500";

  return (
    <div>
      {/* Eine Karte: verplante Stunden als Balken + Status. */}
      <div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-slate-500">Giờ đã xếp</span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusPill}`}>
              {statusValue === "Hợp lệ" ? "✓ Hợp lệ" : statusValue}
            </span>
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold text-slate-900">{minutesToDecimalHours(plannedMin, 0)}</span>
            <span className="text-sm text-slate-500">/ {hours(targetMin)} định mức</span>
          </div>
          {/* Dunkel = verplant, Gelb = fehlt noch (Giờ chưa thể xếp). Farbe nur für Status. */}
          <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-slate-100">
            <div className="bg-slate-700" style={{ width: `${pct}%` }} />
            {uncoveredMin > 0 && plannedMin > 0 && <div className="bg-amber-300" style={{ width: `${100 - pct}%` }} />}
          </div>
          {uncoveredMin > 0 && notGeneratedCount < stores.length && (
            <div className="mt-1.5 text-xs text-slate-600">
              Còn thiếu <b className="text-amber-700">{hours(uncoveredMin)}</b> chưa xếp được
            </div>
          )}
          {multiStore && (
            <div className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-slate-400">{storeStatus}</div>
          )}
        </div>
      </div>

      <StoreNotes store={view} stores={stores} onApplyFixes={onApplyFixes} />
    </div>
  );
}

/** „Vì sao" mit echten Zahlen (freie Tage, anderer Laden, Höchstmenge) und „Cách sửa". */
function ShortfallDetail({
  store,
  stores,
  employee,
}: {
  store: UseScheduleReturn;
  stores: readonly UseScheduleReturn[];
  employee: Employee;
}) {
  const summary = store.validation.summaries.find((s) => s.employee.id === employee.id);
  if (!summary) return null;
  const { reasons, fixes } = explainShortfall(
    employee,
    summary.assignedMinutes,
    summary.targetMinutes,
    store.openDates,
    stores
      .filter((s) => s.storeId !== store.storeId)
      .map((s) => ({ shortName: s.storeConfig.shortName, employees: s.schedule.employees, shifts: s.schedule.shifts })),
    store.storeConfig.shortName,
  );
  return (
    <div className="mt-0.5 space-y-0.5 opacity-90">
      <div>
        <b>Vì sao:</b> {reasons.join(" ")}
      </div>
      <div>
        <b>Cách sửa:</b> {fixes.join(" · ")}
      </div>
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
  // Giờ mở không có ai (thiếu thợ) – demo: chỉ cảnh báo, lịch vẫn dùng được.
  const gaps = shown.filter((issue) => issue.hard && issue.rule === "closing");
  const hard = shown.filter((issue) => issue.hard && issue.rule !== "closing");
  const soft = shown.filter((issue) => !issue.hard);
  const softGroups = RULES.filter((rule) => rule.kind === "soft")
    .map((rule) => ({ rule, items: soft.filter((issue) => issue.rule === rule.id) }))
    .filter((group) => group.items.length > 0);
  const hasPlan = schedule.shifts.length > 0;
  const [open, setOpen] = useState(false);
  const total = hard.length + gaps.length + soft.length;
  const tone = hard.length > 0 ? "error" : "warning";
  const headline = [
    hard.length > 0 && `${hard.length} lỗi`,
    gaps.length > 0 && `${gaps.length} chỗ không có người trực`,
    soft.length > 0 && `${soft.length} chỗ chưa đạt luật mềm`,
  ]
    .filter(Boolean)
    .join(" · ");

  // Mỗi loại cảnh báo: MỘT dòng, bấm mới mở danh sách.
  const section = (title: string, cls: string, children: React.ReactNode) => (
    <WarningGroup key={title} title={title} cls={cls}>
      {children}
    </WarningGroup>
  );

  return (
    <div>
      {notGenerated && schedule.employees.length > 0 && (
        <div className="mt-2 rounded bg-sky-50 border border-sky-200 text-sky-800 text-sm px-3 py-2">
          {name}: chưa có lịch — bấm Tạo lịch.
        </div>
      )}

      {/* EINE Warnleiste; Details im Popup. */}
      {hasPlan && total > 0 && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`mt-2 flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm ${
            tone === "error" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
              tone === "error" ? "bg-rose-200 text-rose-800" : "bg-amber-200 text-amber-800"
            }`}
          >
            !
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Lịch đã tạo, nhưng cần xem lại</span>
            <span className="block truncate text-xs opacity-80">{headline}</span>
          </span>
          <span className="shrink-0 text-xs font-semibold underline underline-offset-2">Xem</span>
        </button>
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

      {open && (
        <div
          className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            className="flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="font-semibold text-slate-900">Cần xem lại · {total}</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Đóng"
                className="-mr-2 h-9 w-9 rounded-full text-xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain">
              {hard.length > 0 &&
                section(`Lỗi luật cứng (${hard.length})`, "text-rose-700", (
                  <ul className="space-y-1.5">
                    {hard.map((issue, i) => (
                      <li key={i}>
                        <span className="mr-1 rounded bg-rose-100 px-1 text-[11px] font-medium">{ruleById(issue.rule).title}</span>
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                ))}
              {gaps.length > 0 &&
                section(`Không có người trực (${gaps.length})`, "text-amber-700", (
                  <>
                    <p className="mb-1.5 text-slate-500">
                      Quán mở nhưng không có ai làm. Thêm nhân viên hoặc tăng giờ rồi bấm Tạo lịch lại.
                    </p>
                    <ul className="space-y-1">
                      {gaps.slice(0, 20).map((issue, i) => (
                        <li key={i}>{issue.message}</li>
                      ))}
                      {gaps.length > 20 && <li className="text-slate-400">… và {gaps.length - 20} chỗ nữa</li>}
                    </ul>
                  </>
                ))}
              {softGroups.map(({ rule, items }) =>
                section(`${rule.title} (${items.length})`, "text-slate-800", (
                  <ul className="space-y-1.5">
                    {items.slice(0, 12).map((issue, i) => {
                      const emp = issue.employeeId ? byId.get(issue.employeeId) : undefined;
                      return (
                        <li key={i}>
                          <div>{issue.message}</div>
                          {rule.id === "contract-hours" && emp && <ShortfallDetail store={store} stores={stores} employee={emp} />}
                        </li>
                      );
                    })}
                    {items.length > 12 && <li className="text-slate-400">… và {items.length - 12} chỗ nữa</li>}
                  </ul>
                )),
              )}
              <div className="border-t border-slate-100 px-4 py-3">
                <FixFinder stores={stores} onApply={onApplyFixes} month={`${schedule.month}/${schedule.year}`} />
              </div>
            </div>
          </div>
        </div>
      )}
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

/** Welche Regeln hart, welche weich – zum Nachlesen. Geöffnet aus ☰ Menu. */
export function RulesPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white text-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <span className="font-medium text-slate-800">
          Luật xếp lịch · {RULES.filter((r) => r.kind === "hard").length} luật cứng ·{" "}
          {RULES.filter((r) => r.kind === "soft").length} luật mềm
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-lg leading-none text-slate-400 hover:text-slate-600"
          aria-label="Đóng"
        >
          ×
        </button>
      </div>
      <div className="grid gap-3 px-3 py-2 sm:grid-cols-2">
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
    </div>
  );
}
