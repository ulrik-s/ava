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
import { Money } from "@/components/ui/money";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { hasGeneratedDoc, openGeneratedDoc } from "@/lib/client/demo/generated-doc-cache";
import { useMatterInvariants } from "@/lib/client/diagnostics/use-matter-invariants";
import { trpc } from "@/lib/client/trpc";
import { formatCurrency } from "@/lib/client/utils";
import type { AppRouter } from "@/lib/server/routers/_app";
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
type ActionPick = "ACCONTO" | "FINAL" | "KOSTNADSRAKNING" | "SETTLE";

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
  // Självupptäck inkonsistenser (t.ex. KR väntar på dom utan KR-dokument).
  useMatterInvariants({ matterId, matterNumber: matter.matterNumber });
  const [dialog, setDialog] = useState<DialogState>("NONE");
  const [showKr, setShowKr] = useState(false);
  const [showSettle, setShowSettle] = useState(false);
  const [verdictRunId, setVerdictRunId] = useState<BillingRunId | null>(null);
  const rows = (runs.data?.runs ?? []) as BillingRunRow[];
  const pending = findPendingVerdict(rows);
  const refetch = () => { void runs.refetch(); };
  const onPick = (t: ActionPick) => {
    if (t === "KOSTNADSRAKNING") setShowKr(true);
    else if (t === "SETTLE") setShowSettle(true);
    else setDialog(t);
  };
  return (
    <div className="bg-white rounded-lg border border-gray-200 lg:col-span-2">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">Fakturering</h2>
        <BillingActions paymentMethod={matter.paymentMethod ?? undefined} onPick={onPick} />
      </div>
      <SummaryCards totals={computeTotals(rows)} />
      <UnbilledSummary matterId={matterId} />
      <RadgivningBanner matterId={matterId} matter={matter} onRecorded={refetch} />
      {pending && <PendingVerdictBanner matterId={matterId} run={pending} onClick={() => setVerdictRunId(pending.id)} />}
      <RunsList rows={rows} loading={runs.isLoading} />
      <BillingDialogs matterId={matterId} matter={matter} rows={rows}
        dialog={dialog} setDialog={setDialog}
        verdictRunId={verdictRunId} setVerdictRunId={setVerdictRunId}
        onRefetch={refetch} />
      <KostnadsrakningTrigger
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
 * "Upparbetat ofakturerat" (#740) — debiterbart arbete som ännu inte frysts/
 * fakturerats, så juristen lätt ser om något behöver faktureras. Visar arvode
 * (exkl utlägg) + utlägg separat + totalt (inkl utlägg). Datan = billingRun.proposal
 * (ofrysta debiterbara poster). PRUTNING är redan exkluderad i proposal.
 */
function UnbilledSummary({ matterId }: { matterId: MatterId }) {
  const proposal = trpc.billingRun.proposal.useQuery({ matterId });
  const d = proposal.data;
  if (proposal.isLoading || !d) return null;
  const arvodeOre = d.timeEntries.filter((t) => t.billable).reduce((s, t) => s + t.valueOre, 0);
  const utlaggOre = d.expenses.filter((e) => e.billable).reduce((s, e) => s + e.amount, 0);
  const totalOre = arvodeOre + utlaggOre;
  const has = totalOre > 0;
  return (
    <div className={`mx-6 mb-4 rounded-lg border px-4 py-3 ${has ? "border-blue-200 bg-blue-50" : "border-gray-200 bg-gray-50"}`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-gray-500">Upparbetat ofakturerat</span>
        <span className="font-mono font-semibold text-sm text-gray-900">{formatCurrency(totalOre)}</span>
      </div>
      {has ? (
        <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-600">
          <span>Arvode (exkl utlägg): <span className="font-mono text-gray-800">{formatCurrency(arvodeOre)}</span></span>
          <span>Utlägg: <span className="font-mono text-gray-800">{formatCurrency(utlaggOre)}</span></span>
        </div>
      ) : (
        <div className="mt-1 text-xs text-gray-500">Inget ofakturerat — allt debiterbart arbete är fakturerat.</div>
      )}
    </div>
  );
}

function computeTotals(rows: BillingRunRow[]) {
  let acconto = 0, finalSent = 0, pending = 0;
  for (const r of rows) {
    if (r.type === "ACCONTO" && r.status === "SENT") acconto += r.amountOre;
    if ((r.type === "FINAL" || r.type === "KOSTNADSRAKNING") && r.status === "SENT") finalSent += r.amountOre;
    if (r.status === "PENDING_VERDICT") pending += r.amountOre;
  }
  return { acconto, finalSent, pending };
}

function SummaryCards({ totals }: { totals: { acconto: number; finalSent: number; pending: number } }) {
  return (
    <div className="grid grid-cols-3 gap-3 px-6 py-4">
      <Card label="Aconto fakturerat" value={totals.acconto} />
      <Card label="Fakturerat" value={totals.finalSent} />
      <Card label="Väntar på dom" value={totals.pending} dim />
    </div>
  );
}

function Card({ label, value, dim }: { label: string; value: number; dim?: boolean }) {
  return (
    <div className={`rounded-lg border ${dim ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-gray-50"} px-3 py-2`}>
      <div className="text-[10px] uppercase text-gray-500">{label}</div>
      <Money ore={value} basis="gross" className="font-mono font-semibold text-sm" />
    </div>
  );
}

function BillingActions({ paymentMethod, onPick }: { paymentMethod: PaymentMethod | undefined; onPick: (t: ActionPick) => void }) {
  const [open, setOpen] = useState(false);
  const options = optionsFor(paymentMethod);
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700">
        + Skapa faktura
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-40 bg-white border border-gray-200 rounded shadow-lg p-1 min-w-[14rem]">
            {options.map((o) => (
              <button key={o.type}
                onClick={() => { onPick(o.type); setOpen(false); }}
                className="block w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 rounded">
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function optionsFor(pm: PaymentMethod | undefined): Array<{ type: ActionPick; label: string }> {
  if (pm === "RATTSSKYDD" || pm === "RATTSHJALP") {
    return [
      { type: "ACCONTO", label: "Aconto till klient" },
      { type: "FINAL", label: pm === "RATTSSKYDD" ? "Faktura till försäkring" : "Faktura till myndighet" },
      { type: "SETTLE", label: pm === "RATTSSKYDD" ? "Slutreglera (försäkringsbesked)" : "Slutreglera (dom)" },
    ];
  }
  if (pm === "OFFENTLIGT_UPPDRAG") {
    return [{ type: "KOSTNADSRAKNING", label: "Kostnadsräkning till domstol" }];
  }
  return [{ type: "FINAL", label: "Faktura till klient" }];
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
