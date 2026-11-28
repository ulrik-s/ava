"use client";

/**
 * `BillingDialog` — skapa en BillingRun. Två kombinerade flöden:
 *   ACCONTO — avdragsmedvetet förslag (#397): belopp = klientens %-sats ×
 *             upparbetat värde − tidigare aconton. Advokat kan justera.
 *   FINAL   — recipient-val + lista av aconton att dra av, och en förhands-
 *             lista över de ofakturerade poster som kommer med i fakturan.
 *
 * Båda flödena skapar ett DRAFT-utkast OCH ett faktura-dokument i ärendets
 * dokumentlista (via `generateFakturaFromTemplate`), redo för utskick.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { VatBreakdown } from "@/components/billing/vat-breakdown";
import { DecimalInput } from "@/components/ui/decimal-input";
import { Modal } from "@/components/ui/modal";
import { useBillingQueryUtils } from "@/lib/client/billing/use-billing-query-utils";
import { pickFakturaOrgMeta, type FakturaOrgMeta } from "@/lib/client/kostnadsrakning/faktura-org-meta";
import type { FakturaBreakdown, FakturaDocInvoice, FakturaDocMeta } from "@/lib/client/kostnadsrakning/faktura-template";
import { generateFakturaFromTemplate } from "@/lib/client/kostnadsrakning/generate-faktura-doc";
import { useTRPC } from "@/lib/client/trpc";
import { DEFAULT_ACCONTO_SHARE_BIPS, proposedAccontoOre } from "@/lib/shared/billing/billing-proposal";
import { arvodeInclVatOre } from "@/lib/shared/billing/invoice-calc";
import { invoiceBreakdown } from "@/lib/shared/billing/settlement-view";
import { roundToKronor } from "@/lib/shared/billing/whole-kronor";
import { toIsoDate } from "@/lib/shared/iso-date";
import { formatKr } from "@/lib/shared/kr-format";
import type { MatterId } from "@/lib/shared/schemas/ids";
import { UnbilledPosts, usePostSelection } from "./_post-selection";

interface AccontoRow { id: string; amountOre: number; recipient: string }

/** Ärendets och byråns fält till fakturaflödena — byråfälten (namn, org.nr,
 *  logga, #1439) följer med till fakturadokumentet. */
export interface BillingMeta extends FakturaOrgMeta {
  matterNumber: string;
  matterTitle: string;
  clientName?: string;
  /** Klientens postadress — i fönsterkuvertet när fakturan går till klienten (#2255). */
  clientAddress?: string;
  /** Klientens andel i bips (2500 = 25 %); förifyller acconto-förslaget (#778). */
  clientShareBips?: number | null;
}

