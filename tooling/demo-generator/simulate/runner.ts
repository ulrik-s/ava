/**
 * Kronologisk scenario-runner (#880). Spelar upp ett ärendes `SimEvent[]` i
 * tidsordning via tRPC-callern med varje events datum — så demodatan byggs som om
 * en användare gjort stegen i tur och ordning. Belopp som beror på ackumulerat
 * arbete (aconto) härleds här ur `state`; dokumentbytes skrivs via `BinarySink`.
 */

import { arvodeInclVatOre } from "@/lib/shared/invoice-calc";
import { AVA_NAMESPACE, uuidv5 } from "@/lib/shared/uuid-derive";
import type { BinarySink } from "../populate-documents";
import { eventIso, eventTime } from "./clock";
import type { SimEvent, SimMatter } from "./events";
import { DOC_TEMPLATES } from "./fake-content";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export interface RunCtx {
  c: Any; // GeneratorCaller (tRPC) — samma lösa typ som övriga demo-generator-moduler
  sink?: BinarySink;
  res: { invoices: number; documents: number; timeEntries: number; notes: number; credits: number };
}

interface SimState {
  accruedNetOre: number;      // ackumulerat debiterbart arvode (netto)
  billedNetOre: number;       // arvode-netto som redan täckts av aconton
  krRunId: string | null;
  krWorkValueOre: number;
  lastFinal: { id: string; amount: number } | null;
  docSeq: number;
}

const isBillable = (e: { billable?: boolean }): boolean => e.billable !== false;

async function hParty(ctx: RunCtx, m: SimMatter, e: Any, iso: string): Promise<void> {
  await ctx.c.matter.addContact({ matterId: m.id, contactId: e.contactId, role: e.role, createdAt: iso });
}

async function hTime(ctx: RunCtx, m: SimMatter, e: Any, iso: string, st: SimState): Promise<void> {
  await ctx.c.timeEntry.create({
    matterId: m.id, date: iso, minutes: e.minutes, description: e.description,
    billable: isBillable(e), userId: m.lawyerId, hourlyRate: m.arvodeRateOre, createdAt: iso,
  });
  ctx.res.timeEntries++;
  if (isBillable(e)) st.accruedNetOre += Math.round((e.minutes / 60) * m.arvodeRateOre);
}

async function hNote(ctx: RunCtx, m: SimMatter, e: Any, iso: string): Promise<void> {
  await ctx.c.serviceNote.create({ matterId: m.id, date: iso, time: eventTime(), text: e.text, createdAt: iso });
  ctx.res.notes++;
}

async function hExpense(ctx: RunCtx, m: SimMatter, e: Any, iso: string): Promise<void> {
  await ctx.c.expense.create({
    matterId: m.id, date: iso, amount: e.amountOre, description: e.description,
    billable: true, vatRate: e.vatRate ?? 2500, vatIncluded: false, userId: m.lawyerId, createdAt: iso,
  });
}

async function hDoc(ctx: RunCtx, m: SimMatter, e: Any, iso: string, st: SimState): Promise<void> {
  const t = DOC_TEMPLATES[e.template];
  if (!t) return;
  const id = uuidv5(`simdoc:${m.id}:${st.docSeq++}`, AVA_NAMESPACE);
  const storagePath = `documents/content/${id}.pdf`;
  const fileName = `${t.title}.pdf`;
  const { generateDocumentBytes } = await import("../../scripts/seed-data");
  const bytes = await generateDocumentBytes({ id, title: t.title, fileName, documentType: t.documentType, summary: t.summary, mimeType: "application/pdf", storagePath });
  const size = ctx.sink ? ctx.sink(storagePath, bytes) : bytes.byteLength;
  await ctx.c.document.register({
    id, matterId: m.id, fileName, mimeType: "application/pdf", sizeBytes: size, storagePath,
    documentType: t.documentType, direction: t.direction, title: t.title, summary: t.summary,
    analysisStatus: "DONE", createdAt: iso,
  });
  ctx.res.documents++;
}

async function hRadgivning(ctx: RunCtx, m: SimMatter, _e: Any, _iso: string): Promise<void> {
  await ctx.c.invoice.createRadgivning({ matterId: m.id });
  ctx.res.invoices++;
}

