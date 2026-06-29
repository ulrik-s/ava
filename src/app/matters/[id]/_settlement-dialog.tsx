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

import { useState } from "react";
import { DecimalInput } from "@/components/ui/decimal-input";
import { Modal } from "@/components/ui/modal";
import { Money } from "@/components/ui/money";
import { trpc } from "@/lib/client/trpc";
import type { PaymentMethod } from "@/lib/shared/schemas/enums";
import type { MatterId } from "@/lib/shared/schemas/ids";

interface SplitData {
  clientOre: number;
  payerOre: number;
  firmLossOre: number;
  totalOre: number;
  /** Utlägg (netto) — bokas på betalaren tillsammans med dess arvodesdel (#849). */
  expensesOre: number;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-xs text-gray-500 mb-1">{label}</label>{children}</div>;
}

function Row({ label, ore, dim }: { label: string; ore: number; dim?: boolean }) {
  return (
    <div className={`flex justify-between text-sm ${dim ? "text-amber-700" : "text-gray-700"}`}>
      {/* Beloppen lagras netto (exkl moms); <Money basis="net"> visar dem på samma
          momsbasis som resten av panelen och följer den globala incl/excl-växlingen (#841). */}
      <span>{label}</span><Money ore={ore} basis="net" className="font-mono" />
    </div>
  );
}

/** Förhandsvisning av uppdelningen — följer den globala momsväxlingen (#841). */
function SplitPreview({ data, payerLabel }: { data: SplitData; payerLabel: string }) {
  return (
    <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 space-y-1">
      <Row label="Upparbetat (aktuellt timarvode)" ore={data.totalOre} />
      {data.expensesOre > 0 && <Row label="Utlägg" ore={data.expensesOre} />}
      <Row label="Klientens del" ore={data.clientOre} />
      {/* Betalaren står för sin arvodesdel + utläggen (coverageInvoiceLines, #849). */}
      <Row label={payerLabel} ore={data.payerOre + data.expensesOre} />
      {data.firmLossOre > 0 && <Row label="Byrån bär (prutning)" ore={data.firmLossOre} dim />}
      <p className="text-[11px] text-gray-400 pt-1">Klicka på ett belopp för att växla inkl./exkl. moms.</p>
    </div>
  );
}

/** Härleder alla metod-beroende texter/argument (håller komponenten ≤8). */
function settlementConfig(isRattshjalp: boolean, matterId: MatterId, ore: number | undefined) {
  const payerRecipient = isRattshjalp ? ("RATTSHJALPSMYNDIGHET" as const) : ("FORSAKRING" as const);
  return {
    payerRecipient,
    fieldLabel: isRattshjalp ? "Dömt belopp (kr)" : "Försäkringens prutning (kr)",
    payerLabel: isRattshjalp ? "Staten betalar" : "Försäkringen betalar",
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
  const settle = trpc.billingRun.settleCoverage.useMutation({
    onSuccess: () => {
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
