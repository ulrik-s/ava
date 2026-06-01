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
import { useState } from "react";
import { trpc } from "@/lib/client/trpc";
import { formatCurrency } from "@/lib/client/utils";
import { BILLING_RUN_TYPE_LABELS, BILLING_RUN_STATUS_LABELS } from "@/lib/shared/schemas/enums";
import { BillingDialog } from "./_billing-dialog";
import { VerdictDialog } from "./_verdict-dialog";
import { KostnadsrakningModal } from "./_kostnadsrakning-modal";

interface MatterContext {
  matterNumber: string;
  title: string;
  taxaLevel?: 1 | 2 | 3 | 4 | null;
  taxaHasFTax?: boolean | null;
  taxaHufStart?: string | Date | null;
  isTaxeArende?: boolean | null;
  paymentMethod?: string | null;
  contacts?: ReadonlyArray<{ role: string; contact?: { name?: string | null; email?: string | null } | null }>;
}

interface Props {
  matterId: string;
  matter: MatterContext;
}

interface BillingRunRow {
  id: string;
  type: string;
  status: string;
  recipient: string;
  amountOre: number;
  createdAt: string | Date;
  invoiceId?: string | null;
  invoice?: { id: string; invoiceNumber?: string | null } | null;
}

interface KrDocInfo { id: string; fileName: string }

function findKrDocument(matterId: string, run: BillingRunRow): KrDocInfo | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docs = trpc.document.list.useQuery({ matterId, folderId: null, pageSize: 100 }).data as any;
  const list = (docs?.documents ?? []) as Array<{ id: string; fileName: string; documentType?: string | null; createdAt?: string | Date }>;
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