async function hAcconto(ctx: RunCtx, m: SimMatter, e: Any, iso: string, st: SimState): Promise<void> {
  // Klientens andel av NYTT arbete sedan förra acontot, vid periodens sats (#880).
  // (Varje period fakturas för sig → varierande satser syns; slutregleringen jämkar
  // mot myndighetens helhetsbeslut och ger ev. kredit vid överfakturering, #878.)
  const newWorkNet = st.accruedNetOre - st.billedNetOre;
  if (newWorkNet <= 0) return;
  const clientNet = Math.round((e.clientShareBips / 10000) * newWorkNet);
  const amountOre = arvodeInclVatOre(clientNet);
  if (amountOre <= 0) return;
  const { invoice } = await ctx.c.billingRun.createAcconto({
    matterId: m.id, recipient: "KLIENT", clientShareBips: e.clientShareBips, amountOre,
    invoiceDate: iso, notes: `Aconto — klientens andel ${e.clientShareBips / 100} % (löpande)`,
  });
  await ctx.c.invoice.setStatus({ invoiceId: invoice.id, status: "SENT" });
  st.billedNetOre = st.accruedNetOre;
  ctx.res.invoices++;
}

async function hKostnadsrakning(ctx: RunCtx, m: SimMatter, _e: Any, _iso: string, st: SimState): Promise<void> {
  const { run } = await ctx.c.billingRun.createKostnadsrakning({ matterId: m.id, notes: "Kostnadsräkning till domstol" });
  st.krRunId = run.id;
  st.krWorkValueOre = run.workValueOreAtRun ?? 0;
}

async function hBeslut(ctx: RunCtx, _m: SimMatter, _e: Any, _iso: string, st: SimState): Promise<void> {
  if (!st.krRunId) return;
  await ctx.c.billingRun.recordKostnadsrakningBeslut({ billingRunId: st.krRunId, awardedOre: st.krWorkValueOre });
}

async function hSettle(ctx: RunCtx, m: SimMatter, e: Any, _iso: string): Promise<void> {
  const res = await ctx.c.billingRun.settleCoverage({ matterId: m.id, payerRecipient: e.payerRecipient });
  ctx.res.invoices += 2;
  if (res.creditInvoice) ctx.res.credits++;
}

async function hFinal(ctx: RunCtx, m: SimMatter, e: Any, iso: string, st: SimState): Promise<void> {
  const { invoice } = await ctx.c.billingRun.createFinal({ matterId: m.id, recipient: e.recipient, deductedBillingRunIds: [], invoiceDate: iso });
  await ctx.c.invoice.setStatus({ invoiceId: invoice.id, status: "SENT" });
  st.lastFinal = { id: invoice.id, amount: invoice.amount };
  ctx.res.invoices++;
}

async function hPayment(ctx: RunCtx, _m: SimMatter, _e: Any, iso: string, st: SimState): Promise<void> {
  if (!st.lastFinal || st.lastFinal.amount <= 0) return;
  await ctx.c.invoice.recordPayment({ invoiceId: st.lastFinal.id, amount: st.lastFinal.amount, paidAt: iso, note: "Full betalning" });
}

/** kind → handler. Håller runnern platt (undviker en stor switch = hög komplexitet). */
const HANDLERS: Record<SimEvent["kind"], (ctx: RunCtx, m: SimMatter, e: Any, iso: string, st: SimState) => Promise<void>> = {
  party: hParty, time: hTime, note: hNote, expense: hExpense, doc: hDoc, radgivning: hRadgivning,
  acconto: hAcconto, kostnadsrakning: hKostnadsrakning, beslut: hBeslut, settle: hSettle, final: hFinal, payment: hPayment,
};

/** Spela upp ett ärendes scenario kronologiskt. */
export async function runScenario(ctx: RunCtx, matter: SimMatter, events: SimEvent[]): Promise<void> {
  const st: SimState = { accruedNetOre: 0, billedNetOre: 0, krRunId: null, krWorkValueOre: 0, lastFinal: null, docSeq: 0 };
  const sorted = [...events].sort((a, b) => a.dayOffset - b.dayOffset);
  for (const e of sorted) {
    const iso = eventIso(matter.startDaysAgo, e.dayOffset, 9 + (e.dayOffset % 6));
    await HANDLERS[e.kind](ctx, matter, e, iso, st);
  }
}
