/**
 * Kronologisk scenario-runner (#880). Spelar upp ett ärendes `SimEvent[]` i
 * tidsordning via tRPC-callern med varje events datum — så demodatan byggs som om
 * en användare gjort stegen i tur och ordning. Belopp som beror på ackumulerat
 * arbete (aconto) härleds här ur `state`; dokumentbytes skrivs via `BinarySink`.
 */

import { timkostnadsnormFtaxForDate, tidsspillanFtaxForDate } from "@/lib/shared/brottmalstaxa";
import { arvodeInclVatOre } from "@/lib/shared/invoice-calc";
import { SJALVRISK_ACCONTO_THRESHOLD_ORE } from "@/lib/shared/rattshjalp";
import type { SettlementViewLine } from "@/lib/shared/settlement-view";
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
  /** Gränsbelopp (öre) för tröskelstyrd aconto-utskick (#885); default = konstanten. */
  accontoThresholdOre?: number;
  res: { invoices: number; documents: number; timeEntries: number; notes: number; credits: number };
}

interface SimState {
  accruedNetOre: number;      // ackumulerat debiterbart arvode (netto)
  billedNetOre: number;       // arvode-netto som redan täckts av aconton
  currentRateBips: number;    // klientens självrisk-sats just nu (#885, driver tröskel-aconto)
  periodLines: SettlementViewLine[]; // debiterbara tidsposter sedan förra acontot (#880)
  krRunId: string | null;
  krWorkValueOre: number;
  lastFinal: { id: string; amount: number } | null;
  docSeq: number;
}

const isBillable = (e: { billable?: boolean }): boolean => e.billable !== false;

async function hParty(ctx: RunCtx, m: SimMatter, e: Any, iso: string): Promise<void> {
  await ctx.c.matter.addContact({ matterId: m.id, contactId: e.contactId, role: e.role, createdAt: iso });
}

/** Timarvodet (öre/tim) en tidspost värderas på i simuleringen. Rättshjälp: den
 *  norm som gällde postens DATUM (#891) — arbete på timkostnadsnormen, tidsspillan
 *  på tidsspillan-normen → 2025-poster får 2025-taxan, 2026-poster 2026-taxan, så
 *  aconton speglar tidpunkten och slutregleringens retroaktiva höjning syns. */
function simTimeRateOre(m: SimMatter, e: Any, iso: string): number {
  if (m.paymentMethod !== "RATTSHJALP") return m.arvodeRateOre;
  return e.entryKind === "TIDSSPILLAN" ? tidsspillanFtaxForDate(iso) : timkostnadsnormFtaxForDate(iso);
}

