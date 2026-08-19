/**
 * `bookUnbookedInvoices` — drivrutinen som gör bokföring till ett FLÖDE (#1030).
 *
 * Delarna fanns sedan #82/#233: `buildSemanticVoucher` (faktura → balanserat
 * verifikat), `LedgerConnector.pushVoucher` (verifikat → bokföringssystem) och
 * `invoice.markFortnoxBooked` (write-back). Ingenting band ihop dem, så det gick
 * inte att e2e-testa mot riktiga Fortnox — man kunde bara enhetstesta bitarna.
 *
 * ## Idempotens
 *
 * Kandidaten ÄR "saknar externt id". Drivrutinen håller därför inget eget
 * state: en omkörning ser en redan bokförd faktura som icke-kandidat och rör
 * den inte. Det är samma invariant som `markExternalId` vaktar på sin sida
 * (skriver aldrig över ett satt id) — bälte och hängslen, med avsikt: en
 * dubbelbokföring i en huvudbok går inte att ångra.
 *
 * ## Varför utkast och annullerade hoppas över
 *
 * Ett utkast är inte utställt och existerar inte bokföringsmässigt; en
 * annullerad faktura ska inte bokföras alls (krediteringen är en EGEN faktura
 * med eget verifikat). Kundförlust bokförs däremot — den är en verklig
 * affärshändelse (ADR 0007).
 */

import { buildSemanticVoucher, type VatBreakdownLine } from "@/lib/shared/accounting/semantic-voucher";
import type { InvoiceStatus } from "@/lib/shared/schemas/enums";
import type { LedgerAttachment, LedgerConnector } from "./port";

/** Fakturaraden drivrutinen behöver — en delmängd av listvyns rad. */
export interface BookableInvoice {
  id: string;
  amount: number;
  vatOre: number | null;
  vatBreakdown: VatBreakdownLine[] | null;
  invoiceDate: Date | string;
  invoiceNumber: string | null;
  status: string;
  /** Satt = redan bokförd → aldrig kandidat. */
  fortnoxId: string | null;
  matter: { matterNumber: string | null } | null;
}

/** Statusar som INTE bokförs. Se modulens header för varför. */
const SKIPPED_STATUSES: ReadonlySet<string> = new Set<InvoiceStatus>(["DRAFT", "CANCELLED"]);

/** Är fakturan en kandidat för bokföring? */
export function isBookable(inv: BookableInvoice): boolean {
  return !inv.fortnoxId && !SKIPPED_STATUSES.has(inv.status);
}

/** Utfallet per faktura — `error` sätts i st.f. att kasta, se `bookUnbookedInvoices`. */
export interface BookingOutcome {
  invoiceId: string;
  invoiceNumber: string | null;
  /** Satt vid lyckad push (t.ex. "A/42"). Ömsesidigt uteslutande med `error`. */
  externalId: string | null;
  error: string | null;
}

export interface BookInvoicesDeps {
  /** Kandidaterna (anroparen org-scopar och hämtar). */
  invoices: readonly BookableInvoice[];
  connector: Pick<LedgerConnector, "pushVoucher" | "capabilities">;
  /** Write-back av externt id. Måste vara idempotent på sin sida. */
  markBooked: (invoiceId: string, externalId: string) => Promise<unknown>;
  /** Faktura-PDF att arkivera med verifikatet (#785); utelämnas → ingen bilaga. */
  attachmentFor?: (inv: BookableInvoice) => Promise<LedgerAttachment | undefined>;
}

/** Bilagan för en faktura, eller undefined. Fel här får INTE stoppa bokföringen:
 *  ett saknat PDF är ett arkiveringsproblem, inte ett bokföringsproblem. */
async function attachmentOrNone(
  inv: BookableInvoice,
  fetcher: BookInvoicesDeps["attachmentFor"],
): Promise<LedgerAttachment | undefined> {
  if (!fetcher) return undefined;
  try {
    return await fetcher(inv);
  } catch {
    return undefined;
  }
}

/** Verifikat-push:aren, eller ett tydligt fel. Porten gör metoden valfri och
 *  kapabiliteten är sanningen — den kopplingen löses EN gång, här. */
type PushFn = NonNullable<LedgerConnector["pushVoucher"]>;
function pushFnOf(connector: BookInvoicesDeps["connector"]): PushFn {
  const push = connector.pushVoucher;
  if (!connector.capabilities().pushVoucher || !push) {
    throw new Error("Ledger-connectorn saknar pushVoucher-kapabilitet.");
  }
  return push.bind(connector) as PushFn;
}

/** Bokför EN faktura. Utbruten så `bookUnbookedInvoices` håller komplexitet ≤ 8. */
async function bookOne(inv: BookableInvoice, deps: BookInvoicesDeps, push: PushFn): Promise<BookingOutcome> {
  const base = { invoiceId: inv.id, invoiceNumber: inv.invoiceNumber };
  try {
    const voucher = buildSemanticVoucher({
      amount: inv.amount,
      vatOre: inv.vatOre,
      vatBreakdown: inv.vatBreakdown,
      invoiceDate: inv.invoiceDate,
      invoiceNumber: inv.invoiceNumber,
      matterNumber: inv.matter?.matterNumber ?? null,
    });
    const attachment = await attachmentOrNone(inv, deps.attachmentFor);
    const res = await push(voucher, {
      idempotencyKey: inv.id,
      ...(attachment ? { attachment } : {}),
    });
    // Write-back FÖRST efter lyckad push: kraschar vi mellan dem är fakturan
    // bokförd men omärkt → nästa körning dubbelbokför. Därför är det här den
    // enda riskfönstret, och det loggas som fel i st.f. att sväljas.
    await deps.markBooked(inv.id, res.externalId);
    return { ...base, externalId: res.externalId, error: null };
  } catch (e) {
    return { ...base, externalId: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Bokför alla obokförda fakturor. Returnerar utfallet per faktura i st.f. att
 * kasta vid första felet: en trasig faktura ska inte hindra de övriga från att
 * bokföras, och anroparen behöver hela bilden för att kunna rapportera.
 */
export async function bookUnbookedInvoices(deps: BookInvoicesDeps): Promise<BookingOutcome[]> {
  const push = pushFnOf(deps.connector);
  const outcomes: BookingOutcome[] = [];
  // Sekventiellt med flit: verifikatnummer serialiseras hos mottagaren, och
  // parallella pushar mot samma serie ger ingen vinst men svårlästa loggar.
  for (const inv of deps.invoices.filter(isBookable)) {
    outcomes.push(await bookOne(inv, deps, push));
  }
  return outcomes;
}
