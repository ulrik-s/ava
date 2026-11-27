/**
 * Kostnadsräkningens dokument efter renderingen (#1889, utbrutet ur
 * `_kostnadsrakning-modal.tsx`): registrera dokumentet i ärendet och, med
 * AVA Helper, öppna mail-appen med PDF:en som bilaga.
 */
import type { inferRouterInputs } from "@trpc/server";
import { bytesToBase64 } from "@/lib/client/bytes-base64";
import { composeMailViaHelper } from "@/lib/client/helper/use-helper";
import type { AppRouter } from "@/lib/server/routers/_app";
import type { BillingRunId, MatterId } from "@/lib/shared/schemas/ids";

type RouterInputs = inferRouterInputs<AppRouter>;
type DocListFilter = RouterInputs["document"]["list"];
type DocTreeFilter = RouterInputs["document"]["tree"];

export interface RecordDocOpts {
  recordKostn: { mutateAsync: (i: RouterInputs["kostnadsrakning"]["record"]) => Promise<unknown> };
  utils: {
    document: {
      list: { invalidate: (filter?: DocListFilter) => Promise<unknown> };
      tree: {
        invalidate: (filter?: DocTreeFilter) => Promise<unknown>;
        refetch: (filter?: DocTreeFilter) => Promise<unknown>;
      };
    };
  };
  docId: string;
  matterId: MatterId;
  billingRunId: BillingRunId;
  fileName: string;
  storagePath: string;
  bytes: Uint8Array;
  totalInclVat: number;
  huvudforhandlingMinutes: number;
}

export async function recordDocument(opts: RecordDocOpts): Promise<void> {
  // Steg 1 MÅSTE lyckas. Om mutationen kastar propagerar vi felet så att
  // generate() visar en RIKTIG felruta istället för en falsk "sparad"-banner.
  // (Tidigare svaldes ALLT här → server-mutationen kunde rejekta på read-only
  // event-log utan att dokumentet skapades, men UI:t sa ändå "sparad".)
  await opts.recordKostn.mutateAsync({
    id: opts.docId, matterId: opts.matterId, fileName: opts.fileName,
    mimeType: "application/pdf", sizeBytes: opts.bytes.byteLength,
    storagePath: opts.storagePath, totalInclVat: opts.totalInclVat,
    huvudforhandlingMinutes: opts.huvudforhandlingMinutes,
    billingRunId: opts.billingRunId,
  });
  // Steg 2 (invalidering) är best-effort — dokumentet är redan registrerat,
  // så ett invaliderings-hicka ska inte blockera success. DocumentBrowser
  // använder document.tree; faktura-panelen document.list. Invalidera båda +
  // tvinga explicit refetch på tree (R-Q v5 + tRPC v11 håller annars ibland
  // cached data tills nästa mount).
  try {
    await opts.utils.document.tree.invalidate({ matterId: opts.matterId });
    await opts.utils.document.tree.refetch({ matterId: opts.matterId });
    await opts.utils.document.list.invalidate({ matterId: opts.matterId });
    await opts.utils.document.list.invalidate();
  } catch (e) {
    console.warn("[kostnadsrakning] dokument-invalidering misslyckades (best-effort):", e);
  }
}

export interface MailOpts {
  helperAvailable: boolean;
  fileName: string;
  bytes: Uint8Array;
  matterNumber: string;
  matterTitle: string;
  clientName: string;
  huvudforhandlingFormatted: string;
  totalInclFormatted: string;
}

export async function maybeComposeMail(opts: MailOpts): Promise<boolean> {
  if (!opts.helperAvailable) return false;
  const body = [
    `Mål: ${opts.matterNumber} (${opts.matterTitle})`,
    `Klient: ${opts.clientName}`,
    `Förhandlingstid: ${opts.huvudforhandlingFormatted}`,
    `Totalt att fakturera: ${opts.totalInclFormatted}`,
    "",
    "Kostnadsräkning bifogas.",
  ].join("\n");
  return composeMailViaHelper({
    fileName: opts.fileName,
    contentBase64: bytesToBase64(opts.bytes),
    mimeType: "application/pdf",
    subject: `Kostnadsräkning Mål ${opts.matterNumber}`,
    body,
  });
}