interface Props {
  matterId: MatterId;
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

/** Fakturadokumentets metadata; klientens adress bara när fakturan går till klienten. */
function docMetaFrom(meta: BillingMeta, recipient: string): FakturaDocMeta {
  return {
    matterNumber: meta.matterNumber, matterTitle: meta.matterTitle,
    ...(meta.clientName ? { clientName: meta.clientName } : {}),
    ...(recipient === "KLIENT" && meta.clientAddress ? { recipientAddress: meta.clientAddress } : {}),
    ...pickFakturaOrgMeta(meta),
  };
}

function recipientLabel(recipient: string, clientName?: string): string {
  if (recipient === "KLIENT") return clientName ?? "Klient";
  if (recipient === "FORSAKRING") return "Försäkringsbolag";
  return "Rättshjälpsmyndigheten";
}

/**
 * Faktura-doc via den delade mallen (#937): sammanställning på första sidan +
 * specifikation därefter, för BÅDE aconto och slutfaktura. Tider/utlägg och
 * avdragna aconto-fakturor hämtas ur `invoiceSpecification` — en ren aconto har
 * inga länkade rader och faller då tillbaka på fakturans `notes`-rad (#870).
 * Fakturans sparade nedbrytning (acontot, #1940) följer med som på fakturasidan
 * (#1941); en faktura utan nedbrytning får samma dokument som förut.
 */
type DocInvoice = FakturaDocInvoice & {
  accontoBreakdown?: FakturaBreakdown | null | undefined; settlementBreakdown?: FakturaBreakdown | null | undefined;
};

/** `recipient` = mottagarens kod (KLIENT, FORSAKRING …). */
function useFakturaDoc(matterId: MatterId, meta: BillingMeta): (invoice: DocInvoice, recipient: string) => Promise<void> {
  const t = useTRPC();
  const queryClient = useQueryClient();
  const utils = useBillingQueryUtils();
  const register = useMutation(t.document.register.mutationOptions());
  return async (invoice: DocInvoice, recipient: string) => {
    try {
      const spec = await queryClient.query(t.billingRun.invoiceSpecification.queryOptions({ matterId, invoiceId: invoice.id }));
      await generateFakturaFromTemplate({
        invoice, matterId, recipient: recipientLabel(recipient, meta.clientName), meta: docMetaFrom(meta, recipient),
        register, utils, spec, breakdown: invoiceBreakdown(invoice),
      });
    } catch (e) { console.warn("[billing] faktura-dokument misslyckades:", e); }
  };
}

/** Härleder förslag + det belopp som ska visas/skickas. Utbrutet ur
 *  AccontoForm så formuläret håller sig under komplexitetsgränsen (#199). */
function accontoAmounts(workValueOre: number, clientShareBips: number, priorOre: number, amountKr: number | null) {
  const suggestedOre = proposedAccontoOre(workValueOre, clientShareBips, priorOre);
  // Förifyllt förslag (#778) — visa det i fältet, men tomt om inget att föreslå.
  const suggestionKr = suggestedOre > 0 ? suggestedOre / 100 : null;
  const fieldKr = amountKr ?? suggestionKr;
  // Fakturans enda rad är hela kronor (#1438): det som visas är det som faktureras.
  const typedOre = Math.round((fieldKr ?? 0) * 100);
  const effectiveOre = roundToKronor(typedOre);
  return { suggestedOre, fieldKr, effectiveOre, roundedFromOre: typedOre === effectiveOre ? null : typedOre };
}

/** Säg till när beloppet avrundades — så det som syns är det som faktureras (#1438). */
function RoundedNote({ fromOre, toOre }: { fromOre: number | null; toOre: number }) {
  if (fromOre === null) return null;
  return (
    <p role="status" className="mt-1 text-[11px] text-amber-700">
      Avrundat till hela kronor: <span className="font-mono">{formatKr(toOre)}</span>
      {" "}(angivet <span className="font-mono">{formatKr(fromOre)}</span>) — fakturans rader är alltid hela kronor.
    </p>
  );
}

function AccontoForm({ matterId, meta, onDone }: { matterId: MatterId; meta: BillingMeta; onDone: () => void }) {
  const t = useTRPC();
  const proposal = useQuery(t.billingRun.proposal.queryOptions({ matterId }));
  const workValueOre = proposal.data?.workValueOre ?? 0;
  const priorOre = proposal.data?.priorAccontoSumOre ?? 0;
  // Förifyll med ärendets %-sats (#778); 20 % som fallback om ej satt.
  const [clientShareBips, setBips] = useState(meta.clientShareBips ?? DEFAULT_ACCONTO_SHARE_BIPS);
  const [amountKr, setAmountKr] = useState<number | null>(null); // null → följ förslaget
  const [invoiceDate, setInvoiceDate] = useState(() => toIsoDate(new Date()));
  const makeDoc = useFakturaDoc(matterId, meta);
  const { suggestedOre, fieldKr, effectiveOre, roundedFromOre } = accontoAmounts(workValueOre, clientShareBips, priorOre, amountKr);
  const mut = useMutation(t.billingRun.createAcconto.mutationOptions({
    onSuccess: async (res) => { await makeDoc(res.invoice, "KLIENT"); onDone(); },
  }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); mut.mutate({
      matterId, clientShareBips, amountOre: effectiveOre, recipient: "KLIENT", invoiceDate,
    }); }} className="space-y-3">
      <p className="text-sm text-gray-600">
        Acconto baseras på klientens självrisk-/avgifts-procentsats × upparbetat värde,
        minus tidigare aconton. Ändra bara beloppet i undantagsfall. Skillnaden visas som Justering på fakturan.
      </p>
      <ProposalSummary workValueOre={workValueOre} priorOre={priorOre} suggestedOre={suggestedOre} />
      <Field label="Klientens andel (procent)">
        <DecimalInput value={clientShareBips / 100} min={0}
          onChange={(v) => setBips(Math.round((v ?? 0) * 100))}
          className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
      </Field>
      <Field label="Belopp (kr) — inkl. moms">
        <DecimalInput value={fieldKr} onChange={setAmountKr} placeholder="Skriv in belopp"
          className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
        <RoundedNote fromOre={roundedFromOre} toOre={effectiveOre} />
        <VatBreakdown inclOre={effectiveOre} />
      </Field>
      <InvoiceDateField value={invoiceDate} onChange={setInvoiceDate} />
      {mut.error && <p className="text-sm text-red-700">{mut.error.message}</p>}
      <SubmitRow onDone={onDone} pending={mut.isPending} label="Skapa aconto-faktura" />
    </form>
  );
}

