/**
 * Kronologisk scenario-runner (#880). Spelar upp ett ärendes `SimEvent[]` i
 * tidsordning via tRPC-callern med varje events datum — så demodatan byggs som om
 * en användare gjort stegen i tur och ordning. Belopp som beror på ackumulerat
 * arbete (aconto) härleds här ur `state`; dokumentbytes skrivs via `BinarySink`.
 */

import { coverageEntryRateOre } from "@/lib/shared/brottmalstaxa";
import { arvodeInclVatOre } from "@/lib/shared/invoice-calc";
import { SJALVRISK_ACCONTO_THRESHOLD_ORE } from "@/lib/shared/rattshjalp";
import type { SettlementViewLine } from "@/lib/shared/settlement-view";
import { AVA_NAMESPACE, uuidv5 } from "@/lib/shared/uuid-derive";
import { demoPaymentPlanId } from "../../scripts/demo-billing-ids";
import type { BinarySink } from "../backend-target";
import { ensureFolderPath } from "../folder-filing";
import { eventIso, eventTime } from "./clock";
import type { SimEvent, SimMatter } from "./events";
import { DOC_TEMPLATES, FOLDER_BY_RECIPIENT } from "./fake-content";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export interface RunCtx {
  c: Any; // GeneratorCaller (tRPC) — samma lösa typ som övriga demo-generator-moduler
  sink?: BinarySink;
  /** Gränsbelopp (öre) för tröskelstyrd aconto-utskick (#885); default = konstanten. */
  accontoThresholdOre?: number;
  res: { invoices: number; documents: number; timeEntries: number; notes: number; credits: number; paymentPlans: number; reminders: number; writeOffs: number; folders: number; dispatches: number; partySuggestions: number; eventSuggestions: number };
}

/** Nollställda räknare. Factory i stället för ett objekt-literal per anropsplats:
 *  räknarna växer med simuleringens täckning (#982 lade till tre), och literalen
 *  fanns då på sex ställen — två i verktygen, fyra i testerna. */
export function emptyRunResult(): RunCtx["res"] {
  return { invoices: 0, documents: 0, timeEntries: 0, notes: 0, credits: 0, paymentPlans: 0, reminders: 0, writeOffs: 0, folders: 0, dispatches: 0, partySuggestions: 0, eventSuggestions: 0 };
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
  /** Skapade mappar per ärende: sökväg ("Domstol" / "Domstol/Domar") → id (#985). */
  folders: Map<string, string>;
}

const isBillable = (e: { billable?: boolean }): boolean => e.billable !== false;

async function hParty(ctx: RunCtx, m: SimMatter, e: Any, iso: string): Promise<void> {
  await ctx.c.matter.addContact({ matterId: m.id, contactId: e.contactId, role: e.role, createdAt: iso });
}

/** Timarvodet (öre/tim) en tidspost värderas på i simuleringen. Täckningsärenden
 *  (rättshjälp OCH rättsskydd, #953) värderas på KATEGORINS norm för postens eget
 *  DATUM → 2025-poster får 2025-taxan, 2026-poster 2026-taxan, så aconton speglar
 *  tidpunkten och slutregleringens retroaktiva höjning blir synlig som en skillnad. */
function simTimeRateOre(m: SimMatter, e: Any, iso: string): number {
  if (m.paymentMethod !== "RATTSHJALP" && m.paymentMethod !== "RATTSSKYDD") return m.arvodeRateOre;
  return coverageEntryRateOre(e.entryKind, iso);
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
    st.periodLines.push({ date: iso.slice(0, 10), description: e.description, minutes: e.minutes, amountOre, kind: e.entryKind });
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
    billable: true, vatRate: e.vatRate ?? 2500, vatIncluded: false, passThrough: e.passThrough ?? false, userId: m.lawyerId, createdAt: iso,
  });
}

/** Mappen dokumentet filas i (#985) — skapas vid första behovet, räknas en gång. */
async function folderFor(ctx: RunCtx, m: SimMatter, path: string[], st: SimState): Promise<string | null> {
  const before = st.folders.size;
  const id = await ensureFolderPath(ctx.c, m.id, path, st.folders);
  ctx.res.folders += st.folders.size - before;
  return id;
}

