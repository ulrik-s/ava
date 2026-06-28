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
import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Money } from "@/components/ui/money";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { hasGeneratedDoc, openGeneratedDoc } from "@/lib/client/demo/generated-doc-cache";
import { useMatterInvariants } from "@/lib/client/diagnostics/use-matter-invariants";
import { trpc } from "@/lib/client/trpc";
import { formatCurrency } from "@/lib/client/utils";
import type { AppRouter } from "@/lib/server/routers/_app";
import { availableActions, pendingBannerFor, type BillingAction, type FlowMatter } from "@/lib/shared/billing-flow";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import { computeRadgivningsavgift } from "@/lib/shared/rattshjalp";
import { BILLING_RUN_TYPE_LABELS, BILLING_RUN_STATUS_LABELS, type BillingRunRecipient, type BillingRunStatus, type BillingRunType, type PaymentMethod } from "@/lib/shared/schemas/enums";
import type { BillingRunId, InvoiceId, MatterId } from "@/lib/shared/schemas/ids";
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
}

interface KrDocInfo { id: string; fileName: string }

type DocumentListOutput = inferRouterOutputs<AppRouter>["document"]["list"];

function findKrDocument(matterId: MatterId, run: BillingRunRow): KrDocInfo | null {
  const docs: DocumentListOutput | undefined = trpc.document.list.useQuery({ matterId, folderId: null, pageSize: 100 }).data;
  const list = docs?.documents ?? [];
  const kostn = list.filter((d) => d.documentType === "Kostnadsräkning");
  if (kostn.length === 0) return null;
  // Senaste KR-dokumentet skapat innan/samtidigt med billing-run:n —
  // räcker för MVP (vanligtvis 1 pending KR per matter). Vid framtida
  // refactor: lagra documentId direkt på BillingRun-row.
  const runTs = new Date(run.createdAt).getTime();
  const sorted = [...kostn].sort((a, b) => {
    const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return Math.abs(at - runTs) - Math.abs(bt - runTs);
  });
  return sorted[0] ? { id: sorted[0].id, fileName: sorted[0].fileName } : null;
}

function openKrDocument(doc: KrDocInfo): void {
  // I demo-mode (GH Pages) finns ingen statisk fil för dokument som
  // genererats client-side — blob-cachen håller bytes:erna i minnet.
  // Self-hosted/server-mode skulle istället peka mot /api/documents/:id.
  if (hasGeneratedDoc(doc.id)) {
    openGeneratedDoc(doc.id);
    return;
  }
  // Fallback: ingen blob (page reload sedan generering) — visa hint.
  alert(
    `Dokumentet "${doc.fileName}" är inte längre i minnet (efter sid-reload).\n` +
    `Skapa en ny kostnadsräkning eller använd helper-app:n för att spara filen.`,
  );
}

