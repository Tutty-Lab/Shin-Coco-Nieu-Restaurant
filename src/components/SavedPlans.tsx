import { useState } from "react";
import type { UseScheduleReturn } from "../hooks/useSchedule";

/** "05.10. 14:32" – Datum zuerst, wie überall in der App. */
const fmt = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}. ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * Bản đã lưu của quán đang xem, chỉ cho tháng đang chọn. Trước mỗi lần Tạo lịch
 * app tự lưu bản cũ; chủ quán cũng tự lưu được. Khôi phục thì bản hiện tại được
 * lưu trước, nên không bao giờ mất.
 */
export function SavedPlans({ store }: { store: UseScheduleReturn }) {
  const { schedule } = store;
  const plans = (schedule.savedPlans ?? []).filter((p) => p.year === schedule.year && p.month === schedule.month);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);

  return (
    <details className="group mb-4 rounded-lg border border-slate-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        <span className="text-sm font-medium text-slate-700">
          Bản đã lưu{plans.length > 0 && <span className="font-normal text-slate-500"> ({plans.length})</span>}
        </span>
        <span className="text-slate-400 transition-transform group-open:rotate-90" aria-hidden="true">›</span>
      </summary>
      <div className="space-y-2 border-t border-slate-100 px-3 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={schedule.shifts.length === 0}
            onClick={() => {
              store.savePlan();
              setSavedNote(true);
              window.setTimeout(() => setSavedNote(false), 2500);
            }}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Lưu bản này
          </button>
          {savedNote && <span className="text-xs text-emerald-700">Đã lưu.</span>}
        </div>

        {plans.length === 0 ? (
          <p className="text-xs text-slate-400">Chưa có bản nào cho tháng này.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {plans.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="tabular-nums text-slate-800">{fmt(p.savedAt)}</span>
                <span className="text-xs text-slate-500">
                  {p.kind === "auto" ? "tự lưu" : "đã lưu"} · {p.shifts.length} ca
                </span>
                <span className="ml-auto flex items-center gap-1">
                  {confirmId === p.id ? (
                    <>
                      <span className="text-xs text-slate-600">Thay lịch hiện tại?</span>
                      <button
                        type="button"
                        onClick={() => {
                          store.restorePlan(p.id);
                          setConfirmId(null);
                        }}
                        className="rounded bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700"
                      >
                        Khôi phục
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmId(null)}
                        className="rounded px-2 py-1 text-xs text-slate-500 hover:text-slate-800"
                      >
                        Huỷ
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setConfirmId(p.id)}
                        className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
                      >
                        Khôi phục
                      </button>
                      <button
                        type="button"
                        onClick={() => store.deletePlan(p.id)}
                        aria-label="Xoá bản này"
                        className="rounded px-2 py-1 text-xs text-slate-400 hover:text-rose-600"
                      >
                        ✕
                      </button>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
