"use client";

/**
 * `SettlementDialog` (#801) — slutreglera ett rättsskydds-/rättshjälpsärende när
 * betalaren svarat:
 *   - Rättshjälp: domen anger beviljat belopp → byrån bär ev. prutning, klientens
 *     självrisk räknas på det beviljade.
 *   - Rättsskydd: försäkringsbrevet anger prutning → klienten tar mellanskillnaden.
 *
 * Arbetet värderas om på det då gällande timarvodet (server: coverageSplit).
 * Skapar klient- + betalar-faktura och bokar ev. byrå-förlust.
 */

import type { inferRouterOutputs } from "@trpc/server";
import { useState } from "react";
import { DecimalInput } from "@/components/ui/decimal-input";
import { Modal } from "@/components/ui/modal";
import { generateFakturaFromTemplate, type BreakdownRow, type DocUtils, type FakturaBreakdown, type FakturaDocMeta, type InvoiceSpecification, type RegisterMut } from "@/lib/client/kostnadsrakning/generate-faktura-doc";
import { trpc } from "@/lib/client/trpc";
import { formatCurrency } from "@/lib/client/utils";
import { useVatDisplay } from "@/lib/client/vat/vat-display-context";
import type { AppRouter } from "@/lib/server/routers/_app";
import { arvodeInclVatOre } from "@/lib/shared/invoice-calc";
import type { PaymentMethod } from "@/lib/shared/schemas/enums";
import type { InvoiceId, MatterId } from "@/lib/shared/schemas/ids";

interface SplitData {
  clientOre: number;
  payerOre: number;
  firmLossOre: number;
  totalOre: number;
  /** Utlägg netto + brutto — separat eftersom utlägg har BLANDADE momssatser och
   *  bruttot inte kan räknas ur nettot med en platt 25 %-sats (#850). */
  expensesNetOre: number;
  expensesGrossOre: number;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-xs text-gray-500 mb-1">{label}</label>{children}</div>;
}

/** Rad som visar EXAKT netto/brutto (ej platt sats) och följer den globala
 *  incl/excl-växlingen (#841/#850) — krävs då utlägg kan ha olika momssatser. */
function Row({ label, netOre, grossOre, dim }: { label: string; netOre: number; grossOre: number; dim?: boolean }) {
  const { mode, toggle } = useVatDisplay();
  const shown = mode === "incl" ? grossOre : netOre;
  return (
    <div className={`flex justify-between text-sm ${dim ? "text-amber-700" : "text-gray-700"}`}>
      <span>{label}</span>
      <button type="button" onClick={toggle} title={`Visar ${mode === "incl" ? "inkl." : "exkl."} moms — klicka för att växla`}
        className="font-mono underline decoration-dotted decoration-gray-300 underline-offset-2 hover:decoration-gray-500">
        {formatCurrency(shown)}
      </button>
    </div>
  );
}

/** Förhandsvisning av uppdelningen — följer den globala momsväxlingen (#841).
 *  Arvodesrader har enhetlig 25 % (arvodeInclVatOre); utläggen exakt brutto (#850). */
function SplitPreview({ data, payerLabel }: { data: SplitData; payerLabel: string }) {
  return (
    <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 space-y-1">
      <Row label="Upparbetat (aktuellt timarvode)" netOre={data.totalOre} grossOre={arvodeInclVatOre(data.totalOre)} />
      {data.expensesNetOre > 0 && <Row label="Utlägg" netOre={data.expensesNetOre} grossOre={data.expensesGrossOre} />}
      <Row label="Klientens del" netOre={data.clientOre} grossOre={arvodeInclVatOre(data.clientOre)} />
      {/* Betalaren står för sin arvodesdel + utläggen (coverageInvoiceLines, #849). */}
      <Row label={payerLabel} netOre={data.payerOre + data.expensesNetOre} grossOre={arvodeInclVatOre(data.payerOre) + data.expensesGrossOre} />
      {data.firmLossOre > 0 && <Row label="Byrån bär (prutning)" netOre={data.firmLossOre} grossOre={arvodeInclVatOre(data.firmLossOre)} dim />}
      <p className="text-[11px] text-gray-400 pt-1">Klicka på ett belopp för att växla inkl./exkl. moms.</p>
    </div>
  );
}

