/**
 * Deterministiska billing-id för demo-genererade fakturor och avbetalningsplaner.
 *
 * Bakgrund: i `output: "export"` (GH-Pages-demon) pre-renderas dynamiska
 * rutter bara för id:n som `generateStaticParams` listar — och de listas
 * via `buildSeed → seedToFiles`. När populate-billing skapade INVOICES med
 * organiska (slumpmässiga) id:n hamnade /invoices/<organic> utanför
 * pre-render-listan → klicka i listan → 404 → SPA-fallback-loop / dashboard.
 *
 * Lösning: ge billing-mutationerna valfritt `id`. Generatorn använder
 * deterministiska id:n per ärende. `demoStaticParams` enumererar samma id:n
 * (över-set: 3 möjliga faktura-id + 1 plan-id per ärende; populate-billing
 * skapar bara en delmängd, oanvända blir tomma men harmlöst pre-renderade).
 *
 * Delas mellan `populate-billing.ts` (skapar) och `static-params.ts`
 * (enumererar) så de inte kan komma ur synk.
 */

export function demoFinalInvoiceId(matterId: string): string { return `inv-${matterId}-final`; }
export function demoAccontoInvoiceId(matterId: string): string { return `inv-${matterId}-acc`; }
export function demoCreditInvoiceId(matterId: string): string { return `inv-${matterId}-credit`; }
export function demoPaymentPlanId(matterId: string): string { return `pp-${matterId}`; }

type MatterLike = { id?: unknown };

/** Alla möjliga faktura-id:n (över-set; populate-billing skapar en delmängd). */
export function allDemoBillingInvoiceIds(matters: ReadonlyArray<MatterLike>): string[] {
  const out: string[] = [];
  for (const m of matters) {
    const id = typeof m.id === "string" ? m.id : null;
    if (!id) continue;
    out.push(demoFinalInvoiceId(id), demoAccontoInvoiceId(id), demoCreditInvoiceId(id));
  }
  return out;
}

/** Alla möjliga avbetalningsplan-id:n (en per ärende). */
export function allDemoBillingPlanIds(matters: ReadonlyArray<MatterLike>): string[] {
  const out: string[] = [];
  for (const m of matters) {
    const id = typeof m.id === "string" ? m.id : null;
    if (id) out.push(demoPaymentPlanId(id));
  }
  return out;
}
