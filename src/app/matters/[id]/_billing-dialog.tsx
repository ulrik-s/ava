"use client";

/**
 * `BillingDialog` — skapa en BillingRun. Två kombinerade flöden:
 *   ACCONTO — avdragsmedvetet förslag (#397): belopp = klientens %-sats ×
 *             upparbetat värde − tidigare aconton. Advokat kan justera.
 *   FINAL   — recipient-val + lista av aconton att dra av, och en förhands-
 *             lista över de ofakturerade poster som kommer med i fakturan.
 *
 * Båda flödena skapar ett DRAFT-utkast OCH ett faktura-PDF-dokument i ärendets
 * dokumentlista (via `generateFakturaDoc`), redo för utskick.
 */
import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import {
  generateFakturaDoc,
  type DocUtils,
  type FakturaDocInvoice,
  type FakturaDocMeta,
} from "@/lib/client/kostnadsrakning/generate-faktura-doc";
import { trpc } from "@/lib/client/trpc";
import { formatCurrency } from "@/lib/client/utils";
import { proposedAccontoOre } from "@/lib/shared/billing-proposal";

interface AccontoRow { id: string; amountOre: number; recipient: string }

export interface BillingMeta {
  matterNumber: string;
  matterTitle: string;
  clientName?: string;
  organizationName?: string;
  organizationOrgNumber?: string;
}

interface Props {
  matterId: string;
  type: "ACCONTO" | "FINAL";
  existingAccontos: AccontoRow[];
  meta: BillingMeta;
  onClose: () => void;
}

export function BillingDialog({ matterId, type, existingAccontos, meta, onClose }: Props) {
  return (
    <Modal open title={titleFor(type)} onClose={onClose} widthClass="max-w-xl">
      {type === "ACCONTO" && <AccontoForm matterId={matterId} meta={meta} onDone={onClose} />}
      {type === "FINAL" && <FinalForm matterId={matterId} meta={meta} accontos={existingAccontos} onDone={onClose} />}
    </Modal>
  );
}

function titleFor(type: string): string {
  if (type === "ACCONTO") return "Aconto till klient";
  return "Faktura";
}

/** Återanvändbar doc-generator: lägg ett faktura-PDF-dokument i fil-listan. */
function useFakturaDoc(matterId: string, meta: BillingMeta): (invoice: FakturaDocInvoice) => Promise<void> {
  const register = trpc.document.register.useMutation();
  const utils = trpc.useUtils();
  const docMeta: FakturaDocMeta = {
    matterNumber: meta.matterNumber, matterTitle: meta.matterTitle,
    ...(meta.clientName ? { clientName: meta.clientName } : {}),
    ...(meta.organizationName ? { organizationName: meta.organizationName } : {}),
    ...(meta.organizationOrgNumber ? { organizationOrgNumber: meta.organizationOrgNumber } : {}),
  };
  return async (invoice: FakturaDocInvoice) => {
    try {
      await generateFakturaDoc({ invoice, matterId, meta: docMeta, register, utils: utils as unknown as DocUtils });
    } catch (e) { console.warn("[billing] faktura-dokument misslyckades:", e); }
  };
}

function AccontoForm({ matterId, meta, onDone }: { matterId: string; meta: BillingMeta; onDone: () => void }) {
  const proposal = trpc.billingRun.proposal.useQuery({ matterId });
  const workValueOre = proposal.data?.workValueOre ?? 0;
  const priorOre = proposal.data?.priorAccontoSumOre ?? 0;
  const [clientShareBips, setBips] = useState(2000); // 20% default
  const [amountKr, setAmountKr] = useState<number | null>(null); // null → följ förslaget
  const makeDoc = useFakturaDoc(matterId, meta);
  const suggestedOre = proposedAccontoOre(workValueOre, clientShareBips, priorOre);
  const effectiveKr = amountKr ?? suggestedOre / 100;
  const mut = trpc.billingRun.createAcconto.useMutation({
    onSuccess: async (res) => { await makeDoc(res.invoice); onDone(); },
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); mut.mutate({
      matterId, clientShareBips, amountOre: Math.round(effectiveKr * 100), recipient: "KLIENT",
    }); }} className="space-y-3">
      <p className="text-sm text-gray-600">
        Acconto baseras på klientens självrisk-/avgifts-procentsats × upparbetat värde,
        minus tidigare aconton. Justera beloppet vid behov (t.ex. för att runda av).
      </p>
      <ProposalSummary workValueOre={workValueOre} priorOre={priorOre} suggestedOre={suggestedOre} />
      <Field label="Klientens andel (procent)">
        <input type="number" min={0} max={100} step={1} value={clientShareBips / 100}
          onChange={(e) => setBips(Math.round((parseFloat(e.target.value) || 0) * 100))}
          className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
      </Field>
      <Field label="Belopp (kr)">
        <input type="number" min={0} step={1} value={effectiveKr}
          onChange={(e) => setAmountKr(parseFloat(e.target.value) || 0)}
          className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
      </Field>
      {mut.error && <p className="text-sm text-red-700">{mut.error.message}</p>}
      <SubmitRow onDone={onDone} pending={mut.isPending} label="Skapa aconto-faktura" />
    </form>
  );
}

