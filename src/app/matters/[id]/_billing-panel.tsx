"use client";

/**
 * `BillingPanel` — översikt + skapa-faktura-actions per ärende.
 *
 * Visar summa-kort (Upparbetat / Aconto fakturerat / Beräknat netto),
 * lista över billing-runs (aconto, slutfaktura, kostnadsräkning) och en
 * "+ Skapa faktura"-knapp som öppnar rätt dialog beroende på matter:s
 * paymentMethod.
 *
 * KOSTNADSRAKNING i PENDING_VERDICT-state får en "Ange dom"-knapp som
 * öppnar verdict-dialogen (sätter prutning + skapar faktura).
 */
import type { inferRouterOutputs } from "@trpc/server";
import { useEffect, useRef, useState } from "react";
import { DecimalInput } from "@/components/ui/decimal-input";
import { Modal } from "@/components/ui/modal";
import { Money } from "@/components/ui/money";
import type { DownloadClient } from "@/lib/client/backend/load-document-blob";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { hasGeneratedDoc, openGeneratedDoc } from "@/lib/client/demo/generated-doc-cache";
import { useMatterInvariants } from "@/lib/client/diagnostics/use-matter-invariants";
import { isDemoTier } from "@/lib/client/firma/firma-config";
import { generateFakturaDoc } from "@/lib/client/kostnadsrakning/generate-faktura-doc";
import { generateKrDoc } from "@/lib/client/kostnadsrakning/generate-kr-doc";
import { trpc } from "@/lib/client/trpc";
import { formatCurrency } from "@/lib/client/utils";
import type { AppRouter } from "@/lib/server/routers/_app";
import { availableActions, currentPhase, type BillingAction, type BillingPhase, type FlowMatter } from "@/lib/shared/billing-flow";
import { availableKrActions, KOSTNADSRAKNING_STATUS_LABELS, type KostnadsrakningState, type KostnadsrakningStatus } from "@/lib/shared/kostnadsrakning-flow";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import { computeRadgivningsavgift, SJALVRISK_ACCONTO_THRESHOLD_ORE } from "@/lib/shared/rattshjalp";
import { BILLING_RUN_TYPE_LABELS, BILLING_RUN_STATUS_LABELS, INVOICE_STATUS_LABELS, type BillingRunRecipient, type BillingRunStatus, type BillingRunType, type PaymentMethod } from "@/lib/shared/schemas/enums";
import type { BillingRunId, DocumentId, InvoiceId, MatterId } from "@/lib/shared/schemas/ids";
import { BillingDialog, type BillingMeta } from "./_billing-dialog";
import { KostnadsrakningModal } from "./_kostnadsrakning-modal";
import { SettlementDialog } from "./_settlement-dialog";
import { VerdictDialog } from "./_verdict-dialog";

interface MatterContext {
  matterNumber: string;
  title: string;
  taxaLevel?: number | null | undefined;
  taxaHasFTax?: boolean | null | undefined;
  taxaHufStart?: string | Date | null | undefined;
  isTaxeArende?: boolean | null | undefined;
  paymentMethod?: PaymentMethod | null | undefined;
  clientShareBips?: number | null | undefined;
  radgivningBetaldAt?: string | Date | null | undefined;
  rattsskyddNekadAt?: string | Date | null | undefined;
  contacts?: ReadonlyArray<{ role: string; contact?: { name?: string | null | undefined; email?: string | null | undefined } | null | undefined }> | undefined;
}

interface Props {
  matterId: MatterId;
  matter: MatterContext;
}

interface BillingRunRow {
  id: BillingRunId;
  type: BillingRunType;
  status: BillingRunStatus;
  recipient: BillingRunRecipient;
  amountOre: number;
  createdAt: string | Date;
  invoiceId?: InvoiceId | null;
  invoice?: { id: InvoiceId; invoiceNumber?: string | null } | null;
  kostnadsrakningStatus?: KostnadsrakningStatus | null;
  awardedOre?: number | null;
  beslutSlutgiltigt?: boolean | null;
}

/** Fristående klientfaktura (utan billing-run) som visas i faktura-listan (#853). */
interface StandaloneInvoiceRow { id: InvoiceId; invoiceNumber?: string | null; status: string; amount: number }

/** Fakturor som INTE är kopplade till en billing-run (t.ex. rådgivningstimmen). */
function standaloneInvoices(invoices: StandaloneInvoiceRow[] | undefined, rows: BillingRunRow[]): StandaloneInvoiceRow[] {
  const runInvoiceIds = new Set(rows.map((r) => String(r.invoiceId)).filter((id) => id !== "null" && id !== "undefined"));
  return (invoices ?? []).filter((i) => !runInvoiceIds.has(String(i.id)));
}

interface KrDocInfo { id: DocumentId; fileName: string; storagePath: string | null }

type DocumentListOutput = inferRouterOutputs<AppRouter>["document"]["list"];

