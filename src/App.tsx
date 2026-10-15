import { useEffect, useState } from "react";
import { useSchedule } from "./hooks/useSchedule";
import { SettingsTab } from "./components/SettingsTab";
import { EmployeesTab } from "./components/EmployeesTab";
import { ScheduleTab } from "./components/ScheduleTab";
import { DocsTab } from "./components/DocsTab";
import { GenerateScheduleDialog } from "./components/GenerateScheduleDialog";
import { SavedSchedulesPanel } from "./components/SavedSchedules";
import { RulesPanel } from "./components/Dashboard";
import { Dashboard } from "./components/Dashboard";
import { LockScreen } from "./components/LockScreen";
import { isAuthenticated } from "./lib/auth";
import { STORES } from "./lib/stores";
import type { EmployeeChange } from "./lib/suggestions";

/** Zuletzt angezeigter Laden (nur Ansicht, je Gerät). */
const VIEW_KEY = "stundenzettel-app:view-store";

type TabId = "einstellungen" | "mitarbeiter" | "dienstplan" | "lich";

/**
 * Alle Ansichten. Sichtbar als Tab sind die zwei, mit denen täglich gearbeitet
 * wird (MAIN_TABS); Cài đặt und Tài liệu stecken im Menü ☰ oben rechts – der
 * Bildschirm soll für den Chủ quán aufgeräumt sein.
 */
const TABS: { id: TabId; label: string }[] = [
  // Bảng chấm công ist eine Ansicht („Chấm công") im Lịch-Tab, kein eigener Tab mehr.
  { id: "dienstplan", label: "Chấm công" },
  { id: "lich", label: "Lịch" },
  { id: "mitarbeiter", label: "Nhân viên" },
  { id: "einstellungen", label: "Cài đặt" },
];
const MAIN_TABS: TabId[] = ["dienstplan", "lich", "mitarbeiter"];

export default function App() {
  const [unlocked, setUnlocked] = useState(() => isAuthenticated());

  if (!unlocked) return <LockScreen onUnlock={() => setUnlocked(true)} />;
  return <MainApp />;
}

