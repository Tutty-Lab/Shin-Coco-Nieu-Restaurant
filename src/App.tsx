import { useEffect, useState } from "react";
import { useSchedule } from "./hooks/useSchedule";
import { GenerateScheduleDialog } from "./components/GenerateScheduleDialog";
import { SettingsTab } from "./components/SettingsTab";
import { EmployeesTab } from "./components/EmployeesTab";
import { ScheduleTab } from "./components/ScheduleTab";
import { StundenzettelTab } from "./components/StundenzettelTab";
import { DocsTab } from "./components/DocsTab";
import { Dashboard } from "./components/Dashboard";
import { LockScreen } from "./components/LockScreen";
import { isAuthenticated, logout } from "./lib/auth";
import { MONTH_NAMES_VI } from "./lib/dateFormat";
import { isScheduleYearAllowed, SCHEDULE_YEARS } from "./lib/years";
import { STORES } from "./lib/stores";

/** Zuletzt angezeigter Laden (nur Ansicht, je Gerät). */
const VIEW_KEY = "stundenzettel-app:view-store";

type TabId = "einstellungen" | "mitarbeiter" | "dienstplan" | "stundenzettel";

/**
 * Alle Ansichten. Sichtbar als Tab sind nur die zwei, mit denen täglich
 * gearbeitet wird (MAIN_TABS); Nhân viên, Cài đặt und Tài liệu stecken im
 * Menü ☰ oben rechts – der Bildschirm soll für den Chủ quán aufgeräumt sein.
 */
const TABS: { id: TabId; label: string }[] = [
  { id: "einstellungen", label: "Cài đặt" },
  { id: "mitarbeiter", label: "Nhân viên" },
  { id: "dienstplan", label: "Lịch làm việc" },
  { id: "stundenzettel", label: "Bảng chấm công" },
];
const MAIN_TABS: TabId[] = ["dienstplan", "stundenzettel"];

export default function App() {
  const [unlocked, setUnlocked] = useState(() => isAuthenticated());

  if (!unlocked) return <LockScreen onUnlock={() => setUnlocked(true)} />;
  return <MainApp onLogout={() => setUnlocked(false)} />;
}