/** Väljer KR-dokumentet närmast en körning i tid (pure — ingen hook, så den kan
 *  anropas per rad i listan). Vanligtvis 1 KR-dokument per ärende i MVP. */
function pickKrDoc(list: DocumentListOutput["documents"], run: BillingRunRow): KrDocInfo | null {
  const kostn = list.filter((d) => d.documentType === "Kostnadsräkning");
  if (kostn.length === 0) return null;
  const runTs = new Date(run.createdAt).getTime();
  const sorted = [...kostn].sort((a, b) => {
    const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return Math.abs(at - runTs) - Math.abs(bt - runTs);
  });
  const d = sorted[0];
  return d ? { id: d.id, fileName: d.fileName, storagePath: d.storagePath ?? null } : null;
}

function findKrDocument(matterId: MatterId, run: BillingRunRow): KrDocInfo | null {
  const docs: DocumentListOutput | undefined = trpc.document.list.useQuery({ matterId, folderId: null, pageSize: 100 }).data;
  return pickKrDoc(docs?.documents ?? [], run);
}

/**
 * Öppna KR-dokumentet. Genererat-i-fliken → blob-cachen (öppna direkt).
 * Annars (seedat/server-hostat) → samma väg som faktura-dokumenten:
 * `openDocument` hämtar bytes från servern (`downloadContent`) eller GH Pages.
 */
async function openKrDoc(doc: KrDocInfo, client: DownloadClient): Promise<void> {
  if (hasGeneratedDoc(doc.id)) { openGeneratedDoc(doc.id); return; }
  const { openDocument } = await import("@/lib/client/firma/open-document");
  const { loadHandle } = await import("@/lib/client/fsa/handle-store");
  const { readFromFsa } = await import("@/lib/client/fsa/read-from-fsa");
  const { loadDocumentBlob } = await import("@/lib/client/backend/load-document-blob");
  await openDocument({
    doc: { id: doc.id, ...(doc.storagePath != null ? { storagePath: doc.storagePath } : {}), fileName: doc.fileName },
    // RUNTIME-tier, inte NEXT_PUBLIC_DEMO_BUILD (sant även i lokala self-hosted-
    // builden → länkade dokument till GH Pages = 404). #844.
    isDemo: isDemoTier(),
    ...omitUndefined({ demoRepo: process.env.NEXT_PUBLIC_DEFAULT_DEMO_REPO }),
    loadHandle: () => loadHandle("repo-root"),
    readFromHandle: readFromFsa,
    // Server-first (#518/#839): hämta bytes från servern (+ klient-cache).
    fetchBlob: () => loadDocumentBlob(client, { id: doc.id, storagePath: doc.storagePath, fileName: doc.fileName }),
    openUrl: (u) => window.open(u, "_blank", "noopener,noreferrer"),
    notifyError: (m) => alert(m),
  });
}

/** Etikett för KR:ns nästa beslut-knapp (tingsrätt först, sen hovrätt). */
function beslutButtonLabel(state: KostnadsrakningState): string {
  return state.status === "OVERKLAGAD" ? "Registrera hovrättens beslut" : "Registrera beslut";
}

interface KrCardProps {
  matterId: MatterId; run: BillingRunRow;
  onRegistreraBeslut: () => void; onOverklaga: () => void; onSkapaFaktura: () => void;
}

/**
 * Kostnadsräknings-kort (#828) — visar KR:ns livscykel-status + dömt belopp +
 * dokument, och de tillåtna nästa-stegen (registrera beslut → skapa faktura /
 * överklaga → registrera hovrättens beslut). Ersätter den gamla dom-bannern.
 */
function KostnadsrakningCard({ matterId, run, onRegistreraBeslut, onOverklaga, onSkapaFaktura }: KrCardProps) {
  const doc = findKrDocument(matterId, run);
  const utils = trpc.useUtils();
  const state: KostnadsrakningState = { status: run.kostnadsrakningStatus ?? "INSKICKAD", slutgiltigt: run.beslutSlutgiltigt ?? false };
  return (
    <div className="mx-6 my-3 rounded border border-amber-300 bg-amber-50 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
      <div className="text-sm text-amber-900 space-y-1">
        <div>
          <strong>Kostnadsräkning</strong> — {KOSTNADSRAKNING_STATUS_LABELS[state.status]}
          {run.awardedOre != null && state.status !== "INSKICKAD" && (
            // awardedOre lagras brutto (= workValueOreAtRun, inkl moms) → basis="gross"
            // så Dömt belopp och "Upparbetat" visas på samma momsbasis (#839).
            <> · Dömt belopp: <Money ore={run.awardedOre} basis="gross" className="font-mono font-semibold" /></>
          )}
        </div>
        {doc && (
          <div className="text-xs text-amber-800">
            Dokument:{" "}
            <button type="button" onClick={() => void openKrDoc(doc, utils.client)}
              className="underline hover:text-amber-900 text-amber-900 cursor-pointer">{doc.fileName}</button>
          </div>
        )}
      </div>
      <KrCardButtons state={state} onRegistreraBeslut={onRegistreraBeslut} onOverklaga={onOverklaga} onSkapaFaktura={onSkapaFaktura} />
    </div>
  );
}