async function hDoc(ctx: RunCtx, m: SimMatter, e: Any, iso: string, st: SimState): Promise<void> {
  const t = DOC_TEMPLATES[e.template];
  if (!t) return;
  const id = uuidv5(`simdoc:${m.id}:${st.docSeq++}`, AVA_NAMESPACE);
  const storagePath = `documents/content/${id}.pdf`;
  const fileName = `${t.title}.pdf`;
  const { generateDocumentBytes } = await import("../../scripts/seed-data");
  // `body` när mallen har en (#988) — det är den texten extraktionen läser, och
  // den ska stå i FILEN också, annars visar demon förslag som inte går att
  // härleda ur dokumentet man öppnar.
  const text = t.body ?? t.summary;
  const bytes = await generateDocumentBytes({ id, title: t.title, fileName, documentType: t.documentType, summary: text, mimeType: "application/pdf", storagePath });
  const size = ctx.sink ? ctx.sink(storagePath, bytes) : bytes.byteLength;
  // Filas efter mottagare (#985) — demon hade tidigare allt i roten, så
  // träd-vyns mapphantering gick varken att se eller prova.
  const folderPath = [FOLDER_BY_RECIPIENT[t.recipient], ...(t.subFolder ? [t.subFolder] : [])];
  const folderId = await folderFor(ctx, m, folderPath, st);
  await ctx.c.document.register({
    id, matterId: m.id, fileName, mimeType: "application/pdf", sizeBytes: size, storagePath, folderId,
    documentType: t.documentType, direction: t.direction, recipient: t.recipient, title: t.title, summary: t.summary,
    analysisStatus: "DONE", createdAt: iso,
  });
  ctx.res.documents++;
  // Kontakt- och händelseförslag ur texten (#988). Bara mallar med `body` bär
  // parter/kallelser; för övriga är det en no-op och kostar ett anrop.
  if (t.body !== undefined) {
    const res = await ctx.c.document.suggestFromText({ documentId: id, text: t.body }) as { parties: number; events: number };
    ctx.res.partySuggestions += res.parties;
    ctx.res.eventSuggestions += res.events;
  }
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

async function hBeslut(ctx: RunCtx, _m: SimMatter, e: Any, _iso: string, st: SimState): Promise<void> {
  if (!st.krRunId) return;
  // Domstolen kan PRUTA (#936): `reducedByBips` sätter ned det beviljade beloppet mot
  // det YRKADE. Vid rättshjälp bär BYRÅN mellanskillnaden (får ej tas av klienten) —
  // settleCoverage bokar den som en PRUTNING-post via bookFirmLoss.
  //
  // Nedsättningen räknas på KR:ns yrkade belopp (`workValueOreAtRun`) — arvode +
  // utlägg inkl moms — precis som en riktig domstol gör. Tidigare räknades den på
  // netto-arvodet för att kringgå #943 (motorn jämförde det beviljade bruttot mot
  // netto-arvodet och klampade bort nedsättningen). Den buggen är fixad, så demon
  // går nu samma väg som appen.
  const bips = Number(e.reducedByBips ?? 0);
  const awardedOre = bips > 0
    ? Math.round((st.krWorkValueOre * (10000 - bips)) / 10000)
    : st.krWorkValueOre;
  await ctx.c.billingRun.recordKostnadsrakningBeslut({ billingRunId: st.krRunId, awardedOre });
}

async function hVerdict(ctx: RunCtx, _m: SimMatter, _e: Any, _iso: string, st: SimState): Promise<void> {
  if (!st.krRunId) return;
  await ctx.c.billingRun.setVerdict({ billingRunId: st.krRunId });
  ctx.res.invoices++;
}

async function hSettle(ctx: RunCtx, m: SimMatter, e: Any, iso: string): Promise<void> {
  const res = await ctx.c.billingRun.settleCoverage({ matterId: m.id, payerRecipient: e.payerRecipient, invoiceDate: iso });
  ctx.res.invoices += 2;
  if (res.creditInvoice) ctx.res.credits++;
  // Slutfakturorna (klient + domstol) är utställda i demon → SENT, annars räknas de
  // inte i "Fakturerat" (t.ex. domstolens slutfaktura blev kvar som DRAFT).
  for (const inv of [res.clientInvoice, res.payerInvoice]) {
    if (inv && inv.status !== "SENT") await ctx.c.invoice.setStatus({ invoiceId: inv.id, status: "SENT" });
  }
}

async function hInsurerPruning(ctx: RunCtx, m: SimMatter, e: Any, iso: string): Promise<void> {
  // Försäkringen prutar EFTER slutregleringen (#905/#952): beloppet OMFÖRDELAS mellan
  // klientens två fakturor — inga nya fakturor skapas, så räknaren rörs inte.
  await ctx.c.billingRun.recordInsurerPruning({ matterId: m.id, prunedNetOre: e.prunedNetOre, invoiceDate: iso });
}

/**
 * Utskickshistorik (#985): en faktura som satts till SENT har i verkligheten
 * lämnat byrån på något sätt. `recordManual` — inte `queue` — eftersom demon
 * inte har någon dispatch-worker som skulle plocka upp en köad rad och "skicka"
 * den igen. Utan klientens e-post hoppas steget över; en påhittad adress i
 * demodatat vore sämre än en tom historik.
 */
async function recordDispatch(ctx: RunCtx, m: SimMatter, invoiceId: string, recipient: string): Promise<void> {
  if (recipient !== "KLIENT" || !m.clientEmail) return;
  await ctx.c.invoiceDispatch.recordManual({ invoiceId, channel: "email", recipient: m.clientEmail });
  ctx.res.dispatches++;
}

async function hFinal(ctx: RunCtx, m: SimMatter, e: Any, iso: string, st: SimState): Promise<void> {
  const { invoice } = await ctx.c.billingRun.createFinal({ matterId: m.id, recipient: e.recipient, deductedBillingRunIds: [], invoiceDate: iso });
  await ctx.c.invoice.setStatus({ invoiceId: invoice.id, status: "SENT" });
  st.lastFinal = { id: invoice.id, amount: invoice.amount };
  ctx.res.invoices++;
  await recordDispatch(ctx, m, invoice.id, String(e.recipient));
}

async function hPayment(ctx: RunCtx, _m: SimMatter, _e: Any, iso: string, st: SimState): Promise<void> {
  if (!st.lastFinal || st.lastFinal.amount <= 0) return;
  await ctx.c.invoice.recordPayment({ invoiceId: st.lastFinal.id, amount: st.lastFinal.amount, paidAt: iso, note: "Full betalning" });
}

/** `iso` förskjuten `n` månader (negativt = bakåt), aldrig senare än nu — en
 *  betalning daterad i framtiden vore inte demodata utan en bugg. */
function shiftMonths(iso: string, n: number): Date {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + n);
  const now = new Date();
  return d > now ? now : d;
}

