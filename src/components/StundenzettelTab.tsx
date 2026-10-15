import { useMemo, useState, type ReactNode } from "react";
import type { UseScheduleReturn } from "../hooks/useSchedule";
import type { Employee } from "../types";
import { StundenzettelPage } from "./StundenzettelPage";
import { FitToWidth } from "./FitToWidth";
import type { SchedulePrintLayout } from "./SchedulePrintPage";
import {
  buildDienstplanPdfFor,
  buildStundenzettelPdfFor,
  deliver,
  safeFileName,
  sharePdf,
} from "../lib/pdf";
import { chromeIntentUrl, detectInAppBrowser } from "../lib/inAppBrowser";
import { isScheduleYearAllowed, SCHEDULE_YEAR_RANGE_LABEL } from "../lib/years";
import { weeksOfMonth } from "../lib/weeks";
import { datesOfMonth } from "../lib/demand";
import { monthLabel } from "../lib/shiftOps";

/** Dienstplan-Ausdruck (Monat oder eine Woche), evtl. auf eine Person gefiltert. */
type ScheduleRange = {
  dates: string[];
  title: string;
  layout: SchedulePrintLayout;
  /** Gesetzt bei einer Woche: nach dem Ausgeben wird der Monat gesperrt. */
  weekStart?: string;
};

/**
 * Leiste „Chấm công / Lịch làm việc" im Tab „Chấm công": links die
 * Umschaltung (vom ScheduleTab), rechts die Bedienung der gewählten Ansicht und
 * EIN Knopf „Xuất PDF" – er gibt genau das aus, was gerade angezeigt wird
 * (Stundenzettel bzw. Dienstplan), immer für den ganzen Quán und Monat.
 * In der Ansicht Chấm công folgt darunter die Vorschau einer Person.
 */
