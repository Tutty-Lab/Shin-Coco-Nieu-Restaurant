import { useEffect, useState, type ReactNode } from "react";
import { useSchedule, type UseScheduleReturn } from "./hooks/useSchedule";
import { GenerateScheduleDialog } from "./components/GenerateScheduleDialog";
import { SettingsTab } from "./components/SettingsTab";
import { EmployeesTab } from "./components/EmployeesTab";
import { ScheduleTab } from "./components/ScheduleTab";
import { StundenzettelTab } from "./components/StundenzettelTab";
import { DocsTab } from "./components/DocsTab";
import { Dashboard } from "./components/Dashboard";
import { LockScreen } from "./components/LockScreen";
import { isAuthenticated, logout } from "./lib/auth";
import { monthLabel } from "./lib/shiftOps";
import { MONTH_NAMES_VI } from "./lib/dateFormat";
import { isScheduleYearAllowed, SCHEDULE_YEARS } from "./lib/years";
import { STORES } from "./lib/stores";

type TabId = "einstellungen" | "mitarbeiter" | "dienstplan" | "stundenzettel";

/** Die Arbeits-Tabs. „Tài liệu" ist bewusst KEIN Tab – es öffnet sich über die Kopfzeile. */
const TABS: { id: TabId; label: string }[] = [
  { id: "einstellungen", label: "Cài đặt" },
  { id: "mitarbeiter", label: "Nhân viên" },
  { id: "dienstplan", label: "Lịch làm việc" },
  { id: "stundenzettel", label: "Bảng chấm công" },
];

export default function App() {
  const [unlocked, setUnlocked] = useState(() => isAuthenticated());

  if (!unlocked) return <LockScreen onUnlock={() => setUnlocked(true)} />;
  return <MainApp onLogout={() => setUnlocked(false)} />;
}