function MainApp() {
  // Alle Filialen laufen gleichzeitig – jede mit eigenem State, eigener
  // Persistenz und eigener Sync. ANGEZEIGT wird nur der Laden, der in der
  // Reihe unter den Tabs gewählt ist (drei Läden untereinander waren zu lang);
  // die Kennzahlen oben zählen alle Läden zusammen. Erzeugt
  // wird weiterhin für alle zusammen, wegen der Leute in zwei Läden.
  const shin = useSchedule(STORES[0].id);
  const coco = useSchedule(STORES[1].id);
  const nieu = useSchedule(STORES[2].id);
  const stores = [shin, coco, nieu];
  const [viewId, setViewId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved && STORES.some((s) => s.id === saved)) return saved;
    } catch {
      // Speicher gesperrt – dann der erste Laden.
    }
    return STORES[0].id;
  });
  const chooseStore = (id: string) => {
    setViewId(id);
    try {
      localStorage.setItem(VIEW_KEY, id);
    } catch {
      // egal – nur eine Bequemlichkeit
    }
  };
  /** Der angezeigte Laden. */
  const view = stores.find((s) => s.storeId === viewId) ?? shin;
  // Monat/Jahr sind für alle gleich (der Ausdruck muss zusammenpassen). Der
  // Kopf steuert alle; angezeigt wird der Stand der ersten Filiale.
  const primary = shin;

  const [tab, setTab] = useState<TabId>("dienstplan");
  const [menuOpen, setMenuOpen] = useState(false);
  /** Popup aus ☰ Menu: „Lịch đã lưu" oder „Luật xếp lịch". */
  const [popup, setPopup] = useState<"saved" | "rules" | null>(null);
  /** Trang Tài liệu mở riêng; đóng lại thì về đúng tab đang làm. */
  const [docsOpen, setDocsOpen] = useState(false);

  const openTab = (id: TabId) => {
    setTab(id);
    setDocsOpen(false);
  };

  /**
   * Alle Läden nacheinander planen. Wer in zwei Läden arbeitet (personKey),
   * ist an seinen schon verplanten Tagen im nächsten Laden blockiert – die
   * Läden liegen zu weit auseinander für zwei Dienste am selben Tag.
   */
  const generateAll = (target: { year: number; month: number }) => {
    const busyByPerson = new Map<string, Set<string>>();
    for (const s of stores) {
      const blocked: Record<string, string[]> = {};
      for (const employee of s.schedule.employees) {
        const dates = employee.personKey ? busyByPerson.get(employee.personKey) : undefined;
        if (dates?.size) blocked[employee.id] = [...dates];
      }
      const shifts = s.generate(target, blocked);
      for (const employee of s.schedule.employees) {
        if (!employee.personKey) continue;
        const dates = busyByPerson.get(employee.personKey) ?? new Set<string>();
        for (const shift of shifts) if (shift.employeeId === employee.id) dates.add(shift.date);
        busyByPerson.set(employee.personKey, dates);
      }
    }
  };

  /**
   * „Áp dụng" aus „Tìm cách xếp khác": erst die Einstellungen ändern, dann –
   * NACH dem nächsten Rendern, wenn die Läden die neuen Mitarbeiter kennen –
   * alle Läden für den offenen Monat neu planen.
   */
  const [regenPending, setRegenPending] = useState(false);
  const applyFixes = (changes: EmployeeChange[]) => {
    for (const change of changes) {
      stores.find((s) => s.storeId === change.storeId)?.updateEmployee(change.employeeId, change.patch);
    }
    setRegenPending(true);
  };
  useEffect(() => {
    if (!regenPending) return;
    setRegenPending(false);
    generateAll({ year: primary.schedule.year, month: primary.schedule.month });
    openTab("dienstplan");
  }, [regenPending]); // eslint-disable-line react-hooks/exhaustive-deps

  // Popup „Tạo lịch" (Demo: nur Monat/Jahr, vorausgewählt der aktuelle Kalendermonat).
  const [genDialogOpen, setGenDialogOpen] = useState(false);
  /** Vorauswahl im Popup: der aktuelle Kalendermonat. */
  const today = new Date();
  const thisMonth = { year: today.getFullYear(), month: today.getMonth() + 1 };

  /** Monat/Jahr für ALLE Filialen setzen. */
  const setPeriod = (patch: { year?: number; month?: number }) => {
    for (const s of stores) s.updateMeta(patch);
  };

  // Kurze Erfolgsmeldung nach dem Erzeugen. genStamp steigt bei jedem
  // erfolgreichen Lauf; der Effekt liest DANACH die (frische) Prüfung beider
  // Filialen aus.
  const [toast, setToast] = useState<string | null>(null);
  /**
   * Popup nach „Tạo lịch", wenn jemand sein Soll nicht erreicht: der Chủ quán
   * sieht wer und wie viel, und entscheidet selbst – „Bỏ qua cảnh báo" nimmt es
   * für diesen Plan hin (Dashboard wird grün), „Để sau" lässt die Warnung stehen.
   */
  const [quotaPopup, setQuotaPopup] = useState<{ storeId: string; name: string; messages: string[] }[] | null>(null);
  const genStampSum = stores.reduce((sum, s) => sum + s.genStamp, 0);
  useEffect(() => {
    if (genStampSum === 0) return;
    const anyIssue = stores.some((s) => s.validation.errors.length > 0 || s.analysis.peakViolations.length > 0);
    // Demo: chỉ báo khi lịch ổn. Có vấn đề thì đã có MỘT thanh cảnh báo (Dashboard)
    // – không thêm toast hay popup „thiếu giờ" tự bật nữa.
    setToast(anyIssue ? null : `✓ Đã tạo lịch mới — hợp lệ, đúng giờ hợp đồng.`);
    const t = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [genStampSum]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen">
      <header className="no-print bg-slate-900 text-white shadow sticky top-0 z-30">
        <div className="mx-auto max-w-[1500px] px-3 sm:px-4 py-3 flex items-center justify-between gap-3">
          <div>
            {/* Nur der Titel – Version und Unterzeile weggelassen (Wunsch: aufgeräumt).
                Nur ein SYNC-FEHLER wird gezeigt: dann liegen Daten nur auf diesem Gerät. */}
            <h1 className="text-base sm:text-lg font-semibold" title={`bản ${__BUILD__}`}>
              Lịch làm việc &amp; Bảng chấm công
            </h1>
            {stores.some((s) => s.remoteStatus === "error") && (
              <p className="text-xs text-rose-300">Lỗi đồng bộ — dữ liệu chỉ lưu trên máy này</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Aus dem Menü geöffnete Seite: steht direkt neben dem Menü, mit ✕ zurück. */}
            {(docsOpen || !MAIN_TABS.includes(tab)) && (
              <span className="inline-flex items-center gap-1 rounded-md bg-white py-1.5 pl-3 pr-1 text-sm font-medium text-slate-900">
                {docsOpen ? "Tài liệu" : TABS.find((t) => t.id === tab)?.label}
                <button
                  type="button"
                  onClick={() => openTab("dienstplan")}
                  aria-label="Đóng"
                  className="rounded px-1.5 text-slate-400 hover:text-slate-900"
                >
                  ✕
                </button>
              </span>
            )}
            {/* Menu: alles, was nicht täglich gebraucht wird. */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                className={`rounded px-3 py-2 text-sm font-medium ${menuOpen ? "bg-white text-slate-900" : "bg-slate-700 hover:bg-slate-600"}`}
              >
                ☰ Menu
              </button>
              {menuOpen && (
                <>
                  {/* Klick daneben schliesst das Menü. */}
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div
                    role="menu"
                    className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-sm text-slate-800 shadow-lg"
                  >
                    {(
                      [
                        [`Lịch đã lưu (${view.savedMonths.length})`, () => setPopup("saved")],
                        ["Luật xếp lịch", () => setPopup("rules")],
                        ["Cài đặt", () => openTab("einstellungen")],
                        ["Tài liệu", () => setDocsOpen(true)],
                      ] as const
                    ).map(([label, action]) => (
                      <button
                        key={label}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          action();
                          setMenuOpen(false);
                        }}
                        className="block w-full px-4 py-2 text-left hover:bg-slate-50"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="no-print mx-auto max-w-[1500px] px-3 sm:px-4 pt-4 space-y-4">
        <Dashboard stores={stores} view={view} onChooseStore={chooseStore} onApplyFixes={applyFixes} />
      </div>

      <nav className="no-print mx-auto max-w-[1500px] px-3 sm:px-4 mt-4">
        <div className="flex items-center gap-2">
          {/* Eine Zeile: Chấm công · Lịch · Nhân viên als Segment, rechts Tạo lịch. */}
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5">
            {TABS.filter((t) => MAIN_TABS.includes(t.id)).map((t) => {
              const active = !docsOpen && tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => openTab(t.id)}
                  aria-current={active ? "page" : undefined}
                  className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
                    active ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          {/* „Tạo lịch" – wichtigste Aktion, rechts in der Tab-Zeile. */}
          <button
            type="button"
            onClick={() => setGenDialogOpen(true)}
            disabled={stores.every((s) => s.schedule.employees.length === 0)}
            className="ml-auto whitespace-nowrap rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-40"
          >
            Tạo lịch
          </button>
        </div>
      </nav>

      {genDialogOpen && (
        <GenerateScheduleDialog
          simple
          initialTarget={thisMonth}
          currentYear={primary.schedule.year}
          currentMonth={primary.schedule.month}
          hasShifts={stores.some((s) => s.schedule.shifts.length > 0)}
          isLocked={stores.some((s) => s.isLocked)}
          dateOverrides={stores.flatMap((s) => s.schedule.dateOverrides)}
          onClose={() => setGenDialogOpen(false)}
          onConfirm={(target) => {
            setGenDialogOpen(false);
            generateAll(target);
            if (tab !== "lich") openTab("dienstplan");
          }}
        />
      )}

      {quotaPopup && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900">Có người chưa đủ giờ định mức</h2>
              <p className="mt-1 text-sm text-slate-600">
                Lịch vẫn dùng được. Tháng này không đủ ngày trống để xếp đủ giờ cho những người dưới đây.
              </p>
            </div>
            <div className="max-h-[50vh] space-y-3 overflow-y-auto px-5 py-4 text-sm">
              {quotaPopup.map((x) => (
                <div key={x.storeId}>
                  <div className="mb-1 font-semibold text-slate-800">{x.name}</div>
                  <ul className="list-disc space-y-0.5 pl-5 text-slate-700">
                    {x.messages.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                </div>
              ))}
              <p className="rounded bg-emerald-50 px-3 py-2 text-emerald-900">
                Muốn app tìm cách xếp đủ giờ: bấm <b>Để sau</b>, rồi bấm <b>Tìm cách xếp khác</b> ở phần cảnh báo phía trên —
                app tạo lịch thử và gợi ý thay đổi kèm nút <b>Áp dụng</b>.
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <button
                type="button"
                onClick={() => setQuotaPopup(null)}
                className="rounded border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Để sau
              </button>
              <button
                type="button"
                onClick={() => {
                  for (const x of quotaPopup) stores.find((s) => s.storeId === x.storeId)?.updateMeta({ underQuotaAccepted: true });
                  setQuotaPopup(null);
                }}
                className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
              >
                Bỏ qua cảnh báo
              </button>
            </div>
          </div>
        </div>
      )}

      {(stores.some((s) => s.genError) || toast) && (
        <div className="no-print mx-auto max-w-[1500px] px-3 sm:px-4 mt-3 space-y-2">
          {stores
            .filter((s) => s.genError)
            .map((s) => (
              <div
                key={s.storeId}
                role="alert"
                className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900"
              >
                {s.storeConfig.shortName}: {s.genError}
              </div>
            ))}
          {/* Erfolgsmeldung nach „Tạo lịch"; Details zu Warnungen/Fehlern stehen aufklappbar im Dashboard. */}
          {toast && (
            <div
              role="status"
              className={`flex items-start gap-2 rounded border px-3 py-2 text-sm ${
                toast.startsWith("✓")
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : "bg-amber-50 border-amber-200 text-amber-900"
              }`}
            >
              <span className="flex-1">{toast}</span>
              <button type="button" onClick={() => setToast(null)} className="shrink-0 opacity-60 hover:opacity-100" aria-label="Đóng">
                ×
              </button>
            </div>
          )}
        </div>
      )}

      <main className="mx-auto max-w-[1500px] px-3 sm:px-4 py-4">
        {docsOpen ? (
          <div className="no-print">
            <button
              type="button"
              onClick={() => setDocsOpen(false)}
              className="mb-3 rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              ← Quay lại {TABS.find((t) => t.id === tab)?.label}
            </button>
            <DocsTab stores={stores.map((s) => s.storeConfig)} />
          </div>
        ) : (
          <>
            <div className="no-print space-y-6">
              {tab === "einstellungen" && <SettingsTab key={view.storeId} store={view} />}
              {tab === "mitarbeiter" && <EmployeesTab key={view.storeId} store={view} allStores={stores} />}
            </div>
            {/* „Chấm công" tự mang no-print riêng (gồm cả phần chấm công/xuất PDF). */}
            {(tab === "dienstplan" || tab === "lich") && (
              <ScheduleTab key={view.storeId} store={view} mode={tab === "lich" ? "schedule" : "timesheet"} />
            )}
          </>
        )}
      </main>

      {popup && (
        // Klick auf den Hintergrund schliesst das Popup.
        <div
          className="no-print fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 px-4 pt-20"
          onClick={() => setPopup(null)}
        >
          <div className="max-h-[75vh] w-full max-w-2xl overflow-auto rounded-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
            {popup === "saved" ? (
              <SavedSchedulesPanel
                store={view}
                openMonth={(year, month) => setPeriod({ year, month })}
                onClose={() => setPopup(null)}
              />
            ) : (
              <RulesPanel onClose={() => setPopup(null)} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