type SettleResult = inferRouterOutputs<AppRouter>["billingRun"]["settleCoverage"];
type MatterDetail = inferRouterOutputs<AppRouter>["matter"]["getById"];
type OrgSettings = inferRouterOutputs<AppRouter>["organization"]["getSettings"];

/** Generera faktura-dokument (template-motorn) för klient- + betalar-fakturan
 *  efter slutreglering (#852). Utbrutet så dialogen håller sig ≤8 i komplexitet. */
function settlementMeta(matter: MatterDetail | undefined, org: OrgSettings | undefined): FakturaDocMeta {
  const meta: FakturaDocMeta = { matterNumber: "", matterTitle: "" };
  if (matter) { meta.matterNumber = matter.matterNumber; meta.matterTitle = matter.title; }
  if (org?.name) meta.organizationName = org.name;
  if (org?.orgNumber) meta.organizationOrgNumber = org.orgNumber;
  return meta;
}

function clientNameOf(matter: MatterDetail | undefined): string {
  return matter?.contacts?.find((c) => c.role === "KLIENT")?.contact?.name ?? "Klient";
}

type Breakdown = SettleResult["breakdown"];

const svd = (d: string | Date | null | undefined): string => (d ? new Date(d).toLocaleDateString("sv-SE") : "");

/** Betalar-fakturans (domstol/försäkring) nedbrytning (#858): tids-/utläggsraderna
 *  kommer ur `spec`; här bara AVDRAGEN — självrisk/rådgivning/prutning (belopps-
 *  påverkande) + aconton som info-rader (avräknas på klientfakturan, ej här). */
function payerBreakdown(b: Breakdown, payerLabel: string): FakturaBreakdown {
  const rows: BreakdownRow[] = [{ label: "Klientens självrisk", amountOre: b.sjalvriskGrossOre, kind: "deduct" }];
  if (b.radgivningGrossOre > 0) rows.push({ label: "Rådgivning (faktureras klienten)", amountOre: b.radgivningGrossOre, kind: "deduct" });
  if (b.prutningGrossOre > 0) rows.push({ label: "Prutning (byrån bär)", amountOre: b.prutningGrossOre, kind: "deduct" });
  for (const d of b.deductedAccontos) rows.push({ label: `Betalt via aconto — faktura ${d.invoiceNumber}${d.date ? ` (${svd(d.date)})` : ""}`, amountOre: d.amountOre, kind: "info" });
  return { rows, totalLabel: `${payerLabel} — att betala (inkl moms)`, totalOre: b.payerPayableOre };
}

/** Klientfakturans nedbrytning (#858): självrisk-uträkningen + de avdragna
 *  (betalda) aconton, som avräknas här → att betala. */
function clientBreakdown(b: Breakdown, isRattshjalp: boolean): FakturaBreakdown {
  const share = (b.clientShareBips / 100).toLocaleString("sv-SE", { maximumFractionDigits: 2 });
  const label = isRattshjalp
    ? `Självrisk (${share} % av upparbetat arvode ${formatCurrency(b.arvodeBaseNetOre)}, inkl moms)`
    : "Klientens del / självrisk (inkl moms)";
  const rows: BreakdownRow[] = [{ label, amountOre: b.sjalvriskGrossOre, kind: "add" }];
  for (const d of b.deductedAccontos) rows.push({ label: `Avgår aconto — faktura ${d.invoiceNumber}${d.date ? ` (${svd(d.date)})` : ""}`, amountOre: d.amountOre, kind: "deduct" });
  return { rows, totalLabel: "Att betala (inkl moms)", totalOre: b.clientPayableOre };
}

