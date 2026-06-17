/**
 * Online-only-handlingar — klient-status (#417, ADR 0021).
 *
 * ADR 0021: externa sido-effekter (mail/SMTP, Fortnox-push, webhooks) modelleras
 * som **köat data-state + idempotent server-worker**. Klienten köar ingen egen
 * handling — den skapar en data-rad (t.ex. `invoiceDispatch` `queued`), synkar
 * den, och servern utför anropet. Klientens jobb är att **visa status** ("skickas
 * när du är online igen" / "skickad" / "misslyckades — försök igen").
 *
 * Den här modulen härleder en användarvänlig status ur rådstatusen + räknar
 * väntande handlingar för den globala indikatorn.
 */

import type { DispatchStatus } from "@/lib/shared/schemas/billing";

// Online-only-operationer (mail/SMTP, Fortnox-push, webhooks, OIDC-refresh) utförs
// server-side vid sync (ADR 0021); klienten visar bara status nedan.

/** Användarvänligt läge för en extern handling. */
export type ExternalActionStatus = "pending" | "done" | "failed";

/**
 * Härled läge ur en dispatch-/job-rådstatus. `queued` (+ okänt/in-flight) →
 * `pending`; `sent`/`delivered` → `done`; `failed` → `failed`.
 */
export function externalActionStatus(rawStatus: DispatchStatus | string): ExternalActionStatus {
  if (rawStatus === "sent" || rawStatus === "delivered") return "done";
  if (rawStatus === "failed") return "failed";
  return "pending";
}

/** Antal handlingar som väntar på att skickas (pending) — för global indikator. */
export function pendingExternalCount(items: ReadonlyArray<{ status: string }>): number {
  return items.filter((i) => externalActionStatus(i.status) === "pending").length;
}