function PendingVerdictBanner({ matterId, run, onClick }: { matterId: string; run: BillingRunRow; onClick: () => void }) {
  const doc = findKrDocument(matterId, run);
  const basePath = process.env.NEXT_PUBLIC_DEMO_BASE_PATH ?? "";
  return (
    <div className="mx-6 my-3 rounded border border-amber-300 bg-amber-50 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
      <div className="text-sm text-amber-900 space-y-1">
        <div>
          <strong>Kostnadsräkning väntar på dom</strong> — <span className="font-mono font-semibold">{formatCurrency(run.amountOre)}</span> föreslaget belopp
        </div>
        {doc && (
          <div className="text-xs text-amber-800">
            Dokument: <a href={`${basePath}/documents/${doc.id}/`} className="underline hover:text-amber-900">{doc.fileName}</a>
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
type ActionPick = "ACCONTO" | "FINAL" | "KOSTNADSRAKNING";

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
  matterId: string; rows: BillingRunRow[];
  dialog: DialogState; setDialog: (s: DialogState) => void;
  verdictRunId: string | null; setVerdictRunId: (id: string | null) => void;
  onRefetch: () => void;
}

function BillingDialogs({ matterId, rows, dialog, setDialog, verdictRunId, setVerdictRunId, onRefetch }: DialogsProps) {
  const pending = findPendingVerdict(rows);
  return (
    <>
      {dialog !== "NONE" && (
        <BillingDialog matterId={matterId} type={dialog}
          existingAccontos={rows.filter((r) => r.type === "ACCONTO" && r.status === "SENT")}
          onClose={() => { setDialog("NONE"); onRefetch(); }} />
      )}
      {verdictRunId && (
        <VerdictDialog billingRunId={verdictRunId} workValueOre={pending?.amountOre ?? 0}
          onClose={() => { setVerdictRunId(null); onRefetch(); }} />
      )}
    </>
  );
}

interface KrTriggerProps {
  matterId: string;
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
function orgProps(org: { name?: string | null; orgNumber?: string | null; address?: string | null } | undefined): OrgData {
  return {
    name: strOrUndef(org?.name),
    orgNumber: strOrUndef(org?.orgNumber),
    address: strOrUndef(org?.address),
  };
}

function useKrModalData(matterId: string): KrModalData {
  const me = trpc.user.current.useQuery().data;
  const org = orgProps(trpc.organization.getSettings.useQuery().data ?? undefined);
  const expenses = trpc.expense.list.useQuery({ matterId }).data?.expenses ?? [];
  return {
    defenderName: me?.name ?? "",
    defenderEmail: strOrUndef(me?.email),
    organizationName: org.name,
    organizationOrgNumber: org.orgNumber,
    organizationAddress: org.address,
    expenses: expenses as KrModalData["expenses"],
  };
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
      initialLevel={matter.taxaLevel ?? undefined}
      initialHasFTax={matter.taxaHasFTax ?? undefined}
      initialHufStart={matter.taxaHufStart ?? undefined}
      initialIsTaxe={matter.isTaxeArende ?? undefined}
      onClose={onModalClose}
    />
  );
}

export function BillingPanel({ matterId, matter }: Props) {
  const runs = trpc.billingRun.list.useQuery({ matterId });
  const [dialog, setDialog] = useState<DialogState>("NONE");
  const [showKr, setShowKr] = useState(false);
  const [verdictRunId, setVerdictRunId] = useState<string | null>(null);
  const rows = (runs.data?.runs ?? []) as BillingRunRow[];
  const pending = findPendingVerdict(rows);
  const refetch = () => { void runs.refetch(); };
  const onPick = (t: ActionPick) => {
    if (t === "KOSTNADSRAKNING") setShowKr(true);
    else setDialog(t);
  };
  return (
    <div className="bg-white rounded-lg border border-gray-200 lg:col-span-2">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">Fakturering</h2>
        <BillingActions paymentMethod={matter.paymentMethod ?? ""} onPick={onPick} />
      </div>
      <SummaryCards totals={computeTotals(rows)} />
      {pending && <PendingVerdictBanner matterId={matterId} run={pending} onClick={() => setVerdictRunId(pending.id)} />}
      <RunsList rows={rows} loading={runs.isLoading} />
      <BillingDialogs matterId={matterId} rows={rows}
        dialog={dialog} setDialog={setDialog}
        verdictRunId={verdictRunId} setVerdictRunId={setVerdictRunId}
        onRefetch={refetch} />
      <KostnadsrakningTrigger
        matterId={matterId} matter={matter}
        open={showKr}
        onClose={() => setShowKr(false)}
        onRecorded={refetch}
      />
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
      <div className="font-mono font-semibold text-sm">{formatCurrency(value)}</div>
    </div>
  );
}

function BillingActions({ paymentMethod, onPick }: { paymentMethod: string; onPick: (t: ActionPick) => void }) {
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

function optionsFor(pm: string): Array<{ type: ActionPick; label: string }> {
  if (pm === "RATTSSKYDD" || pm === "RATTSHJALP") {
    return [
      { type: "ACCONTO", label: "Aconto till klient" },
      { type: "FINAL", label: pm === "RATTSSKYDD" ? "Faktura till försäkring" : "Faktura till myndighet" },
    ];
  }
  if (pm === "OFFENTLIG_FORSVARARE") {
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
              <td className="text-right text-sm font-mono">{formatCurrency(r.amountOre)}</td>
              <td className="text-right">
                {r.invoiceId && (
                  // <a>-tag (inte Next-Link) — runtime-skapade UUIDs finns inte
                  // i generateStaticParams. Hård navigering → 404.html (=
                  // index.html) → app:en bootar med rätt URL, useRouteId
                  // läser id:t. Next-Link skulle inte hitta routen och falla
                  // tillbaka till dashboard.
                  <a href={`${process.env.NEXT_PUBLIC_DEMO_BASE_PATH ?? ""}/invoices/${r.invoiceId}/`}
                    className="text-xs text-blue-600 hover:underline">
                    {r.invoice?.invoiceNumber ?? "Faktura"}
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