function ProposalSummary({ workValueOre, priorOre, suggestedOre }: { workValueOre: number; priorOre: number; suggestedOre: number }) {
  return (
    <div className="grid grid-cols-3 gap-2 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-center">
      <Stat label="Upparbetat" value={workValueOre} />
      <Stat label="Tidigare aconton" value={priorOre} />
      <Stat label="Förslag" value={suggestedOre} strong />
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-gray-500">{label}</div>
      <div className={`font-mono text-sm ${strong ? "font-semibold text-gray-900" : "text-gray-700"}`}>{formatCurrency(value)}</div>
    </div>
  );
}

function FinalForm({ matterId, meta, accontos, onDone }: { matterId: string; meta: BillingMeta; accontos: AccontoRow[]; onDone: () => void }) {
  const proposal = trpc.billingRun.proposal.useQuery({ matterId });
  const [recipient, setRecipient] = useState<"KLIENT" | "FORSAKRING" | "RATTSHJALPSMYNDIGHET">("KLIENT");
  const [selected, setSelected] = useState<string[]>(accontos.map((a) => a.id));
  const makeDoc = useFakturaDoc(matterId, meta);
  const mut = trpc.billingRun.createFinal.useMutation({
    onSuccess: async (res) => { await makeDoc(res.invoice); onDone(); },
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); mut.mutate({
      matterId, recipient, deductedBillingRunIds: selected,
    }); }} className="space-y-3">
      <p className="text-sm text-gray-600">
        Faktura med full specifikation av tid och utlägg. Alla obetalda
        tids- och utläggsrader fryses och tas med nedan.
      </p>
      <UnbilledPosts proposal={proposal.data} loading={proposal.isLoading} />
      <Field label="Mottagare">
        <select value={recipient} onChange={(e) => setRecipient(e.target.value as typeof recipient)}
          className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm">
          <option value="KLIENT">Klient (PRIVAT)</option>
          <option value="FORSAKRING">Försäkringsbolag (rättsskydd)</option>
          <option value="RATTSHJALPSMYNDIGHET">Rättshjälpsmyndighet</option>
        </select>
      </Field>
      {accontos.length > 0 && (
        <Field label="Avdrag (tidigare aconton)">
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {accontos.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={selected.includes(a.id)}
                  onChange={(e) => setSelected((s) => e.target.checked ? [...s, a.id] : s.filter((x) => x !== a.id))} />
                <span className="font-mono">{formatCurrency(a.amountOre)}</span>
                <span className="text-gray-500 text-xs">({a.recipient})</span>
              </label>
            ))}
          </div>
        </Field>
      )}
      {mut.error && <p className="text-sm text-red-700">{mut.error.message}</p>}
      <SubmitRow onDone={onDone} pending={mut.isPending} label="Skapa faktura" />
    </form>
  );
}

interface ProposalData {
  workValueOre: number;
  timeEntries: Array<{ id: string; description: string; valueOre: number; billable: boolean }>;
  expenses: Array<{ id: string; description: string; amount: number; billable: boolean }>;
}

function UnbilledPosts({ proposal, loading }: { proposal: ProposalData | undefined; loading: boolean }) {
  if (loading) return <p className="text-xs text-gray-500">Laddar ofakturerade poster…</p>;
  const posts = unbilledRows(proposal);
  if (posts.length === 0) return <p className="text-xs text-gray-500">Inga ofakturerade poster i ärendet.</p>;
  return (
    <Field label={`Ofakturerade poster (${posts.length}) — föreslås i fakturan`}>
      <div className="space-y-1 max-h-40 overflow-y-auto rounded border border-gray-200 bg-gray-50 px-2 py-1.5">
        {posts.map((p) => (
          <div key={p.id} className="flex items-center justify-between text-xs">
            <span className="truncate text-gray-700">{p.label}</span>
            <span className="font-mono text-gray-900">{formatCurrency(p.valueOre)}</span>
          </div>
        ))}
        <div className="flex items-center justify-between border-t border-gray-300 pt-1 text-xs font-semibold">
          <span>Upparbetat värde</span>
          <span className="font-mono">{formatCurrency(proposal?.workValueOre ?? 0)}</span>
        </div>
      </div>
    </Field>
  );
}

interface PostRow { id: string; label: string; valueOre: number }

function unbilledRows(proposal: ProposalData | undefined): PostRow[] {
  if (!proposal) return [];
  const time = proposal.timeEntries
    .filter((t) => t.billable)
    .map((t) => ({ id: `te-${t.id}`, label: t.description || "Tidspost", valueOre: t.valueOre }));
  const exp = proposal.expenses
    .filter((e) => e.billable)
    .map((e) => ({ id: `ex-${e.id}`, label: e.description || "Utlägg", valueOre: e.amount }));
  return [...time, ...exp];
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

function SubmitRow({ onDone, pending, label }: { onDone: () => void; pending: boolean; label: string }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button type="button" onClick={onDone} className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">Avbryt</button>
      <button type="submit" disabled={pending} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
        {pending ? "Skapar…" : label}
      </button>
    </div>
  );
}