/** Månad `n` bakåt från `iso` som "YYYY-MM" — påminnelsernas `dueMonth`. */
function monthsBack(iso: string, n: number): string {
  const d = shiftMonths(iso, -n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** En avbetalningsplans inbetalningar: vad, hur mycket, hur många, från när. */
interface InstallmentRun { invoiceId: string; monthly: number; total: number; count: number; iso: string }

/** Månadsvisa delbetalningar. Sista posten kapas till ÅTERSTODEN — annars
 *  översumerar den fakturan och routerns partitionsvakt (ADR 0007) avvisar den. */
async function payInstallments(ctx: RunCtx, run: InstallmentRun): Promise<void> {
  let paid = 0;
  for (let m = 0; m < run.count; m++) {
    const amount = Math.min(run.monthly, run.total - paid);
    if (amount <= 0) return;
    await ctx.c.invoice.recordPayment({
      invoiceId: run.invoiceId, amount,
      paidAt: shiftMonths(run.iso, m + 1).toISOString(), note: `Avbetalning ${m + 1}`,
    });
    paid += amount;
  }
}

/** N månatliga DUE-påminnelser bakåt från `iso`. */
async function sendPlanReminders(ctx: RunCtx, planId: string, iso: string, count: number): Promise<void> {
  for (let n = count; n >= 1; n--) {
    await ctx.c.paymentPlan.recordReminder({ planId, dueMonth: monthsBack(iso, n), type: "DUE" });
    ctx.res.reminders++;
  }
}

interface PlanArgs {
  installments: number; paidInstallments: number; dayOfMonth: number;
  reminders: number; cancel: boolean; notes?: string;
}

/** Eventets fält med defaults. Egen funktion för att hålla `hPaymentPlan` under
 *  komplexitetstaket (8) — varje default räknas som en gren. */
function planArgs(e: Any): PlanArgs {
  const { installments = 3, paidInstallments = 0, dayOfMonth = 15, reminders = 0, cancel = false, notes } = e as Partial<PlanArgs>;
  return { installments, paidInstallments, dayOfMonth, reminders, cancel, ...(notes === undefined ? {} : { notes }) };
}

/** Avbetalningsplan (#982) på den senaste slutfakturan. */
async function hPaymentPlan(ctx: RunCtx, m: SimMatter, e: Any, iso: string, st: SimState): Promise<void> {
  const inv = st.lastFinal;
  if (!inv || inv.amount <= 0) return;
  const { installments, paidInstallments, dayOfMonth, reminders, cancel, notes } = planArgs(e);
  const monthly = Math.ceil(inv.amount / Math.max(1, installments));
  const plan = await ctx.c.invoice.createPaymentPlan({
    id: demoPaymentPlanId(m.id), invoiceId: inv.id, monthlyAmount: monthly,
    dayOfMonth, startDate: iso, ...(notes === undefined ? {} : { notes }),
  });
  ctx.res.paymentPlans++;
  await sendPlanReminders(ctx, plan.id, iso, reminders);
  await payInstallments(ctx, { invoiceId: inv.id, monthly, total: inv.amount, count: paidInstallments, iso });
  // Avbryt EFTER betalningarna: en avbruten plan lämnar fakturan som SENT igen,
  // och de inbetalningar som hann göras ligger kvar — precis som i verkligheten.
  if (cancel) await ctx.c.invoice.cancelPaymentPlan({ planId: plan.id });
}

/** Konstaterad kundförlust (ADR 0007) på den senaste slutfakturan (#982). */
async function hWriteOff(ctx: RunCtx, _m: SimMatter, e: Any, iso: string, st: SimState): Promise<void> {
  const inv = st.lastFinal;
  if (!inv || inv.amount <= 0) return;
  const bips = Number(e.partialBips ?? 0);
  if (bips > 0) {
    const part = Math.floor((inv.amount * bips) / 10000);
    if (part > 0) await ctx.c.invoice.recordPayment({ invoiceId: inv.id, amount: part, paidAt: iso, note: "Delbetalning" });
  }
  // Utan `amount` skrivs hela ÅTERSTODEN av — routern räknar ut den ur ledgern,
  // så simuleringen slipper spegla den matematiken.
  await ctx.c.invoice.writeOff({ invoiceId: inv.id, reason: String(e.reason ?? "Klient försatt i konkurs"), writtenOffAt: iso });
  ctx.res.writeOffs++;
}

/** kind → handler. Håller runnern platt (undviker en stor switch = hög komplexitet). */
const HANDLERS: Record<SimEvent["kind"], (ctx: RunCtx, m: SimMatter, e: Any, iso: string, st: SimState) => Promise<void>> = {
  party: hParty, time: hTime, note: hNote, expense: hExpense, doc: hDoc, radgivning: hRadgivning,
  acconto: hAcconto, rateChange: hRateChange, kostnadsrakning: hKostnadsrakning, beslut: hBeslut, verdict: hVerdict, settle: hSettle, insurerPruning: hInsurerPruning, final: hFinal, payment: hPayment,
  paymentPlan: hPaymentPlan, writeOff: hWriteOff,
};

/** Spela upp ett ärendes scenario kronologiskt. */
export async function runScenario(ctx: RunCtx, matter: SimMatter, events: SimEvent[]): Promise<void> {
  const st: SimState = { accruedNetOre: 0, billedNetOre: 0, currentRateBips: matter.clientShareBips ?? 0, periodLines: [], krRunId: null, krWorkValueOre: 0, lastFinal: null, docSeq: 0, folders: new Map() };
  const sorted = [...events].sort((a, b) => a.dayOffset - b.dayOffset);
  for (const e of sorted) {
    const iso = eventIso(matter.startDaysAgo, e.dayOffset, 9 + (e.dayOffset % 6));
    await HANDLERS[e.kind](ctx, matter, e, iso, st);
  }
}