async function generateSettlementDocs(res: SettleResult, opts: {
  matterId: MatterId; matter: MatterDetail | undefined; org: OrgSettings | undefined;
  payerLabel: string; isRattshjalp: boolean; register: RegisterMut; utils: DocUtils;
  fetchSpec: (invoiceId: InvoiceId) => Promise<InvoiceSpecification>;
}): Promise<void> {
  const { matterId, matter, org, payerLabel, isRattshjalp, register, utils, fetchSpec } = opts;
  const meta = settlementMeta(matter, org);
  // Betalar-fakturan: tids-/utläggsspec (#856) + itemiserad nedbrytning (#858).
  const payerSpec = await fetchSpec(res.payerInvoice.id);
  await generateFakturaFromTemplate({ invoice: res.payerInvoice, matterId, recipient: payerLabel, meta, register, utils, spec: payerSpec, breakdown: payerBreakdown(res.breakdown, payerLabel) });
  // Klientfakturan: självrisk-uträkning + aconto-avdrag (ingen tidslista).
  await generateFakturaFromTemplate({ invoice: res.clientInvoice, matterId, recipient: clientNameOf(matter), meta, register, utils, breakdown: clientBreakdown(res.breakdown, isRattshjalp) });
}

/** Härleder alla metod-beroende texter/argument (håller komponenten ≤8). */
function settlementConfig(isRattshjalp: boolean, matterId: MatterId, ore: number | undefined) {
  // Rättshjälp: slutfakturan går till DOMSTOL (#856), inte rättshjälpsmyndigheten.
  const payerRecipient = isRattshjalp ? ("DOMSTOL" as const) : ("FORSAKRING" as const);
  return {
    payerRecipient,
    fieldLabel: isRattshjalp ? "Dömt belopp (kr)" : "Försäkringens prutning (kr)",
    payerLabel: isRattshjalp ? "Domstolen betalar" : "Försäkringen betalar",
    help: isRattshjalp
      ? "Ange beloppet domen beviljade. Byrån bär eventuell prutning; klientens självrisk räknas på det beviljade beloppet."
      : "Ange försäkringsbolagets prutning ur beskedet. Klienten tar mellanskillnaden (självrisk + prutning).",
    splitArg: isRattshjalp ? { matterId, awardedOre: ore } : { matterId, insurerPrutningOre: ore },
    settleArg: isRattshjalp ? { matterId, payerRecipient, awardedOre: ore } : { matterId, payerRecipient, insurerPrutningOre: ore },
  };
}

export function SettlementDialog({ matterId, paymentMethod, onClose }: { matterId: MatterId; paymentMethod: PaymentMethod; onClose: () => void }) {
  const [kr, setKr] = useState<number | null>(null);
  const ore = kr != null ? Math.round(kr * 100) : undefined;
  const cfg = settlementConfig(paymentMethod === "RATTSHJALP", matterId, ore);
  const split = trpc.billingRun.coverageSplit.useQuery(cfg.splitArg);
  const utils = trpc.useUtils();
  const matterQ = trpc.matter.getById.useQuery({ id: matterId });
  const orgQ = trpc.organization.getSettings.useQuery();
  const register = trpc.document.register.useMutation();
  const settle = trpc.billingRun.settleCoverage.useMutation({
    onSuccess: async (res) => {
      // Generera faktura-DOKUMENT (via template-motorn, #852) för båda fakturorna
      // → syns i fil-listan + länkas från faktura-objektet. Best-effort.
      try {
        await generateSettlementDocs(res, {
          matterId, matter: matterQ.data, org: orgQ.data, payerLabel: cfg.payerLabel,
          isRattshjalp: paymentMethod === "RATTSHJALP", register, utils,
          fetchSpec: (invoiceId) => utils.billingRun.invoiceSpecification.fetch({ matterId, invoiceId }),
        });
      } catch (e) { console.warn("[settlement] fakturadokument misslyckades:", e); }
      void utils.billingRun.list.invalidate({ matterId });
      void utils.invoice.list.invalidate();
      onClose();
    },
  });
  return (
    <Modal open title="Slutreglera ärende" onClose={onClose} widthClass="max-w-md">
      <form onSubmit={(e) => { e.preventDefault(); settle.mutate(cfg.settleArg); }} className="space-y-3">
        <p className="text-sm text-gray-600">{cfg.help}</p>
        <Field label={cfg.fieldLabel}>
          <DecimalInput value={kr} onChange={setKr} placeholder="Skriv in belopp"
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
        </Field>
        {split.data && <SplitPreview data={split.data} payerLabel={cfg.payerLabel} />}
        {settle.error && <p className="text-sm text-red-700">{settle.error.message}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">Avbryt</button>
          <button type="submit" disabled={settle.isPending}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            {settle.isPending ? "Skapar…" : "Skapa fakturor"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