/** Rutan visar allt inkl. moms, utan växling (#1726): upparbetat får 25 % moms
 *  som acontofakturan, och tidigare aconton och förslaget är redan brutto. */
function ProposalSummary({ workValueOre, priorOre, suggestedOre }: { workValueOre: number; priorOre: number; suggestedOre: number }) {
  return (
    <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2">
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Upparbetat" value={arvodeInclVatOre(workValueOre)} />
        <Stat label="Tidigare aconton" value={priorOre} />
        <Stat label="Förslag" value={suggestedOre} strong />
      </div>
      <p className="mt-1 text-center text-[10px] uppercase tracking-wide text-gray-400">Belopp inkl. moms</p>
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-gray-500">{label}</div>
      <div className={`font-mono text-sm ${strong ? "font-semibold text-gray-900" : "text-gray-700"}`}>{formatKr(value)}</div>
    </div>
  );
}

function FinalForm({ matterId, meta, accontos, onDone }: { matterId: MatterId; meta: BillingMeta; accontos: AccontoRow[]; onDone: () => void }) {
  const t = useTRPC();
  const proposal = useQuery(t.billingRun.proposal.queryOptions({ matterId }));
  const [recipient, setRecipient] = useState<"KLIENT" | "FORSAKRING" | "RATTSHJALPSMYNDIGHET">("KLIENT");
  const [selected, setSelected] = useState<string[]>(accontos.map((a) => a.id));
  // Per-post-val (#734) med datumintervall (#1888): en orörd lista skickar inga id:n.
  const posts = usePostSelection(proposal.data);
  const [invoiceDate, setInvoiceDate] = useState(() => toIsoDate(new Date()));
  const makeDoc = useFakturaDoc(matterId, meta);
  const mut = useMutation(t.billingRun.createFinal.mutationOptions({
    onSuccess: async (res) => { await makeDoc(res.invoice, recipient); onDone(); },
  }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); mut.mutate({
      matterId, recipient, deductedBillingRunIds: selected, ...posts.ids, invoiceDate,
    }); }} className="space-y-3">
      <p className="text-sm text-gray-600">
        Faktura med full specifikation av tid och utlägg. Bocka i exakt vilka
        poster som ska med — ikryssade fryses och tas med på fakturan.
      </p>
      <UnbilledPosts selection={posts} loading={proposal.isLoading} />
      <InvoiceDateField value={invoiceDate} onChange={setInvoiceDate} />
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
                <span className="font-mono">{formatKr(a.amountOre)}</span>
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

/** Fakturadatum (default i dag) — förfallodag och bokföringsdatum följer det. */
function InvoiceDateField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Fakturadatum">
      <input type="date" aria-label="Fakturadatum" required value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
    </Field>
  );
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
