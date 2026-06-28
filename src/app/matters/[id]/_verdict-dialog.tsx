"use client";

/**
 * `VerdictDialog` — sista steget för OFFENTLIG_FÖRSVARARE/offentligt uppdrag.
 *
 * Domstolens beslut (dömt belopp + ev. prutning) registreras redan på
 * kostnadsräkningen (RecordBeslutDialog) → KR:n är BESLUTAD. Här bekräftar
 * advokaten bara att fakturan ska skapas; servern läser prutningen ur KR:ns
 * beslut (`setVerdict` tar inget belopp som input) och skapar Invoice +
 * ev. Expense(kind=PRUTNING) + fryser raderna.
 */
import { VatBreakdown } from "@/components/billing/vat-breakdown";
import { Modal } from "@/components/ui/modal";
import { generateFakturaDoc } from "@/lib/client/kostnadsrakning/generate-faktura-doc";
import { trpc } from "@/lib/client/trpc";
import { formatCurrency } from "@/lib/client/utils";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import type { BillingRunId, MatterId } from "@/lib/shared/schemas/ids";

interface Props {
  billingRunId: BillingRunId;
  workValueOre: number;
  awardedOre: number;
  matterId: MatterId;
  matterNumber: string;
  matterTitle: string;
  clientName?: string;
  organizationName?: string;
  organizationOrgNumber?: string;
  onClose: () => void;
}

export function VerdictDialog(props: Props) {
  const { billingRunId, workValueOre, awardedOre, onClose } = props;
  const prutningOre = awardedOre - workValueOre;
  const register = trpc.document.register.useMutation();
  const utils = trpc.useUtils();
  const mut = trpc.billingRun.setVerdict.useMutation({
    onSuccess: async (res) => {
      // Lägg ett faktura-dokument i fil-listan ur den skapade fakturan.
      try {
        await generateFakturaDoc({
          invoice: (res as { invoice: Parameters<typeof generateFakturaDoc>[0]["invoice"] }).invoice,
          matterId: props.matterId,
          meta: {
            matterNumber: props.matterNumber, matterTitle: props.matterTitle,
            ...omitUndefined({
              clientName: props.clientName,
              organizationName: props.organizationName,
              organizationOrgNumber: props.organizationOrgNumber,
            }),
          },
          register, utils,
        });
      } catch (e) { console.warn("[verdict] faktura-dokument misslyckades:", e); }
      onClose();
    },
  });
  return (
    <Modal open title="Skapa faktura från beslut" onClose={onClose} widthClass="max-w-md">
      <form onSubmit={(e) => { e.preventDefault(); mut.mutate({ billingRunId }); }}
        className="space-y-3">
        <p className="text-sm text-gray-600">
          Domstolens beslut är registrerat på kostnadsräkningen. Fakturan skapas
          på det dömda beloppet — ev. prutning bokförs automatiskt.
        </p>
        <Pair label="Föreslaget belopp" value={formatCurrency(workValueOre)} />
        <Pair label="Dömt belopp — inkl. moms" value={formatCurrency(awardedOre)} />
        <VatBreakdown inclOre={awardedOre} />
        {prutningOre < 0 && (
          <Pair label="Prutning" value={formatCurrency(prutningOre)} dim />
        )}
        {mut.error && <p className="text-sm text-red-700">{mut.error.message}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">Avbryt</button>
          <button type="submit" disabled={mut.isPending}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            {mut.isPending ? "Sparar…" : "Skapa faktura"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Pair({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <div className={`rounded border px-3 py-2 ${dim ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-gray-50"}`}>
      <div className="text-[10px] uppercase text-gray-500">{label}</div>
      <div className="font-mono font-semibold">{value}</div>
    </div>
  );
}