async function hTime(ctx: RunCtx, m: SimMatter, e: Any, iso: string, st: SimState): Promise<void> {
  const rateOre = simTimeRateOre(m, e, iso);
  await ctx.c.timeEntry.create({
    matterId: m.id, date: iso, minutes: e.minutes, description: e.description,
    billable: isBillable(e), userId: m.lawyerId, hourlyRate: rateOre,
    ...(e.entryKind ? { kind: e.entryKind } : {}), createdAt: iso,
  });
  ctx.res.timeEntries++;
  if (isBillable(e)) {
    const amountOre = Math.round((e.minutes / 60) * rateOre);
    st.accruedNetOre += amountOre;
    st.periodLines.push({ date: iso.slice(0, 10), description: e.description, minutes: e.minutes, amountOre });
    await maybeAcconto(ctx, m, iso, st); // #885: skicka aconto när klientens andel nått tröskeln
  }
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

async function hRadgivning(ctx: RunCtx, m: SimMatter, _e: Any, iso: string): Promise<void> {
  // Rådgivningstimmen (#880): en debiterbar tidspost — så settlementens coverageBaseMinutes
  // −60 stämmer — MEN utanför aconto-basen (rör INTE accruedNetOre; allt EFTER rådgivningen
  // går på aconto). Faktureras separat SAMMA DAG som mötet.
  await ctx.c.timeEntry.create({
    matterId: m.id, date: iso, minutes: 60, description: "Rådgivning — första möte med klient",
    billable: true, userId: m.lawyerId, hourlyRate: simTimeRateOre(m, {}, iso), createdAt: iso,
  });
  ctx.res.timeEntries++;
  await ctx.c.invoice.createRadgivning({ matterId: m.id, invoiceDate: iso });
  ctx.res.invoices++;
}

/** Skicka ett aconto på klientens andel av NYTT arbete sedan förra acontot, vid `bips`.
 *  (Varje period faktureras för sig → varierande satser syns; slutregleringen jämkar
 *  mot myndighetens helhetsbeslut och ger ev. kredit vid överfakturering, #878.) */
async function sendAcconto(ctx: RunCtx, m: SimMatter, iso: string, st: SimState, bips: number): Promise<void> {
  const newWorkNet = st.accruedNetOre - st.billedNetOre;
  if (newWorkNet <= 0) return;
  const clientNet = Math.round((bips / 10000) * newWorkNet);
  const amountOre = arvodeInclVatOre(clientNet);
  if (amountOre <= 0) return;
  // Spec (#880): periodens arbete → klientens andel → moms, så klienten ser vad hen
  // betalar för. timeLines listar tidsposterna som utgör det upparbetade arbetet.
  const settlementBreakdown = {
    timeLines: st.periodLines,
    rows: [
      { label: "Upparbetat arbete i perioden (exkl moms)", amountOre: newWorkNet, kind: "add" as const },
      { label: `Klientens andel ${bips / 100} % (exkl moms)`, amountOre: clientNet, kind: "add" as const },
      { label: "Moms 25 %", amountOre: amountOre - clientNet, kind: "add" as const },
    ],
    totalLabel: "Att betala (inkl moms)", totalOre: amountOre,
  };
  const { invoice } = await ctx.c.billingRun.createAcconto({
    matterId: m.id, recipient: "KLIENT", clientShareBips: bips, amountOre,
    invoiceDate: iso, notes: `Aconto — klientens andel ${bips / 100} % (löpande)`, settlementBreakdown,
  });
  await ctx.c.invoice.setStatus({ invoiceId: invoice.id, status: "SENT" });
  st.billedNetOre = st.accruedNetOre;
  st.periodLines = [];
  ctx.res.invoices++;
}

/** FAST aconto (rättsskydd-självrisk) — skickas oavsett tröskel vid scenariots dag. */
async function hAcconto(ctx: RunCtx, m: SimMatter, e: Any, iso: string, st: SimState): Promise<void> {
  await sendAcconto(ctx, m, iso, st, e.clientShareBips);
}

/** Byt klientens självrisk-sats (#885). */
async function hRateChange(_ctx: RunCtx, _m: SimMatter, e: Any, _iso: string, st: SimState): Promise<void> {
  st.currentRateBips = e.clientShareBips;
}

/** Tröskelstyrt aconto (#885, rättshjälp): skicka FÖRST när klientens ackumulerade
 *  o-fakturerade andel (vid aktuell sats) nått byråns gränsbelopp. */
async function maybeAcconto(ctx: RunCtx, m: SimMatter, iso: string, st: SimState): Promise<void> {
  if (m.paymentMethod !== "RATTSHJALP") return;
  const newWorkNet = st.accruedNetOre - st.billedNetOre;
  const clientNet = Math.round((st.currentRateBips / 10000) * newWorkNet);
  const threshold = ctx.accontoThresholdOre ?? SJALVRISK_ACCONTO_THRESHOLD_ORE;
  if (clientNet < threshold) return;
  await sendAcconto(ctx, m, iso, st, st.currentRateBips);
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

async function hVerdict(ctx: RunCtx, _m: SimMatter, _e: Any, _iso: string, st: SimState): Promise<void> {
  if (!st.krRunId) return;
  await ctx.c.billingRun.setVerdict({ billingRunId: st.krRunId });
  ctx.res.invoices++;
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
  acconto: hAcconto, rateChange: hRateChange, kostnadsrakning: hKostnadsrakning, beslut: hBeslut, verdict: hVerdict, settle: hSettle, final: hFinal, payment: hPayment,
};

/** Spela upp ett ärendes scenario kronologiskt. */
export async function runScenario(ctx: RunCtx, matter: SimMatter, events: SimEvent[]): Promise<void> {
  const st: SimState = { accruedNetOre: 0, billedNetOre: 0, currentRateBips: matter.clientShareBips ?? 0, periodLines: [], krRunId: null, krWorkValueOre: 0, lastFinal: null, docSeq: 0 };
  const sorted = [...events].sort((a, b) => a.dayOffset - b.dayOffset);
  for (const e of sorted) {
    const iso = eventIso(matter.startDaysAgo, e.dayOffset, 9 + (e.dayOffset % 6));
    await HANDLERS[e.kind](ctx, matter, e, iso, st);
  }
}
