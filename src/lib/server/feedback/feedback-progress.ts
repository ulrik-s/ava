/**
 * Hur långt en förfrågan kommit (#2216): delarna (arbetsordrarna i kodrepot),
 * när den godkändes, och uppskattningen av leveransen.
 *
 * Kön är en förenkling: delar från ANDRA förfrågningar som ligger i kön (inte
 * pågår, inte väntar på beslut) och skapades före förfrågans äldsta återstående
 * del räknas som före. Den riktiga ordningen tar också hänsyn till prioritet,
 * så uppskattningen kan bli både för kort och för lång — därför visas den som
 * ett spann i ord och uppdateras när något händer.
 */

import type { FeedbackEta, FeedbackItem, FeedbackProgress, FeedbackState } from "@/lib/shared/feedback";
import { estimateDelivery } from "@/lib/shared/feedback-eta";
import type { WorkOrder, WorkOrderSnapshot } from "../ports";

/** Innan beslutet visas bara statusen, aldrig delar eller uppskattning. */
const BEFORE_APPROVAL: ReadonlySet<FeedbackState> = new Set(["mottagen", "undersokt", "ej_bekraftad"]);
/** Inget mer händer — tidslinjen visar leveransen i stället för en uppskattning. */
const FINISHED: ReadonlySet<FeedbackState> = new Set(["levererad", "avslutad", "finns_redan", "uppdelad"]);

/** `feat(feedback): tråden visar …` → `Tråden visar …`. */
export function partTitle(title: string): string {
  const text = title.replace(/^[a-z]+(?:\([^)]*\))?!?:\s*/i, "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Delar från andra förfrågningar som ligger i kön före den här förfrågans äldsta återstående del. */
export function queueAhead(intake: number, remaining: readonly WorkOrder[], orders: readonly WorkOrder[]): number {
  const first = remaining[0]?.createdAt;
  if (first === undefined) return 0;
  return orders.filter((o) => o.intake !== intake && o.state === "i_ko" && o.createdAt < first).length;
}

function etaFor(item: Pick<FeedbackItem, "number" | "state">, mine: readonly WorkOrder[], snapshot: WorkOrderSnapshot): FeedbackEta {
  if (FINISHED.has(item.state)) return null;
  const remaining = mine.filter((o) => o.state !== "klar");
  return estimateDelivery({
    remaining: remaining.length,
    queueAhead: queueAhead(item.number, remaining, snapshot.orders),
    perDay: snapshot.perDay,
    blocked: remaining.some((o) => o.state === "vantar_beslut"),
    waitingForUser: item.state === "vantar_pa_dig",
  });
}

/** Förfrågans framsteg, eller undefined innan beslutet och när den saknar arbetsordrar. */
export function progressFor(item: Pick<FeedbackItem, "number" | "state">, snapshot: WorkOrderSnapshot): FeedbackProgress | undefined {
  if (BEFORE_APPROVAL.has(item.state)) return undefined;
  const mine = snapshot.orders.filter((o) => o.intake === item.number).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (mine.length === 0) return undefined;
  return {
    parts: mine.map((o) => ({ title: partTitle(o.title), state: o.state })),
    done: mine.filter((o) => o.state === "klar").length,
    total: mine.length,
    approvedAt: mine[0]?.createdAt ?? null,
    eta: etaFor(item, mine, snapshot),
  };
}

/** Förfrågningarna med framsteg där det finns; oförändrade utan arbetsordrar. */
export function withProgress(items: readonly FeedbackItem[], snapshot: WorkOrderSnapshot | null): FeedbackItem[] {
  if (!snapshot) return [...items];
  return items.map((i) => {
    const progress = progressFor(i, snapshot);
    return progress ? { ...i, progress } : i;
  });
}
