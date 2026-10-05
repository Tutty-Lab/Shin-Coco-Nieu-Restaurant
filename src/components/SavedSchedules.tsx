import { useState } from "react";
import type { UseScheduleReturn } from "../hooks/useSchedule";
import { minutesToShortHours } from "../lib/time";

/**
 * Nút „Lịch đã lưu (N)" + danh sách (theo Thienlong/Vietpho) – dùng ở Lịch làm
 * việc và Bảng chấm công. Mỗi tháng một lịch: đổi tháng thì lịch đang mở tự
 * cất vào kho, mở lại tháng thì lịch của tháng đó quay về.
 * `openMonth` chuyển CẢ BA quán sang tháng đó (tháng dùng chung).
 */
export function SavedSchedulesButton({
  store,
  openMonth,
}: {
  store: UseScheduleReturn;
  openMonth: (year: number, month: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`rounded border px-3 py-1.5 text-sm font-medium ${
          open
            ? "border-slate-900 bg-slate-100 text-slate-900"
            : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"
        }`}
      >
        Lịch đã lưu ({store.savedMonths.length})
      </button>
      {open && (
        <div className="basis-full">
          <SavedSchedulesPanel store={store} openMonth={openMonth} onClose={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}

function SavedSchedulesPanel({
  store,
  openMonth,
  onClose,
}: {
  store: UseScheduleReturn;
  openMonth: (year: number, month: number) => void;
  onClose: () => void;
}) {
  const { savedMonths } = store;
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <span className="text-sm font-medium text-slate-800">Lịch đã lưu · {store.storeConfig.shortName}</span>
        <button
          type="button"
          onClick={onClose}
          className="text-lg leading-none text-slate-400 hover:text-slate-600"
          aria-label="Đóng"
        >
          ×
        </button>
      </div>
      {savedMonths.length === 0 ? (
        <p className="px-3 py-3 text-sm text-slate-500">
          Chưa có tháng nào. Tạo lịch cho một tháng, lịch sẽ tự được lưu khi đổi sang tháng khác.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {[...savedMonths].reverse().map((m) => (
            <li key={m.key} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="w-24 shrink-0 font-medium text-slate-900">
                Tháng {m.month}/{m.year}
              </span>
              <span className="min-w-0 flex-1 text-slate-500">
                {m.shiftCount} ca · {minutesToShortHours(m.totalMinutes)}
                {m.savedAt ? ` · lưu ${formatSavedAt(m.savedAt)}` : ""}
              </span>
              {m.current ? (
                <span className="shrink-0 rounded-full bg-slate-900 px-3 py-1 text-xs text-white">Đang mở</span>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    openMonth(m.year, m.month);
                    onClose();
                    // Về đầu trang để thấy rõ đã chuyển tháng.
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className="shrink-0 rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:border-slate-500"
                >
                  Mở
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** „24.09 14:30" */
function formatSavedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
