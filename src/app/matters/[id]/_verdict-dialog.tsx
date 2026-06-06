"use client";

/**
 * `VerdictDialog` — andra steget för OFFENTLIG_FÖRSVARARE-flowet.
 *
 * Kostnadsräkningen ligger i PENDING_VERDICT efter att advokaten skickat
 * den. Här anger advokaten det belopp som domen beviljade. Systemet
 * räknar baklänges till prutningen (= dömt − föreslaget) och skapar
 * Invoice + ev. Expense(kind=PRUTNING) + fryser raderna.
 *
 * Domen anger det FAKTISKA beloppet, inte hur mycket som prutats — så
 * det är vad advokaten skriver in.
 */
import { useState } from "react";
import type { inferRouterInputs } from "@trpc/server";
import { trpc } from "@/lib/client/trpc";
import type { AppRouter } from "@/lib/server/routers/_app";
import { formatCurrency } from "@/lib/client/utils";
import { Modal } from "@/components/ui/modal";

type RouterInputs = inferRouterInputs<AppRouter>;

interface Props {
  billingRunId: string;
  workValueOre: number;
  matterId: string;
  matterNumber: string;
  matterTitle: string;
  clientName?: string;
  organizationName?: string;
  organizationOrgNumber?: string;
  onClose: () => void;
}

type RegisterMut = { mutateAsync: (i: RouterInputs["document"]["register"]) => Promise<unknown> };
type TreeFilter = RouterInputs["document"]["tree"];
type ListFilter = RouterInputs["document"]["list"];
type DocUtils = {
  document: {
    tree: { invalidate: (f?: TreeFilter) => Promise<unknown>; refetch: (f?: TreeFilter) => Promise<unknown> };
    list: { invalidate: (f?: ListFilter) => Promise<unknown> };
  };
};

/**
 * Generera ett faktura-DOKUMENT (PDF) ur den nyss skapade invoice-entiteten och
 * lägg det i ärendets fil-lista (parallellt med Invoice-objektet). document.register
 * emittar inga events (ingen read-only-trap), så detta funkar i demo/git-backend.
 */
async function generateFakturaDoc(
  invoice: { id: string; amount: number; invoiceNumber?: string | null; invoiceDate?: string | Date | null },
  props: Props, register: RegisterMut, utils: DocUtils,
): Promise<void> {
  const { renderFakturaPdf } = await import("@/lib/client/kostnadsrakning/render-faktura-pdf");
  const { persistGeneratedDoc } = await import("@/lib/client/demo/persist-generated-doc");
  const bytes = await renderFakturaPdf({
    invoice,
    meta: {
      matterNumber: props.matterNumber, matterTitle: props.matterTitle,
      ...(props.clientName !== undefined ? { clientName: props.clientName } : {}),
      ...(props.organizationName !== undefined ? { organizationName: props.organizationName } : {}),
      ...(props.organizationOrgNumber !== undefined ? { organizationOrgNumber: props.organizationOrgNumber } : {}),
    },
  });
  const docId = `faktura-${invoice.id}`;
  const fileName = `Faktura ${props.matterNumber} ${new Date().toISOString().slice(0, 10)}.pdf`;
  const storagePath = `documents/content/${docId}.pdf`;
  await register.mutateAsync({
    id: docId, matterId: props.matterId, fileName, mimeType: "application/pdf",
    sizeBytes: bytes.byteLength, storagePath, documentType: "Faktura",
    invoiceId: invoice.id, analysisStatus: "DONE",
  });
  await persistGeneratedDoc({ id: docId, storagePath, fileName, mimeType: "application/pdf", bytes });
  try {
    await utils.document.tree.invalidate({ matterId: props.matterId });
    await utils.document.tree.refetch({ matterId: props.matterId });
    await utils.document.list.invalidate();
  } catch { /* best-effort */ }
}

export function VerdictDialog(props: Props) {
  const { billingRunId, workValueOre, onClose } = props;
  const [awardedKr, setAwardedKr] = useState(workValueOre / 100);
  const register = trpc.document.register.useMutation();
  const utils = trpc.useUtils();
  const mut = trpc.billingRun.setVerdict.useMutation({
    onSuccess: async (res) => {
      // Lägg ett faktura-dokument i fil-listan ur den skapade fakturan.
      try { await generateFakturaDoc((res as { invoice: Parameters<typeof generateFakturaDoc>[0] }).invoice, props, register, utils as unknown as DocUtils); }
      catch (e) { console.warn("[verdict] faktura-dokument misslyckades:", e); }
      onClose();
    },
  });
  const awardedOre = Math.max(0, Math.round(awardedKr * 100));
  const prutningOre = awardedOre - workValueOre; // ≤ 0
  const tooHigh = awardedOre > workValueOre;

  return (
    <Modal open title="Ange dom" onClose={onClose} widthClass="max-w-md">
      <form onSubmit={(e) => { e.preventDefault(); if (!tooHigh) mut.mutate({ billingRunId, prutningOre }); }}
        className="space-y-3">
        <p className="text-sm text-gray-600">
          Skriv in det belopp som domen beviljade. Är det lägre än det
          föreslagna räknas mellanskillnaden automatiskt som prutning.
        </p>
        <Pair label="Föreslaget belopp" value={formatCurrency(workValueOre)} />
        <div>
          <label className="block text-xs text-gray-500 mb-1">Dömt belopp (kr)</label>
          <input type="number" min={0} step={1} value={awardedKr}
            onChange={(e) => setAwardedKr(parseFloat(e.target.value) || 0)}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
          {tooHigh && (
            <p className="mt-1 text-xs text-red-600">
              Dömt belopp kan inte överstiga föreslaget — kontrollera siffran från domen.
            </p>
          )}
        </div>
        {prutningOre < 0 && !tooHigh && (
          <Pair label="Prutning" value={formatCurrency(prutningOre)} dim />
        )}
        {mut.error && <p className="text-sm text-red-700">{mut.error.message}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">Avbryt</button>
          <button type="submit" disabled={mut.isPending || tooHigh}
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