export function StundenzettelTab({
  stores,
  mode,
  toolbarLeft,
  toolbarRight,
}: {
  stores: UseScheduleReturn[];
  mode: "timesheet" | "schedule";
  /** Umschalter Chấm công / Lịch làm việc. */
  toolbarLeft?: ReactNode;
  /** Zusätzliche Bedienung rechts in der Lịch-Ansicht (Tháng/Tuần/Ngày). */
  toolbarRight?: ReactNode;
}) {
  // Alle Filialen laufen im selben Monat (der Kopf steuert alle). Monat und
  // Wochen kommen deshalb aus der ersten Filiale; ausgegeben wird je Quán eine
  // EIGENE Datei – der Betrieb wählt oben den Quán (oder eine Person).
  const primary = stores[0];
  const { schedule } = primary;
  const isLocked = stores.some((s) => s.isLocked);
  const unlockMonth = () => {
    for (const s of stores) if (s.isLocked) s.unlockMonth();
  };

  // Trình duyệt nhúng (Zalo, Messenger, Facebook …) không lưu được file tải thẳng.
  const inApp = useMemo(
    () => detectInAppBrowser(typeof navigator === "undefined" ? "" : navigator.userAgent),
    [],
  );
  const pageUrl = typeof window === "undefined" ? "" : window.location.href;
  const chromeUrl = inApp.platform === "android" ? chromeIntentUrl(pageUrl) : null;

  // Ausgegeben wird immer der ganze Quán (eine Datei je Quán) – die Auswahl
  // einzelner Personen und „Nội dung" wurde zugunsten zweier Knöpfe entfernt.
  // Reihenfolge der Quán wie vom Betrieb genannt: Coco, Shin, Nieu 37.
  const STORE_ORDER = ["coco", "shin", "nieu"];
  const rank = (id: string) => (STORE_ORDER.includes(id) ? STORE_ORDER.indexOf(id) : STORE_ORDER.length);
  const storeChoices = [...stores].sort((a, b) => rank(a.storeId) - rank(b.storeId));
  const who = `store:${storeChoices[0].storeId}`;
  /** Nur für die Vorschau: welche Person gezeigt wird (leer = cả quán, alle untereinander). */
  const [previewId, setPreviewId] = useState<string>("");

  const weeks = useMemo(
    () => weeksOfMonth(schedule.year, schedule.month),
    [schedule.year, schedule.month],
  );

  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<string>("");
  /** Lỗi tạo PDF – hiện ngay trên trang (alert bị trình duyệt nhúng chặn). */
  const [pdfError, setPdfError] = useState<string | null>(null);
  /** Trình duyệt nhúng: PDF đã tạo xong, chờ người dùng bấm Lưu / Chia sẻ. */
  // Je Quán eine eigene Datei – im eingebetteten Browser je Datei ein Knopf.
  const [readyPdfs, setReadyPdfs] = useState<{ blob: Blob; filename: string }[]>([]);
  const readyPdf = readyPdfs.length > 0;
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);


  /** Zweiter Klick für das Entsperren – ohne native Dialoge, siehe unten. */
  const [confirmUnlock, setConfirmUnlock] = useState(false);

  const monthTag = `${schedule.year}-${String(schedule.month).padStart(2, "0")}`;

  // Für WER: ganzer Quán ("store:<id>") oder eine Person ("<storeId>:<empId>").
  const wholeStore = who.startsWith("store:");
  const [whoStoreId, whoEmpId] = wholeStore ? [who.slice("store:".length), null] : who.split(":");

  /** Mitarbeiter dieser Filiale, die in den Ausdruck kommen. */
  const chosenFor = (s: UseScheduleReturn): Employee[] => {
    if (s.storeId !== whoStoreId) return [];
    if (wholeStore) return s.activeEmployees;
    return s.activeEmployees.filter((e) => e.id === whoEmpId);
  };
  /** employeeIds für den Dienstplan: undefined = ganze Filiale, [] = gar nicht. */
  const employeeIdsFor = (s: UseScheduleReturn): string[] | undefined => {
    if (s.storeId !== whoStoreId) return [];
    if (wholeStore) return undefined;
    return [whoEmpId as string];
  };
  const chosenCount = stores.reduce((sum, s) => sum + chosenFor(s).length, 0);

  // Für die Vorschau und die Dateinamen: eine konkrete Person.
  const previewStore = stores.find((s) => s.storeId === whoStoreId) ?? primary;
  const previewEmployee =
    previewStore.activeEmployees.find((e) => e.id === (wholeStore ? previewId : whoEmpId)) ?? null;
  const previewEmployees = previewEmployee ? [previewEmployee] : previewStore.activeEmployees;
  const whoTag = wholeStore ? "ca_quan" : safeFileName(previewEmployee?.name ?? who);

  const startPdf = () => {
    setPdfBusy(true);
    setPdfError(null);
    setReadyPdfs([]);
    setShareNote(null);
  };
  const progress = (current: number, total: number) => {
    if (total > 1) setPdfProgress(`${current}/${total}`);
  };
  /**
   * Mỗi quán MỘT file riêng (Shin, Coco, Nieu không gộp chung nữa).
   * Rechner/Chrome/Safari: tải thẳng lần lượt từng file. Trình duyệt nhúng:
   * giữ các file lại, mỗi file một nút Lưu / Chia sẻ.
   */
  const finishPdfs = async (files: { blob: Blob; filename: string }[]) => {
    if (inApp.inApp) {
      setReadyPdfs(files);
      return;
    }
    for (const [i, file] of files.entries()) {
      // Kleine Pause zwischen den Downloads – sonst verwirft der Browser alle
      // ausser dem ersten.
      if (i > 0) await new Promise((resolve) => setTimeout(resolve, 400));
      deliver(file.blob, file.filename);
    }
  };
  /** Tên file của một quán: tên quán đứng đầu, sau đó phần chung. */
  const fileFor = (s: UseScheduleReturn, rest: string) =>
    `${rest.split("_")[0]}_${safeFileName(s.storeConfig.shortName)}_${rest.split("_").slice(1).join("_")}`;
  const errorText = (err: unknown) =>
    `Không tạo được PDF: ${err instanceof Error ? err.message : String(err)}`;

  /**
   * Stundenzettel-PDF: echtes Vektor-PDF direkt aus den Daten (jsPDF zeichnet
   * Text und Linien). Kein Screenshot der Seite mehr – deshalb gibt es keine
   * Offscreen-Bühne, kein Warten auf Schriften und kein Gerät, auf dem die
   * Tabelle plötzlich anders aussieht.
   */
  async function doPdf(filename: string, sz?: { dates?: string[]; label?: string }) {
    // filename = Muster ohne Quán, z. B. Stundenzettel_tat_ca_2026-10.pdf
    if (chosenCount === 0 || pdfBusy) return;
    startPdf();
    setPdfProgress(chosenCount > 1 ? `1/${chosenCount}` : "");
    // Kurzer Yield, damit „Đang tạo PDF…" zuerst sichtbar wird.
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const files: { blob: Blob; filename: string }[] = [];
      let done = 0;
      for (const s of stores) {
        const employees = chosenFor(s);
        if (employees.length === 0) continue;
        const offset = done;
        const doc = await buildStundenzettelPdfFor(
          [{ schedule: s.schedule, employees }],
          { dates: sz?.dates, periodLabel: sz?.label },
          (current) => progress(offset + current, chosenCount),
        );
        done += employees.length;
        files.push({ blob: doc.output("blob"), filename: fileFor(s, filename) });
      }
      await finishPdfs(files);
    } catch (err) {
      setPdfError(errorText(err));
    } finally {
      setPdfBusy(false);
      setPdfProgress("");
    }
  }

  /**
   * PDF des Dienstplans (Monat oder Woche) – ebenfalls gezeichnet, nicht
   * fotografiert. Eine Woche sperrt danach den Monat.
   */
  async function doPdfSchedule(range: ScheduleRange, filename: string) {
    if (range.dates.length === 0 || pdfBusy) return;
    startPdf();
    setPdfProgress("");
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const exported = stores.filter((s) => employeeIdsFor(s)?.length !== 0);
      const files = exported
        .map((s) => {
          const doc = buildDienstplanPdfFor(
            [{
              schedule: s.schedule,
              dates: range.dates,
              title: `${s.storeConfig.shortName} · ${range.title}`,
              employeeIds: employeeIdsFor(s),
            }],
            range.layout,
          );
          return { blob: doc.output("blob"), filename: fileFor(s, filename) };
        });
      await finishPdfs(files);
      // Nur der Quán, der wirklich ausgegeben wurde, gilt als gedruckt/gesperrt.
      if (range.weekStart) for (const s of exported) s.markWeekPrinted(range.weekStart);
    } catch (err) {
      setPdfError(errorText(err));
    } finally {
      setPdfBusy(false);
      setPdfProgress("");
    }
  }

  /** Gọi trực tiếp trong lúc bấm – bảng Chia sẻ cần thao tác người dùng còn "mới". */
  async function onSharePdf(file: { blob: Blob; filename: string }) {
    const result = await sharePdf(file.blob, file.filename);
    if (result === "shared") {
      // Đã lưu/gửi file này – các file quán khác vẫn còn nút.
      setReadyPdfs((list) => list.filter((f) => f !== file));
      setShareNote(null);
    } else if (result !== "cancelled") {
      setShareNote(
        `${inApp.name ?? "Trình duyệt này"} không cho lưu hoặc chia sẻ file. Hãy mở app bằng trình duyệt (Chrome/Safari) rồi xuất lại.`,
      );
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(pageUrl);
      setCopied(true);
    } catch {
      setCopied(false);
      setShareNote("Không sao chép tự động được – hãy giữ tay vào ô link bên dưới để sao chép.");
    }
  }

  const openInBrowserHelp = (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {chromeUrl && (
          <a
            href={chromeUrl}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
          >
            Mở bằng Chrome
          </a>
        )}
        <button
          type="button"
          onClick={() => void copyLink()}
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {copied ? "Đã sao chép link" : "Sao chép link"}
        </button>
      </div>
      <p className="text-xs">
        {inApp.platform === "ios"
          ? "Hoặc bấm ⋯ ở góc trên → Mở trong Safari (hoặc trình duyệt), rồi xuất PDF lại."
          : "Hoặc bấm ⋮ ở góc trên → Mở bằng trình duyệt, rồi xuất PDF lại."}
      </p>
      <input
        readOnly
        value={pageUrl}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600"
        aria-label="Link của app"
      />
    </div>
  );

  // Was genau ist gewählt? Baut den passenden Ausdruck-Auftrag.
  function scheduleRangeFor(target: string): ScheduleRange | null {
    if (target === "month") {
      return {
        dates: datesOfMonth(schedule.year, schedule.month),
        title: monthLabel(schedule.year, schedule.month),
        // 31 Tagesspalten passen nicht hochkant auf A4.
        layout: "byDate",
      };
    }
    const w = weeks.find((x) => x.weekStart === target);
    if (!w) return null;
    return {
      dates: w.dates,
      title: `Woche ${w.label} · ${monthLabel(schedule.year, schedule.month)}`,
      // Leute untereinander, Tage nebeneinander – bei 7 Spalten gut auf Papier.
      layout: "byEmployee",
      weekStart: w.weekStart,
    };
  }

  const onPdfStundenzettel = () => void doPdf(`Stundenzettel_${whoTag}_${monthTag}.pdf`);
  const onPdfSchedule = () => {
    const range = scheduleRangeFor("month");
    if (range) void doPdfSchedule(range, `Dienstplan_${whoTag}_thang_${monthTag}.pdf`);
  };

  // Vùng in KHÔNG được dọn theo sự kiện "afterprint": trên Android sự kiện đó
  // bắn ra ngay khi gọi window.print(), trước lúc trình duyệt dựng xong trang
  // — nội dung bị xoá mất và tờ in ra trắng. Vùng này vốn đã ẩn trên màn hình
  // nên cứ để nguyên; lần in sau sẽ ghi đè bằng danh sách mới.

  if (stores.every((s) => s.activeEmployees.length === 0)) {
    return (
      <div className="no-print rounded bg-white border border-slate-200 p-6 text-center text-slate-400">
        Vui lòng thêm nhân viên và tạo lịch làm việc trước.
      </div>
    );
  }

  const hasSchedule = stores.some((s) => s.schedule.shifts.length > 0);
  const canExport = !pdfBusy && hasSchedule && isScheduleYearAllowed(schedule.year);

  return (
    <div className="no-print">
      {/* Eine Zeile: Ansicht links, Bedienung + Xuất PDF rechts. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {toolbarLeft}
        {/* Mobile: eigene volle Zeile, Auswahl dehnt sich; ab sm rechts neben dem Umschalter. */}
        <div className="flex w-full min-w-0 items-center gap-2 sm:ml-auto sm:w-auto">
          {mode === "timesheet" ? (
            <select
              aria-label="Xem trước"
              value={previewEmployee?.id ?? ""}
              onChange={(e) => setPreviewId(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 sm:flex-none"
            >
              <option value="">Cả quán ({previewStore.activeEmployees.length} người)</option>
              {previewStore.activeEmployees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          ) : (
            toolbarRight
          )}
          <button
            type="button"
            disabled={!canExport}
            onClick={mode === "timesheet" ? onPdfStundenzettel : onPdfSchedule}
            title={
              mode === "timesheet"
                ? "Bảng chấm công của cả quán, cả tháng"
                : "Lịch làm việc của cả quán, cả tháng"
            }
            className="ml-auto shrink-0 rounded-lg bg-slate-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-slate-700 active:bg-slate-800 disabled:opacity-40"
          >
            {pdfBusy ? `Đang tạo PDF${pdfProgress ? ` (${pdfProgress})` : "…"}` : "Xuất PDF"}
          </button>
        </div>
      </div>

      {inApp.inApp && !readyPdf && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="font-semibold">
            Bạn đang mở app trong {inApp.name}
          </div>
          <p className="mt-0.5 text-xs">
            Trình duyệt trong {inApp.name} không tải được file PDF thẳng về máy. Bạn vẫn có thể tạo
            PDF rồi bấm <b>Lưu / Chia sẻ PDF</b>; nếu máy không cho, hãy mở app bằng trình duyệt.
          </p>
          {openInBrowserHelp}
        </div>
      )}

      {pdfError && (
        <div role="alert" className="mb-3 flex items-start justify-between gap-3 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          <span>{pdfError}</span>
          <button type="button" onClick={() => setPdfError(null)} className="text-rose-700 hover:text-rose-900" aria-label="Đóng">
            ✕
          </button>
        </div>
      )}

      {readyPdf && (
        <div role="status" className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950">
          <div className="flex items-start justify-between gap-3">
            <div className="font-semibold">
              {readyPdfs.length > 1 ? `${readyPdfs.length} file PDF đã sẵn sàng (mỗi quán một file)` : "PDF đã sẵn sàng"}
            </div>
            <button
              type="button"
              onClick={() => { setReadyPdfs([]); setShareNote(null); }}
              className="text-emerald-800 hover:text-emerald-950"
              aria-label="Đóng"
            >
              ✕
            </button>
          </div>
          <div className="mt-2 space-y-2">
            {readyPdfs.map((file) => (
              <div key={file.filename} className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void onSharePdf(file)}
                  className="rounded bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
                >
                  Lưu / Chia sẻ
                </button>
                <span className="text-xs break-all">{file.filename}</span>
              </div>
            ))}
          </div>
          <p className="mt-1 text-xs">
            Trong bảng chia sẻ chọn <b>Lưu vào Tệp</b> (iPhone) hoặc gửi qua Zalo/Mail.
          </p>
          {shareNote && (
            <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">
              <div className="text-sm">{shareNote}</div>
              {openInBrowserHelp}
            </div>
          )}
        </div>
      )}

      {!isScheduleYearAllowed(schedule.year) && (
        <p role="alert" className="mb-3 text-sm text-rose-700">
          Chỉ xuất lịch cho các năm {SCHEDULE_YEAR_RANGE_LABEL}. Hãy chọn năm trong khoảng này.
        </p>
      )}

      {isLocked && (
        <div className="mb-3 rounded bg-amber-50 border border-amber-200 text-amber-900 text-sm px-3 py-2">
          <div className="font-medium">
            Lịch tháng này đã khóa vì đã in
            {stores.map((s) => s.schedule.lockedAt).find(Boolean) &&
              ` lúc ${new Date(stores.map((s) => s.schedule.lockedAt).find(Boolean) as string).toLocaleString("vi-VN")}`}
            .
          </div>
          <div className="mt-0.5">
            Không sửa được ca, không đổi nhân viên. Vẫn in được bình thường. Bấm Tạo lịch cũng
            mở khóa.
          </div>

          {/*
            Bewusst KEIN window.confirm: In-App-Browser (Messenger,
            Facebook) unterdrücken die native Rückfrage teilweise. Sie
            liefert dann stillschweigend false, der Klick tut nichts, und
            niemand erfährt warum. Die Rückfrage steht deshalb direkt hier.
          */}
          {!confirmUnlock ? (
            <button
              onClick={() => setConfirmUnlock(true)}
              className="mt-2 rounded border border-amber-400 bg-white px-3 py-1 text-sm font-medium text-amber-900 hover:bg-amber-100"
            >
              Mở khóa
            </button>
          ) : (
            <div className="mt-2 rounded border border-amber-300 bg-white px-3 py-2">
              <div className="text-amber-900">
                Mở khóa lịch tháng này? Bản đã in ở quán sẽ không còn khớp với hệ thống. Sau
                khi sửa, hãy in lại tuần đó và thay bản cũ.
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => {
                    unlockMonth();
                    setConfirmUnlock(false);
                  }}
                  className="rounded bg-amber-600 px-3 py-1 text-sm font-medium text-white hover:bg-amber-700"
                >
                  Xác nhận mở khóa
                </button>
                <button
                  onClick={() => setConfirmUnlock(false)}
                  className="rounded border border-slate-300 bg-white px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
                >
                  Huỷ
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Ganze A4-Seite sichtbar: auf die Breite verkleinert statt seitlich scrollen. */}
      {mode === "timesheet" && (
        <div className="space-y-4">
          {previewEmployees.map((employee) => (
            <div key={employee.id} className="rounded-lg border border-slate-300 shadow-sm bg-white">
              <FitToWidth>
                <StundenzettelPage schedule={previewStore.schedule} employee={employee} />
              </FitToWidth>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
