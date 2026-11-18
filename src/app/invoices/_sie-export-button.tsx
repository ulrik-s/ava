"use client";

/**
 * "Exportera SIE" (#244) — laddar ner byråns utfärdade fakturor som en SIE 4-fil
 * för import i valfritt bokföringssystem. Ren klient-funktion (samma i demo +
 * self-hosted): hämtar fakturor + org-info via tRPC, renderar SIE lokalt
 * ([[sie-from-invoices]]) och triggar en nedladdning. Inaktiverad tills minst
 * en utfärdad faktura finns.
 */

import { downloadBytes } from "@/lib/client/download-text";
import { trpc } from "@/lib/client/trpc";
import {
  DEFAULT_LEDGER_ACCOUNT_MAP,
  toSieAccountMap,
  type LedgerAccountMap,
} from "@/lib/shared/accounting/account-map";
import { encodePc8 } from "@/lib/shared/accounting/pc8";
import { toSieDate } from "@/lib/shared/accounting/sie";
import {
  countExportable,
  invoicesToSie,
  type ExportableInvoice,
} from "@/lib/shared/accounting/sie-from-invoices";

export function SieExportButton() {
  const invoices = trpc.invoice.list.useQuery({});
  const org = trpc.organization.getSettings.useQuery();

  const rows = (invoices.data?.items ?? []) as ExportableInvoice[];
  const exportableCount = countExportable(rows);

  function handleExport(): void {
    const stamp = toSieDate(new Date()); // dagens datum, Stockholm (#1677)
    // Byråns mappning om konfigurerad (#249), annars BAS-standard.
    const map = (org.data?.ledgerAccountMap as LedgerAccountMap | null) ?? DEFAULT_LEDGER_ACCOUNT_MAP;
    const sie = invoicesToSie(rows, {
      company: {
        name: org.data?.name ?? "Byrå",
        ...(org.data?.orgNumber ? { orgNr: org.data.orgNumber } : {}),
      },
      generatedDate: stamp,
      accountMap: toSieAccountMap(map),
      series: map.voucherSeries,
    });
    // SIE deklarerar #FORMAT PC8 → koda bytes i CP437 så åäö tolkas rätt (#247).
    downloadBytes(`bokforing_${stamp}.sie`, encodePc8(sie));
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={exportableCount === 0}
      title={exportableCount === 0 ? "Inga utfärdade fakturor att exportera" : `Exportera ${exportableCount} verifikat`}
      className="text-sm text-blue-600 hover:underline disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed"
    >
      Exportera SIE →
    </button>
  );
}