function MainApp({ onLogout }: { onLogout: () => void }) {
  // Beide Filialen laufen gleichzeitig – jede mit eigenem State, eigener
  // Persistenz und eigener Sync. Angezeigt werden sie untereinander; es gibt
  // bewusst KEIN Umschalten, der Betreiber sieht immer alle Läden.
  const shin = useSchedule(STORES[0].id);
  const coco = useSchedule(STORES[1].id);
  const nieu = useSchedule(STORES[2].id);
  const stores = [shin, coco, nieu];
  // Monat/Jahr sind für alle gleich (der Ausdruck muss zusammenpassen). Der
  // Kopf steuert alle; angezeigt wird der Stand der ersten Filiale.
  const primary = shin;

  const [tab, setTab] = useState<TabId>("einstellungen");
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
  const genStampSum = shin.genStamp + coco.genStamp;
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
    const t = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [genStampSum]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen">
      <header className="no-print bg-slate-900 text-white shadow sticky top-0 z-30">
        <div className="mx-auto max-w-[1500px] px-3 sm:px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-base sm:text-lg font-semibold">
              Lịch làm việc &amp; Bảng chấm công
              <span className="ml-2 align-middle text-[10px] font-normal text-slate-400">bản {__BUILD__}</span>
            </h1>
            <p className="text-xs text-slate-300">
              {STORES.map((s) => s.shortName).join(" · ")} ·{" "}
              {monthLabel(primary.schedule.year, primary.schedule.month)}
              {(() => {
                const anyOn = stores.some((s) => s.remoteStatus !== "off");
                if (!anyOn) return null;
                const anyError = stores.some((s) => s.remoteStatus === "error");
                const anySaving = stores.some((s) => s.remoteStatus === "saving");
                return (
                  <span className={anyError ? "ml-2 text-rose-300" : "ml-2 text-slate-400"}>
                    ·{" "}
                    {anySaving
                      ? "đang đồng bộ…"
                      : anyError
                        ? "lỗi đồng bộ — dữ liệu chỉ lưu trên máy này"
                        : "đã đồng bộ"}
                  </span>
                );
              })()}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Tháng/năm dùng chung cho mọi quán – bản in phải cùng kỳ. */}
            <div className="inline-flex items-center gap-1.5" aria-label="Chọn kỳ">
              <select
                aria-label="Tháng"
                value={primary.schedule.month}
                onChange={(e) => setPeriod({ month: Number(e.target.value) })}
                className="rounded-md border border-slate-600 bg-white px-2 py-1.5 text-sm font-medium text-slate-900"
              >
                {MONTH_NAMES_VI.map((name, i) => (
                  <option key={name} value={i + 1} className="bg-white text-slate-900">
                    {name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Năm"
                value={primary.schedule.year}
                onChange={(e) => setPeriod({ year: Number(e.target.value) })}
                className="rounded-md border border-slate-600 bg-white px-2 py-1.5 text-sm font-medium text-slate-900"
              >
                {(isScheduleYearAllowed(primary.schedule.year)
                  ? SCHEDULE_YEARS
                  : [primary.schedule.year, ...SCHEDULE_YEARS]
                ).map((y) => (
                  <option key={y} value={y} className="bg-white text-slate-900">
                    {y}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => setDocsOpen((open) => !open)}
              aria-pressed={docsOpen}
              className={`rounded px-3 py-2 text-sm ${docsOpen ? "bg-white text-slate-900" : "bg-slate-700 hover:bg-slate-600"}`}
            >
              Tài liệu
            </button>
            <button
              onClick={() => {
                if (confirm(`Xoá toàn bộ dữ liệu của cả ${stores.length} quán?`)) {
                  for (const s of stores) s.resetAll();
                }
              }}
              className="rounded bg-slate-700 px-3 py-2 text-sm hover:bg-slate-600"
            >
              Xoá dữ liệu
            </button>
            <button
              onClick={() => {
                logout();
                onLogout();
              }}
              className="rounded bg-slate-700 px-3 py-2 text-sm hover:bg-slate-600"
            >
              Đăng xuất
            </button>
          </div>
        </div>
      </header>

      <div className="no-print mx-auto max-w-[1500px] px-3 sm:px-4 pt-4 space-y-4">
        {stores.map((s) => (
          <StoreSection key={s.storeId} store={s}>
            <Dashboard store={s} />
          </StoreSection>
        ))}
      </div>

      <nav className="no-print mx-auto max-w-[1500px] px-3 sm:px-4 mt-4">
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => {
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
            className="ml-auto rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 active:bg-slate-800 disabled:opacity-40"
          >
            Tạo lịch làm việc
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
              {tab === "einstellungen" &&
                stores.map((s) => (
                  <StoreSection key={s.storeId} store={s}>
                    <SettingsTab store={s} />
                  </StoreSection>
                ))}
              {tab === "mitarbeiter" &&
                stores.map((s) => (
                  <StoreSection key={s.storeId} store={s}>
                    <EmployeesTab store={s} allStores={stores} />
                  </StoreSection>
                ))}
            </div>
            {/*
              „Bảng chấm công" chứa vùng in và không nằm trong khối no-print.
              „Lịch làm việc" cũng nằm ngoài vì tự mang no-print riêng.
            */}
            {tab === "dienstplan" && (
              <div className="space-y-6">
                {stores.map((s) => (
                  <StoreSection key={s.storeId} store={s}>
                    <ScheduleTab store={s} />
                  </StoreSection>
                ))}
              </div>
            )}
            {tab === "stundenzettel" && <StundenzettelTab stores={stores} />}
          </>
        )}
      </main>
    </div>
  );
}

/** Ein Filial-Abschnitt mit Kopfzeile (Filialname). Kopf ist nie im Druck. */
function StoreSection({ store, children }: { store: UseScheduleReturn; children: ReactNode }) {
  return (
    <section>
      <div className="no-print mb-2 flex items-center gap-2">
        <span className="rounded-md bg-slate-900 px-2.5 py-1 text-sm font-semibold text-white">
          {store.storeConfig.shortName}
        </span>
        <span className="text-sm text-slate-500">{store.storeConfig.name}</span>
      </div>
      {children}
    </section>
  );
}