function PendingVerdictBanner({ matterId, run, onClick }: { matterId: MatterId; run: BillingRunRow; onClick: () => void }) {
  const doc = findKrDocument(matterId, run);
  return (
    <div className="mx-6 my-3 rounded border border-amber-300 bg-amber-50 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
      <div className="text-sm text-amber-900 space-y-1">
        <div>
          <strong>Kostnadsräkning väntar på dom</strong> — <Money ore={run.amountOre} basis="gross" className="font-mono font-semibold" /> föreslaget belopp
        </div>
        {doc && (
          <div className="text-xs text-amber-800">
            Dokument:{" "}
            <button
              type="button"
              onClick={() => openKrDocument(doc)}
              className="underline hover:text-amber-900 text-amber-900 cursor-pointer"
            >
              {doc.fileName}
            </button>
          </div>
        )}
      </div>
      <button onClick={onClick}
        className="text-xs px-3 py-1 bg-amber-600 text-white rounded hover:bg-amber-700 whitespace-nowrap">
        Ange dom + prutning
      </button>
    </div>
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

function BillingDialogs({ matterId, matter, rows, dialog, setDialog, verdictRunId, setVerdictRunId, onRefetch }: DialogsProps) {
  const pending = findPendingVerdict(rows);
  const meta = useBillingMeta(matter);
  return (
    <>
      {dialog !== "NONE" && (
        <BillingDialog matterId={matterId} type={dialog} meta={meta}
          existingAccontos={rows.filter((r) => r.type === "ACCONTO" && r.status === "SENT")}
          onClose={() => { setDialog("NONE"); onRefetch(); }} />
      )}
      {verdictRunId && (
        <VerdictDialog billingRunId={verdictRunId} workValueOre={pending?.amountOre ?? 0}
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
    return open ? <RattshjalpKrDialog matterId={matterId} onClose={onClose} onRecorded={onRecorded} /> : null;
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
  const rows = (runs.data?.runs ?? []) as BillingRunRow[];
  const pending = findPendingVerdict(rows);
  // Flödesmodellen (#816) styr menyn + dom-bannern: fasen härleds ur runs+matter
  // och avgör vilka actions som erbjuds och vad domsknappen öppnar.
  const flowMatter: FlowMatter = { paymentMethod: matter.paymentMethod ?? "PENDING", rattsskyddNekadAt: matter.rattsskyddNekadAt };
  const actions = availableActions(flowMatter, rows);
  const banner = pendingBannerFor(flowMatter, rows);
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
        <BillingActions actions={actions} onPick={onPick} />
      </div>
      <BillingSummary matterId={matterId} />
      <RadgivningBanner matterId={matterId} matter={matter} onRecorded={refetch} />
      {pending && banner && <PendingVerdictBanner matterId={matterId} run={pending}
        onClick={() => banner.dialog === "settlement" ? setShowSettle(true) : setVerdictRunId(pending.id)} />}
      <RunsList rows={rows} loading={runs.isLoading} />
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

/** Rättshjälp (#383): registrera klientens betalda rådgivningstimme som en
 *  separat klientfaktura. Self-gating — null för icke-rättshjälpsärenden. */
function RadgivningBanner({ matterId, matter, onRecorded }: { matterId: MatterId; matter: MatterContext; onRecorded: () => void }) {
  const create = trpc.invoice.createRadgivning.useMutation({ onSuccess: onRecorded });
  if (matter.paymentMethod !== "RATTSHJALP") return null;
  const hasFTaxArg = omitUndefined({ hasFTax: matter.taxaHasFTax ?? undefined });
  const avgift = computeRadgivningsavgift(hasFTaxArg);
  return (
    <div className="mx-6 mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 flex items-center justify-between gap-3">
      <div className="text-xs text-blue-900">
        <strong>Rådgivningstimme (rättshjälp)</strong> — klientens 1 tim enligt rättshjälpstaxan,{" "}
        <span className="font-mono">{formatCurrency(avgift.beloppExclVatOre)}</span> exkl moms, faktureras separat till klienten.
      </div>
      {matter.radgivningBetaldAt ? (
        <span className="text-xs text-green-700 whitespace-nowrap">✓ Registrerad</span>
      ) : (
        <button type="button" onClick={() => create.mutate({ matterId, ...hasFTaxArg })} disabled={create.isPending}
          className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap">
          {create.isPending ? "Registrerar…" : "Registrera betald"}
        </button>
      )}
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
function RattshjalpKrDialog({ matterId, onClose, onRecorded }: { matterId: MatterId; onClose: () => void; onRecorded: () => void }) {
  const proposal = trpc.billingRun.proposal.useQuery({ matterId });
  const create = trpc.billingRun.createKostnadsrakning.useMutation({
    onSuccess: () => { onRecorded(); onClose(); },
  });
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

function RunsList({ rows, loading }: { rows: BillingRunRow[]; loading: boolean }) {
  if (loading) return <p className="px-6 py-3 text-sm text-gray-500">Laddar…</p>;
  if (rows.length === 0) return <p className="px-6 py-3 text-sm text-gray-500">Inga billing-runs ännu.</p>;
  return (
    <div className="px-6 py-2">
      <table className="min-w-full text-sm">
        <thead className="text-xs text-gray-500">
          <tr><th className="text-left py-1">Typ</th><th className="text-left">Mottagare</th><th className="text-left">Status</th><th className="text-right">Belopp</th><th></th></tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="py-2 text-sm">{BILLING_RUN_TYPE_LABELS[r.type as keyof typeof BILLING_RUN_TYPE_LABELS] ?? r.type}</td>
              <td className="text-sm text-gray-600">{r.recipient}</td>
              <td className="text-sm">{BILLING_RUN_STATUS_LABELS[r.status as keyof typeof BILLING_RUN_STATUS_LABELS] ?? r.status}</td>
              <td className="text-right text-sm font-mono"><Money ore={r.amountOre} basis="gross" /></td>
              <td className="text-right">
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