function MainApp({ onLogout }: { onLogout: () => void }) {
  // Alle Filialen laufen gleichzeitig – jede mit eigenem State, eigener
  // Persistenz und eigener Sync. ANGEZEIGT wird nur der Laden, der oben neben
  // dem Monat gewählt ist (drei Läden untereinander waren zu lang). Erzeugt
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

  /** Monat/Jahr für ALLE Filialen setzen. */
  const setPeriod = (patch: { year?: number; month?: number }) => {
    for (const s of stores) s.updateMeta(patch);
  };

  // „Tạo lịch làm việc" sitzt über den Tabs – erreichbar von jedem Tab aus. Popup
  // statt window.confirm: eingebettete Browser (Messenger, Zalo) schlucken den.
  const [genDialogOpen, setGenDialogOpen] = useState(false);
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
    const allErrors = stores.flatMap((s) => s.validation.errors);
    const fehler = allErrors.filter((e) => e.severity !== "warning").length;
    const warn = allErrors.filter((e) => e.severity === "warning").length;
    setToast(
      fehler > 0
        ? `Đã tạo lịch ${stores.length} quán — nhưng còn ${fehler} lỗi, xem chi tiết ở phần trạng thái.`
        : warn > 0
          ? `✓ Đã tạo lịch ${stores.length} quán (còn ${warn} cảnh báo thiếu giờ — bấm (i) để xem).`
          : `✓ Đã tạo lịch mới cho cả ${stores.length} quán — hợp lệ, đúng giờ hợp đồng.`,
    );
    const offen = stores
      .map((s) => ({
        storeId: s.storeId,
        name: s.storeConfig.shortName,
        messages: s.validation.errors.filter((e) => e.severity === "warning").map((e) => e.message),
      }))
      .filter((x) => x.messages.length > 0);
    setQuotaPopup(offen.length > 0 ? offen : null);
    const t = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [genStampSum]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen">
      <header className="no-print bg-slate-900 text-white shadow sticky top-0 z-30">
        <div className="mx-auto max-w-[1500px] px-3 sm:px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
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
            {/* Quán đang xem + tháng/năm (tháng dùng chung cho mọi quán – bản in phải cùng kỳ). */}
            <div className="inline-flex items-center gap-1.5" aria-label="Chọn quán và kỳ">
              <select
                aria-label="Quán"
                value={view.storeId}
                onChange={(e) => chooseStore(e.target.value)}
                className="rounded-md border border-slate-600 bg-white px-2 py-1.5 text-sm font-semibold text-slate-900"
              >
                {stores.map((s) => (
                  <option key={s.storeId} value={s.storeId} className="bg-white text-slate-900">
                    {s.storeConfig.shortName}
                  </option>
                ))}
              </select>
              <select
                aria-label="Tháng"
                value={`${primary.schedule.year}-${primary.schedule.month}`}
                onChange={(e) => {
                  const [year, month] = e.target.value.split("-").map(Number);
                  setPeriod({ year, month });
                }}
                className="rounded-md border border-slate-600 bg-white px-2 py-1.5 text-sm font-medium text-slate-900"
              >
                {(isScheduleYearAllowed(primary.schedule.year)
                  ? SCHEDULE_YEARS
                  : [primary.schedule.year, ...SCHEDULE_YEARS]
                ).flatMap((y) =>
                  MONTH_NAMES_VI.map((_, i) => (
                    <option key={`${y}-${i + 1}`} value={`${y}-${i + 1}`} className="bg-white text-slate-900">
                      {String(i + 1).padStart(2, "0")}/{y}
                    </option>
                  )),
                )}
              </select>
            </div>
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
                        ["Nhân viên", () => openTab("mitarbeiter")],
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
                    <div className="my-1 border-t border-slate-100" />
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        if (confirm(`Xoá toàn bộ dữ liệu của cả ${stores.length} quán?`)) {
                          for (const s of stores) s.resetAll();
                        }
                      }}
                      className="block w-full px-4 py-2 text-left text-rose-700 hover:bg-rose-50"
                    >
                      Xoá dữ liệu
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        logout();
                        onLogout();
                      }}
                      className="block w-full px-4 py-2 text-left hover:bg-slate-50"
                    >
                      Đăng xuất
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="no-print mx-auto max-w-[1500px] px-3 sm:px-4 pt-4 space-y-4">
        <Dashboard store={view} />
      </div>

      <nav className="no-print mx-auto max-w-[1500px] px-3 sm:px-4 mt-4">
        <div className="flex flex-wrap gap-2">
          {TABS.filter((t) => MAIN_TABS.includes(t.id)).map((t) => {
            const active = !docsOpen && tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => openTab(t.id)}
                aria-current={active ? "page" : undefined}
                className={`px-3.5 py-2 text-sm font-medium rounded-full border ${
                  active
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-600 border-slate-200 hover:text-slate-900 hover:border-slate-300"
                }`}
              >
                {t.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setGenDialogOpen(true)}
            disabled={stores.every((s) => s.schedule.employees.length === 0)}
            className="ml-auto rounded-lg border border-emerald-700 bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-40"
          >
            Tạo lịch
          </button>
        </div>
      </nav>

      {/* Popup chọn tháng/năm – nhắc kiểm tra ngày lễ/giờ đặc biệt, cảnh báo thay lịch và mở khóa. */}
      {genDialogOpen && (
        <GenerateScheduleDialog
          currentYear={primary.schedule.year}
          currentMonth={primary.schedule.month}
          hasShifts={stores.some((s) => s.schedule.shifts.length > 0)}
          isLocked={stores.some((s) => s.isLocked)}
          dateOverrides={stores.flatMap((s) => s.schedule.dateOverrides)}
          onClose={() => setGenDialogOpen(false)}
          onOpenSettings={() => {
            setGenDialogOpen(false);
            openTab("einstellungen");
          }}
          onConfirm={(target) => {
            setGenDialogOpen(false);
            generateAll(target);
            openTab("dienstplan");
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
            {/*
              „Bảng chấm công" chứa vùng in và không nằm trong khối no-print.
              „Lịch làm việc" cũng nằm ngoài vì tự mang no-print riêng.
            */}
            {tab === "dienstplan" && <ScheduleTab key={view.storeId} store={view} />}
            {/* Nur der gewählte Laden – die PDF ist damit eine Datei je Laden. */}
            {tab === "stundenzettel" && <StundenzettelTab
                key={view.storeId}
                stores={[view]}
                regenerate={() => generateAll({ year: primary.schedule.year, month: primary.schedule.month })}
              />}
          </>
        )}
      </main>
    </div>
  );
}

