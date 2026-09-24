/**
 * Frister (#1162): när är en uppgift "inne"? En frist är ett DATUM, så vi
 * jämför kalenderdagar i lokal tid — inte klockslag. En frist kl. 00:00 i dag
 * är lika mycket "i dag" som en kl. 23:59.
 */

/** `overdue` = passerad, `today` = i dag, `upcoming` = framtida, `none` = ingen frist. */
export type DeadlineState = "overdue" | "today" | "upcoming" | "none";

export interface Deadline {
  state: DeadlineState;
  /** Hela dagar sedan fristen (>0 försenad, 0 i dag, <0 kvar). 0 utan frist. */
  daysLate: number;
}

const DAY_MS = 86_400_000;

/** Lokal midnatt för en tidpunkt (demo-datalagret ger ibland ISO-strängar). */
function localDay(d: Date | string): number {
  const x = d instanceof Date ? d : new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
}

export function deadlineOf(dueAt: Date | string | null | undefined, now: Date = new Date()): Deadline {
  if (dueAt == null || Number.isNaN(new Date(dueAt).getTime())) return { state: "none", daysLate: 0 };
  const daysLate = Math.round((localDay(now) - localDay(dueAt)) / DAY_MS);
  if (daysLate > 0) return { state: "overdue", daysLate };
  return { state: daysLate === 0 ? "today" : "upcoming", daysLate };
}

/** Fristen är inne (i dag eller passerad) och uppgiften inte klar → ska lysa rött. */
export function isDeadlineDue(task: { dueAt?: Date | string | null; status?: string | null }, now: Date = new Date()): boolean {
  if (task.status === "DONE") return false;
  const { state } = deadlineOf(task.dueAt, now);
  return state === "overdue" || state === "today";
}
