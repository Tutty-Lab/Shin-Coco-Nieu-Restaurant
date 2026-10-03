// Plant alle Läden wie „Tạo lịch làm việc" und zeigt die Leute, die in zwei
// Läden arbeiten: Stunden je Laden, Soll, und ob sich Tage überschneiden.
import { generateSchedule } from "../src/lib/scheduler";
import { STORES } from "../src/lib/stores";
import { DEFAULT_WORK_HOURS } from "../src/lib/workHours";
import { monthlyTargetMinutesFor } from "../src/lib/contract";

const [year, month] = (process.argv[2] ?? "2026-09").split("-").map(Number);
const busy = new Map<string, Set<string>>();
const rows: string[] = [];
const perPerson = new Map<string, Map<string, string[]>>();
for (const store of STORES) {
  const employees = store.sampleEmployees();
  const blocked: Record<string, string[]> = {};
  for (const e of employees) {
    const d = e.personKey ? busy.get(e.personKey) : undefined;
    if (d?.size) blocked[e.id] = [...d];
  }
  const shifts = generateSchedule({
    year, month, workHours: DEFAULT_WORK_HOURS, employees,
    rules: store.staffingRules, weights: store.dayWeights, blockedDays: blocked, storeTag: store.id,
  });
  for (const e of employees) {
    if (!e.personKey) continue;
    const own = shifts.filter((s) => s.employeeId === e.id);
    const dates = busy.get(e.personKey) ?? new Set<string>();
    own.forEach((s) => dates.add(s.date));
    busy.set(e.personKey, dates);
    const p = perPerson.get(e.personKey) ?? new Map();
    p.set(store.shortName, [...new Set(own.map((s) => s.date))]);
    perPerson.set(e.personKey, p);
    const paid = own.reduce((a, s) => a + s.paidMinutes, 0) / 60;
    let soll: number | string = "?";
    try { soll = (monthlyTargetMinutesFor as any)(e, year, month, DEFAULT_WORK_HOURS) / 60; } catch { /* */ }
    rows.push(`${store.shortName.padEnd(8)} ${e.name.padEnd(16)} ${String(new Set(own.map((s) => s.date)).size).padStart(2)} Tage  ${paid.toFixed(1).padStart(6)} h  (Soll ${typeof soll === "number" ? soll.toFixed(1) : soll} h)`);
  }
}
console.log(`${year}-${String(month).padStart(2, "0")}`);
rows.forEach((r) => console.log(r));
for (const [key, byStore] of perPerson) {
  const all = [...byStore.values()].flat();
  const dup = all.filter((d, i) => all.indexOf(d) !== i);
  console.log(`${key}: ${dup.length ? "TRÙNG " + dup.join(",") : "không trùng ngày"}`);
}