/** KR-kortets nästa-stegs-knappar — vilka som visas styrs av availableKrActions. */
function KrCardButtons({ state, onRegistreraBeslut, onOverklaga, onSkapaFaktura }: {
  state: KostnadsrakningState; onRegistreraBeslut: () => void; onOverklaga: () => void; onSkapaFaktura: () => void;
}) {
  const acts = availableKrActions(state);
  const canBeslut = acts.includes("REGISTRERA_BESLUT") || acts.includes("REGISTRERA_HOVRATT_BESLUT");
  return (
    <div className="flex gap-2 whitespace-nowrap">
      {canBeslut && <button onClick={onRegistreraBeslut} className="text-xs px-3 py-1 bg-amber-600 text-white rounded hover:bg-amber-700">{beslutButtonLabel(state)}</button>}
      {acts.includes("SKAPA_FAKTURA") && <button onClick={onSkapaFaktura} className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">Skapa faktura</button>}
      {acts.includes("OVERKLAGA") && <button onClick={onOverklaga} className="text-xs px-3 py-1 border border-amber-600 text-amber-800 rounded hover:bg-amber-100">Överklaga prutning</button>}
    </div>
  );
}

/**
 * Registrera domstolens beslut (#828): dömt belopp (kr) + ev. prutning (kr).
 * Används för både tingsrättens första beslut och hovrättens (slutgiltiga) —
 * servern väljer rätt övergång ur KR:ns nuvarande status.
 */
function RecordBeslutDialog({ billingRunId, onClose, onDone }: { billingRunId: BillingRunId; onClose: () => void; onDone: () => void }) {
  const [awardedKr, setAwardedKr] = useState<number | null>(null);
  const [prutningKr, setPrutningKr] = useState<number | null>(null);
  const record = trpc.billingRun.recordKostnadsrakningBeslut.useMutation({
    onSuccess: () => { onDone(); onClose(); },
  });
  const submit = (): void => {
    record.mutate({
      billingRunId,
      awardedOre: Math.round((awardedKr ?? 0) * 100),
      ...(prutningKr != null ? { prutningOre: -Math.abs(Math.round(prutningKr * 100)) } : {}),
    });
  };
  return (
    <Modal open title="Registrera domstolens beslut" onClose={onClose} widthClass="max-w-md">
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-3">
        <p className="text-sm text-gray-600">Ange det belopp domstolen dömde (och ev. prutning). Fakturan skapas i ett separat steg.</p>
        <label className="block text-xs font-medium">Dömt belopp (kr)
          <DecimalInput value={awardedKr} onChange={setAwardedKr} placeholder="Skriv in belopp"
            className="mt-1 w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
        </label>
        <label className="block text-xs font-medium">Prutning (kr, valfritt)
          <DecimalInput value={prutningKr} onChange={setPrutningKr} placeholder="0"
            className="mt-1 w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
        </label>
        {record.error && <p className="text-sm text-red-700">{record.error.message}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">Avbryt</button>
          <button type="submit" disabled={record.isPending} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            {record.isPending ? "Sparar…" : "Spara beslut"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

type DialogState = "NONE" | "ACCONTO" | "FINAL";

function findPendingVerdict(rows: BillingRunRow[]): BillingRunRow | undefined {
  return rows.find((r) => r.type === "KOSTNADSRAKNING" && r.status === "PENDING_VERDICT");
}

function clientOf(matter: MatterContext): string {
  return matter.contacts?.find((c) => c.role === "KLIENT")?.contact?.name ?? "";
}

function courtOf(matter: MatterContext): string | undefined {
  return matter.contacts?.find((c) => c.role === "DOMSTOL")?.contact?.name ?? undefined;
}

interface DialogsProps {
  matterId: MatterId; matter: MatterContext; rows: BillingRunRow[];
  dialog: DialogState; setDialog: (s: DialogState) => void;
  verdictRunId: BillingRunId | null; setVerdictRunId: (id: BillingRunId | null) => void;
  onRefetch: () => void;
}

function useBillingMeta(matter: MatterContext): BillingMeta {
  const org = orgProps(trpc.organization.getSettings.useQuery().data ?? undefined);
  return {
    matterNumber: matter.matterNumber, matterTitle: matter.title,
    ...omitUndefined({ clientName: clientOf(matter) || undefined, organizationName: org.name, organizationOrgNumber: org.orgNumber, clientShareBips: matter.clientShareBips ?? undefined }),
  };
}

/** KR:ns föreslagna + dömda belopp till verdict-dialogen (faller tillbaka på
 *  föreslaget när dömt ännu saknas) — utbrutet så BillingDialogs håller sig ≤8. */
function verdictAmounts(pending: BillingRunRow | undefined): { workValueOre: number; awardedOre: number } {
  const workValueOre = pending?.amountOre ?? 0;
  return { workValueOre, awardedOre: pending?.awardedOre ?? workValueOre };
}

function BillingDialogs({ matterId, matter, rows, dialog, setDialog, verdictRunId, setVerdictRunId, onRefetch }: DialogsProps) {
  const pending = findPendingVerdict(rows);
  const amounts = verdictAmounts(pending);
  const meta = useBillingMeta(matter);
  return (
    <>
      {dialog !== "NONE" && (
        <BillingDialog matterId={matterId} type={dialog} meta={meta}
          existingAccontos={rows.filter((r) => r.type === "ACCONTO" && r.status === "SENT")}
          onClose={() => { setDialog("NONE"); onRefetch(); }} />
      )}
      {verdictRunId && (
        <VerdictDialog billingRunId={verdictRunId} workValueOre={amounts.workValueOre}
          awardedOre={amounts.awardedOre}
          matterId={matterId} matterNumber={matter.matterNumber} matterTitle={matter.title}
          clientName={clientOf(matter)}
          onClose={() => { setVerdictRunId(null); onRefetch(); }} />
      )}
    </>
  );
}

interface KrTriggerProps {
  matterId: MatterId;
  matter: MatterContext;
  open: boolean;
  onClose: () => void;
  onRecorded: () => void;
}

interface KrModalData {
  defenderName: string;
  defenderEmail?: string;
  organizationName?: string;
  organizationOrgNumber?: string;
  organizationAddress?: string;
  expenses: Array<{ id: string; date: string | Date; description: string; amount: number; vatRate?: number; vatIncluded?: boolean; billable?: boolean }>;
}

function strOrUndef(v: string | null | undefined): string | undefined {
  return v ?? undefined;
}

interface OrgData { name?: string; orgNumber?: string; address?: string }
function orgProps(org: { name?: string | null | undefined; orgNumber?: string | null | undefined; address?: string | null | undefined } | undefined): OrgData {
  const name = strOrUndef(org?.name);
  const orgNumber = strOrUndef(org?.orgNumber);
  const address = strOrUndef(org?.address);
  return omitUndefined({ name, orgNumber, address });
}

function useKrModalData(matterId: MatterId): KrModalData {
  const me = trpc.user.current.useQuery().data;
  const org = orgProps(trpc.organization.getSettings.useQuery().data ?? undefined);
  const expenses = trpc.expense.list.useQuery({ matterId }).data?.expenses ?? [];
  // omitUndefined samlar exactOptional-strippningen (#32) på ett ställe så
  // funktionen inte spräcker complexity-gränsen.
  return omitUndefined({
    defenderName: me?.name ?? "",
    defenderEmail: strOrUndef(me?.email),
    organizationName: org.name,
    organizationOrgNumber: org.orgNumber,
    organizationAddress: org.address,
    expenses: expenses as KrModalData["expenses"],
  }) as KrModalData;
}

/** Väljer rätt kostnadsräknings-dialog: rättshjälp får en enkel inskicks-
 *  bekräftelse (timkostnadsnorm), övriga (offentligt uppdrag) brottmåls-modalen. */
function KostnadsrakningEntry({ matterId, matter, open, onClose, onRecorded }: KrTriggerProps) {
  if (matter.paymentMethod === "RATTSHJALP") {
    return open ? <RattshjalpKrDialog matterId={matterId} matter={matter} onClose={onClose} onRecorded={onRecorded} /> : null;
  }
  return <KostnadsrakningTrigger matterId={matterId} matter={matter} open={open} onClose={onClose} onRecorded={onRecorded} />;
}

function KostnadsrakningTrigger({ matterId, matter, open, onClose, onRecorded }: KrTriggerProps) {
  const data = useKrModalData(matterId);
  const createKr = trpc.billingRun.createKostnadsrakning.useMutation();
  if (!open) return null;
  const onModalClose = (): void => {
    onClose();
    createKr.mutate({ matterId }, { onSuccess: onRecorded });
  };
  return (
    <KostnadsrakningModal
      matterId={matterId}
      matterNumber={matter.matterNumber}
      matterTitle={matter.title}
      clientName={clientOf(matter)}
      courtName={courtOf(matter)}
      {...data}
      initialLevel={(matter.taxaLevel ?? undefined) as 1 | 2 | 3 | 4 | undefined}
      initialHasFTax={matter.taxaHasFTax ?? undefined}
      initialHufStart={matter.taxaHufStart ?? undefined}
      initialIsTaxe={matter.isTaxeArende ?? undefined}
      radgivningPaid={!!matter.radgivningBetaldAt}
      onClose={onModalClose}
    />
  );
}

export function BillingPanel({ matterId, matter }: Props) {
  const runs = trpc.billingRun.list.useQuery({ matterId });
  const utils = trpc.useUtils();
  // Självupptäck inkonsistenser (t.ex. KR väntar på dom utan KR-dokument).
  useMatterInvariants({ matterId, matterNumber: matter.matterNumber });
  const [dialog, setDialog] = useState<DialogState>("NONE");
  const [showKr, setShowKr] = useState(false);
  const [showSettle, setShowSettle] = useState(false);
  const [verdictRunId, setVerdictRunId] = useState<BillingRunId | null>(null);
  const [beslutRunId, setBeslutRunId] = useState<BillingRunId | null>(null);
  const rows = (runs.data?.runs ?? []) as BillingRunRow[];
  // Fristående klientfakturor (#853) — t.ex. rådgivningstimmen (STANDARD, ingen
  // billing-run). Visas i faktura-listan utöver billing-runs.
  const standalone = standaloneInvoices(trpc.invoice.list.useQuery({ matterId }).data as StandaloneInvoiceRow[] | undefined, rows);
  // Aktiv kostnadsräkning (#828): KR vars livscykel inte är klar (≠ FAKTURERAD).
  const activeKr = rows.find((r) => r.type === "KOSTNADSRAKNING" && !!r.kostnadsrakningStatus && r.kostnadsrakningStatus !== "FAKTURERAD");
  // Flödesmodellen (#816) styr menyn + dom-bannern: fasen härleds ur runs+matter
  // och avgör vilka actions som erbjuds och vad domsknappen öppnar.
  const flowMatter: FlowMatter = { paymentMethod: matter.paymentMethod ?? "PENDING", rattsskyddNekadAt: matter.rattsskyddNekadAt };
  const actions = availableActions(flowMatter, rows);
  // Efter en fakturering ändras både körningarna OCH vad som är ofryst/ofakturerat
  // — invalidera "Upparbetat ofakturerat" (proposal) + fakturalistan, annars visar
  // panelen stale belopp tills sidan laddas om.
  const refetch = () => {
    void runs.refetch();
    void utils.billingRun.proposal.invalidate({ matterId });
    void utils.invoice.list.invalidate();
    void utils.timeEntry.list.invalidate({ matterId });
    void utils.expense.list.invalidate({ matterId });
  };
  const appeal = trpc.billingRun.appealKostnadsrakning.useMutation({ onSuccess: refetch });
  // Routa action → dialog via descriptorns `dialog`-fält (panelen är "dum").
  const onPick = (a: BillingAction) => {
    if (a.dialog === "kostnadsrakning") setShowKr(true);
    else if (a.dialog === "settlement") setShowSettle(true);
    else setDialog(a.type as DialogState);
  };
  return (
    <div className="bg-white rounded-lg border border-gray-200 lg:col-span-2">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">Fakturering</h2>
        <BillingHeaderActions actions={actions} onPick={onPick}
          hint={noActionsHint(currentPhase(flowMatter, rows), flowMatter.paymentMethod)} />
      </div>
      <BillingSummary matterId={matterId} />
      <RadgivningBanner matterId={matterId} matter={matter} onRecorded={refetch} />
      <SjalvriskAccontoHint matterId={matterId} matter={matter} rows={rows} />
      {activeKr && <KostnadsrakningCard matterId={matterId} run={activeKr}
        onRegistreraBeslut={() => setBeslutRunId(activeKr.id)}
        onOverklaga={() => appeal.mutate({ billingRunId: activeKr.id })}
        onSkapaFaktura={() => matter.paymentMethod === "RATTSHJALP" ? setShowSettle(true) : setVerdictRunId(activeKr.id)} />}
      {beslutRunId && <RecordBeslutDialog billingRunId={beslutRunId} onClose={() => setBeslutRunId(null)} onDone={refetch} />}
      <RunsList matterId={matterId} rows={rows} standalone={standalone} loading={runs.isLoading} />
      <BillingDialogs matterId={matterId} matter={matter} rows={rows}
        dialog={dialog} setDialog={setDialog}
        verdictRunId={verdictRunId} setVerdictRunId={setVerdictRunId}
        onRefetch={refetch} />
      <KostnadsrakningEntry
        matterId={matterId} matter={matter}
        open={showKr}
        onClose={() => setShowKr(false)}
        onRecorded={refetch}
      />
      {showSettle && matter.paymentMethod && (
        <SettlementDialog matterId={matterId} paymentMethod={matter.paymentMethod}
          onClose={() => { setShowSettle(false); refetch(); }} />
      )}
    </div>
  );
}

/** Rättshjälp (#383/#839): klientens rådgivningstimme (ärendets första timme)
 *  debiteras ALLTID klienten → skapas automatiskt som en separat klientfaktura
 *  när den saknas. Self-gating — null för icke-rättshjälpsärenden. */
function RadgivningBanner({ matterId, matter, onRecorded }: { matterId: MatterId; matter: MatterContext; onRecorded: () => void }) {
  const register = trpc.document.register.useMutation();
  const utils = trpc.useUtils();
  const meta = useBillingMeta(matter);
  const fired = useRef(false);
  const isRattshjalp = matter.paymentMethod === "RATTSHJALP";
  const registered = !!matter.radgivningBetaldAt;
  const create = trpc.invoice.createRadgivning.useMutation({
    onSuccess: async (res) => {
      // Stäng luckan (#845): ingen faktura utan dokument — generera faktura-PDF:en
      // direkt (samma väg som övriga klientfakturor) så den syns + går att öppna.
      try {
        await generateFakturaDoc({ invoice: (res as { invoice: Parameters<typeof generateFakturaDoc>[0]["invoice"] }).invoice, matterId, meta, register, utils });
      } catch (e) { console.warn("[rådgivning] fakturadokument misslyckades:", e); }
      onRecorded();
    },
  });
  useEffect(() => {
    // Auto-skapa en gång när den saknas (#839): rådgivningstimmen är obligatorisk
    // i rättshjälp, så användaren ska inte behöva trycka på en knapp. Alltid
    // F-skatt-normen (alla advokater har F-skatt) → ingen hasFTax skickas.
    if (!isRattshjalp || registered || fired.current || create.isPending) return;
    fired.current = true;
    create.mutate({ matterId });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRattshjalp, registered, matterId]);
  if (!isRattshjalp) return null;
  const avgift = computeRadgivningsavgift();
  return (
    <div className="mx-6 mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 flex items-center justify-between gap-3">
      <div className="text-xs text-blue-900">
        <strong>Rådgivningstimme (rättshjälp)</strong> — klientens 1 tim enligt rättshjälpstaxan,{" "}
        <span className="font-mono">{formatCurrency(avgift.beloppExclVatOre)}</span> exkl moms, faktureras separat till klienten.
      </div>
      {/* Rådgivningen är en riktig faktura som syns i faktura-listan nedan (#853). */}
      <span className="text-xs whitespace-nowrap text-blue-700">
        {registered ? "✓ Fakturerad (se faktura nedan)" : create.error ? "Kunde inte skapas" : "Skapas automatiskt…"}
      </span>
    </div>
  );
}

/**
 * Självrisk-aconto-hint (#854): när klientens ackumulerade självrisk (rättshjälp)
 * nått tröskeln flaggar vi att det är dags att skicka ett aconto. Acontot skapas
 * via "+ Skapa faktura → Aconto till klient" (finns redan). Self-gating.
 */
function SjalvriskAccontoHint({ matterId, matter, rows }: { matterId: MatterId; matter: MatterContext; rows: BillingRunRow[] }) {
  const isRattshjalp = matter.paymentMethod === "RATTSHJALP";
  const split = trpc.billingRun.coverageSplit.useQuery({ matterId }, { enabled: isRattshjalp }).data;
  if (!isRattshjalp || !split) return null;
  const hasSjalvriskAconto = rows.some((r) => r.type === "ACCONTO" && r.recipient === "KLIENT");
  if (hasSjalvriskAconto || split.clientOre < SJALVRISK_ACCONTO_THRESHOLD_ORE) return null;
  return (
    <div className="mx-6 mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      Klientens självrisk har nått{" "}
      <span className="font-mono font-semibold">{formatCurrency(split.clientOre)}</span>{" "}
      (tröskel {formatCurrency(SJALVRISK_ACCONTO_THRESHOLD_ORE)}) — dags att skicka ett självrisk-aconto via
      {" "}<strong>+ Skapa faktura → Aconto till klient</strong>.
    </div>
  );
}

/**
 * Fakturapanelens summa-vy (#819) — exakt tre tal användaren bryr sig om:
 *   - Upparbetat ofakturerat: debiterbart arbete (arvode netto + utlägg netto)
 *     som ännu inte frysts/fakturerats (billingRun.proposal, PRUTNING exkl).
 *   - Fakturerat: Σ utställda fakturors belopp (status ≠ DRAFT/CANCELLED).
 *   - Betalt: Σ registrerade betalningar på ärendets fakturor.
 */
function BillingSummary({ matterId }: { matterId: MatterId }) {
  const proposal = trpc.billingRun.proposal.useQuery({ matterId });
  const invoices = trpc.invoice.list.useQuery({ matterId });
  const d = proposal.data;
  const unbilledOre = d
    ? d.timeEntries.filter((t) => t.billable).reduce((s, t) => s + t.valueOre, 0)
      + d.expenses.filter((e) => e.billable).reduce((s, e) => s + e.amount, 0)
    : 0;
  const list = invoices.data ?? [];
  const fakturerat = list.filter((i) => i.status !== "DRAFT" && i.status !== "CANCELLED").reduce((s, i) => s + i.amount, 0);
  const betalt = list.reduce((s, i) => s + (i.payments ?? []).reduce((p, pm) => p + pm.amount, 0), 0);
  return (
    <div className="grid grid-cols-3 gap-3 px-6 py-4">
      <Card label="Upparbetat ofakturerat" value={unbilledOre} basis="net" />
      <Card label="Fakturerat" value={fakturerat} />
      <Card label="Betalt" value={betalt} />
    </div>
  );
}

/**
 * Rättshjälpens kostnadsräkning till domstol (#806) — enkel bekräftelse (arbetet
 * värderas på timkostnadsnormen vid domen, inte brottmålstaxan). Skickar in
 * kostnadsräkningen, vilket fryser det upparbetade direkt; domen slutregleras
 * separat (klientens självrisk, statens del, ev. byrå-förlust).
 */
/** Samlar rättshjälps-KR:ns data + skapar billing-run:en OCH ett KR-dokument
 *  (#828 steg 4). Utbrutet ur dialogen så den håller sig under complexity 8. */
function useRattshjalpKr(matterId: MatterId, matter: MatterContext, onClose: () => void, onRecorded: () => void) {
  const proposal = trpc.billingRun.proposal.useQuery({ matterId });
  const krData = useKrModalData(matterId);
  const timeEntries = trpc.timeEntry.list.useQuery({ matterId, pageSize: 100 });
  const register = trpc.document.register.useMutation();
  const utils = trpc.useUtils();
  const create = trpc.billingRun.createKostnadsrakning.useMutation({
    onSuccess: async () => {
      // KR-dokumentet är en presentation av det inskickade — misslyckas det
      // ska billing-run:en ändå stå kvar (best-effort), så fånga felet.
      try {
        await generateKrDoc({
          matterId, register, utils,
          meta: {
            matterNumber: matter.matterNumber, matterTitle: matter.title, defenderName: krData.defenderName,
            ...omitUndefined({
              clientName: clientOf(matter) || undefined, courtName: courtOf(matter),
              defenderEmail: krData.defenderEmail, organizationName: krData.organizationName,
              organizationOrgNumber: krData.organizationOrgNumber, organizationAddress: krData.organizationAddress,
              radgivningPaid: matter.radgivningBetaldAt ? true : undefined,
            }),
          },
          expenses: krData.expenses,
          timeEntries: (timeEntries.data?.entries ?? []) as ReadonlyArray<{ id: string; date: string | Date; description: string; minutes: number; billable?: boolean }>,
        });
      } catch (e) { console.warn("[rättshjälp-kr] dokument misslyckades:", e); }
      onRecorded(); onClose();
    },
  });
  return { proposal, create };
}

function RattshjalpKrDialog({ matterId, matter, onClose, onRecorded }: { matterId: MatterId; matter: MatterContext; onClose: () => void; onRecorded: () => void }) {
  const { proposal, create } = useRattshjalpKr(matterId, matter, onClose, onRecorded);
  const d = proposal.data;
  const arvodeOre = d ? d.timeEntries.filter((t) => t.billable).reduce((s, t) => s + t.valueOre, 0) : 0;
  const utlaggOre = d ? d.expenses.filter((e) => e.billable).reduce((s, e) => s + e.amount, 0) : 0;
  return (
    <Modal open title="Kostnadsräkning till domstol" onClose={onClose} widthClass="max-w-md">
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          Kostnadsräkningen skickas till domstolen för bedömning — den är ingen faktura
          ännu och kan prutas. Det upparbetade fryses nu; vid domen slutreglerar du
          (klientens självrisk, statens del och ev. byrå-förlust).
        </p>
        <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 space-y-1 text-sm">
          <div className="flex justify-between text-gray-700"><span>Arvode (exkl moms)</span><span className="font-mono">{formatCurrency(arvodeOre)}</span></div>
          <div className="flex justify-between text-gray-700"><span>Utlägg</span><span className="font-mono">{formatCurrency(utlaggOre)}</span></div>
        </div>
        {create.error && <p className="text-sm text-red-700">{create.error.message}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">Avbryt</button>
          <button type="button" disabled={create.isPending} onClick={() => create.mutate({ matterId })}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            {create.isPending ? "Skickar…" : "Skicka kostnadsräkning"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Card({ label, value, dim, basis = "gross" }: { label: string; value: number; dim?: boolean; basis?: "net" | "gross" }) {
  return (
    <div className={`rounded-lg border ${dim ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-gray-50"} px-3 py-2`}>
      <div className="text-[10px] uppercase text-gray-500">{label}</div>
      <Money ore={value} basis={basis} className="font-mono font-semibold text-sm" />
    </div>
  );
}

/** Header-zonen: skapa-faktura-menyn när det finns åtgärder, annars en förklaring. */
function BillingHeaderActions({ actions, onPick, hint }: { actions: readonly BillingAction[]; onPick: (a: BillingAction) => void; hint: string }) {
  if (actions.length > 0) return <BillingActions actions={actions} onPick={onPick} />;
  return <span className="text-xs text-gray-500">{hint}</span>;
}

/** Förklarar varför inga faktureringsåtgärder erbjuds i nuvarande fas (#824) —
 *  annars försvinner knappen tyst och användaren tror fakturering saknas. */
function noActionsHint(phase: BillingPhase, pm: PaymentMethod): string {
  if (pm === "PENDING") return "Välj betalningssätt för att fakturera";
  if (phase === "SLUTREGLERAD") return "Ärendet är slutreglerat";
  if (phase === "NEKAD") return "Rättsskydd nekat — se förslag nedan";
  return "Inga faktureringsåtgärder i nuvarande läge";
}

/** Skapa-faktura-menyn — alternativen kommer från flödesmodellen (#816); panelen
 *  väljer inte längre per betalningssätt själv. Inga actions i fasen → ingen knapp. */
function BillingActions({ actions, onPick }: { actions: readonly BillingAction[]; onPick: (a: BillingAction) => void }) {
  const [open, setOpen] = useState(false);
  if (actions.length === 0) return null;
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700">
        + Skapa faktura
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-40 bg-white border border-gray-200 rounded shadow-lg p-1 min-w-[14rem]">
            {actions.map((a) => (
              <button key={a.type}
                onClick={() => { onPick(a); setOpen(false); }}
                className="block w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 rounded">
                {a.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RunsList({ matterId, rows, standalone, loading }: { matterId: MatterId; rows: BillingRunRow[]; standalone: StandaloneInvoiceRow[]; loading: boolean }) {
  // Dokumentlistan hämtas en gång → KOSTNADSRAKNING-raden kan länka till sitt
  // KR-dokument (#843). utils.client krävs för openKrDoc:s server-hämtning.
  const docs = trpc.document.list.useQuery({ matterId, folderId: null, pageSize: 100 }).data?.documents ?? [];
  const utils = trpc.useUtils();
  if (loading) return <p className="px-6 py-3 text-sm text-gray-500">Laddar…</p>;
  if (rows.length === 0 && standalone.length === 0) return <p className="px-6 py-3 text-sm text-gray-500">Inga fakturor ännu.</p>;
  return (
    <div className="px-6 py-2">
      <table className="min-w-full text-sm">
        <thead className="text-xs text-gray-500">
          <tr><th className="text-left py-1">Typ</th><th className="text-left">Mottagare</th><th className="text-left">Status</th><th className="text-right">Belopp</th><th></th></tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => {
            const krDoc = r.type === "KOSTNADSRAKNING" ? pickKrDoc(docs, r) : null;
            return (
            <tr key={r.id}>
              <td className="py-2 text-sm">{BILLING_RUN_TYPE_LABELS[r.type as keyof typeof BILLING_RUN_TYPE_LABELS] ?? r.type}</td>
              <td className="text-sm text-gray-600">{r.recipient}</td>
              <td className="text-sm">{BILLING_RUN_STATUS_LABELS[r.status as keyof typeof BILLING_RUN_STATUS_LABELS] ?? r.status}</td>
              <td className="text-right text-sm font-mono"><Money ore={r.amountOre} basis="gross" /></td>
              <td className="text-right space-x-2 whitespace-nowrap">
                {krDoc && (
                  <button type="button" onClick={() => void openKrDoc(krDoc, utils.client)}
                    className="text-xs text-blue-600 hover:underline">Kostnadsräkning</button>
                )}
                {r.invoiceId && (
                  // EntityLink (inte Next-Link) — runtime-skapade UUIDs finns
                  // inte i generateStaticParams. Nuvarande 404.html är en
                  // __shell__ routing-shim (se [[entity-link]]); EntityLink gör
                  // en hård navigering så shim/nginx try_files kan resolva
                  // runtime-skapade faktura-id:n.
                  <EntityLink route="invoices" id={r.invoiceId}
                    className="text-xs text-blue-600 hover:underline">
                    {r.invoice?.invoiceNumber ?? "Faktura"}
                  </EntityLink>
                )}
              </td>
            </tr>
            );
          })}
          {/* Fristående klientfakturor utan billing-run (#853), t.ex. rådgivningstimmen. */}
          {standalone.map((inv) => (
            <tr key={inv.id}>
              <td className="py-2 text-sm">Faktura</td>
              <td className="text-sm text-gray-600">KLIENT</td>
              <td className="text-sm">{INVOICE_STATUS_LABELS[inv.status as keyof typeof INVOICE_STATUS_LABELS] ?? inv.status}</td>
              <td className="text-right text-sm font-mono"><Money ore={inv.amount} basis="gross" /></td>
              <td className="text-right whitespace-nowrap">
                <EntityLink route="invoices" id={inv.id} className="text-xs text-blue-600 hover:underline">
                  {inv.invoiceNumber ?? "Faktura"}
                </EntityLink>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
