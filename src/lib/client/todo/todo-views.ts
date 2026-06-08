/**
 * Ren vy-logik för todo-listans dag/vecka/månad-växling (#88).
 *
 * Ingen React — bara datum-matematik + gruppering, så gränsfallen (vecka
 * börjar måndag, månadsgränser, navigering per vy) kan enhetstestas isolerat.
 * Allt i LOKAL tid (samma konvention som resten av todo/kalender-UI:t).
 */

export type TodoView = "day" | "week" | "month";

export interface DateRange {
  from: Date;
  to: Date;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** Måndag som veckostart (sv-SE/ISO-8601). */
function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7; // mån=0 … sön=6
  x.setDate(x.getDate() - dow);
  return x;
}

function startOfMonth(d: Date): Date {
  return startOfDay(new Date(d.getFullYear(), d.getMonth(), 1));
}

/** Tidsintervallet [from, to] som en vy täcker kring `anchor`. */
export function rangeForView(view: TodoView, anchor: Date): DateRange {
  if (view === "day") return { from: startOfDay(anchor), to: endOfDay(anchor) };
  if (view === "week") {
    const from = startOfWeek(anchor);
    const to = endOfDay(new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6));
    return { from, to };
  }
  const from = startOfMonth(anchor);
  const to = endOfDay(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)); // sista dagen i månaden
  return { from, to };
}

/** Flytta ankaret en vy-enhet framåt (`dir=1`) eller bakåt (`dir=-1`). */
export function shiftAnchor(view: TodoView, anchor: Date, dir: -1 | 1): Date {
  const x = new Date(anchor);
  if (view === "day") x.setDate(x.getDate() + dir);
  else if (view === "week") x.setDate(x.getDate() + 7 * dir);
  else x.setMonth(x.getMonth() + dir);
  return startOfDay(x);
}

/** Läsbar etikett för aktuell vy-period (sv-SE). */
export function viewRangeLabel(view: TodoView, anchor: Date): string {
  if (view === "day") {
    return anchor.toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "long" });
  }
  if (view === "month") {
    return anchor.toLocaleDateString("sv-SE", { month: "long", year: "numeric" });
  }
  const { from, to } = rangeForView("week", anchor);
  const f = from.toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
  const t = to.toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
  return `${f} – ${t}`;
}

export interface DayGroup<T> {
  /** Dagens startdatum (lokal midnatt). */
  day: Date;
  /** Stabil nyckel `YYYY-MM-DD` (lokal). */
  key: string;
  items: T[];
}

function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Gruppera tidsordnade poster per kalenderdag (lokal). Bevarar inkommande
 * ordning inom varje grupp; grupperna sorteras kronologiskt.
 */
export function groupByDay<T extends { at: Date | string }>(items: T[]): DayGroup<T>[] {
  const map = new Map<string, DayGroup<T>>();
  for (const item of items) {
    const at = item.at instanceof Date ? item.at : new Date(item.at);
    const day = startOfDay(at);
    const key = localDayKey(day);
    const group = map.get(key);
    if (group) group.items.push(item);
    else map.set(key, { day, key, items: [item] });
  }
  return [...map.values()].sort((a, b) => a.day.getTime() - b.day.getTime());
}
