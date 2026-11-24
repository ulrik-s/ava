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
import { isIssued } from "@/lib/shared/invoice-state-machine";
import type { LedgerAttachment, LedgerConnector, PushVoucherResult } from "./port";

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

/** Är fakturan en kandidat för bokföring? */
export function isBookable(inv: BookableInvoice): boolean {
  // Utställda bokförs (isIssued, samma regel som SIE-exporten); se modulens header.
  return !inv.fortnoxId && isIssued(inv.status);
}

/** Utfallet per faktura — `error` sätts i st.f. att kasta, se `bookUnbookedInvoices`. */
export interface BookingOutcome {
  invoiceId: string;
  invoiceNumber: string | null;
  /** Satt vid lyckad push (t.ex. "A/42"). Ömsesidigt uteslutande med `error`. */
  externalId: string | null;
  error: string | null;
  /** Varför bilagan inte arkiverades med verifikatet (#1885); bokföringen lyckas ändå. */
  attachmentError: string | null;
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

/** Felets text, för utfallets `error` och `attachmentError`. */
function reasonOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Bilagan (om någon) och skälet när den inte kunde hämtas (#1885). */
interface AttachmentFetch {
  attachment?: LedgerAttachment;
  error: string | null;
}

/** Bilagan för en faktura. Fel här får INTE stoppa bokföringen: ett saknat PDF
 *  är ett arkiveringsproblem, inte ett bokföringsproblem. Skälet sparas (#1885). */
async function attachmentOrNone(
  inv: BookableInvoice,
  fetcher: BookInvoicesDeps["attachmentFor"],
): Promise<AttachmentFetch> {
  if (!fetcher) return { error: null };
  try {
    const attachment = await fetcher(inv);
    return attachment ? { attachment, error: null } : { error: null };
  } catch (e) {
    return { error: reasonOf(e) };
  }
}

/** Skälet att bilagan saknas: hämtningens fel, annars connectorns (#1885). */
function attachmentErrorOf(fetched: AttachmentFetch, res: PushVoucherResult): string | null {
  return fetched.error ?? res.attachmentError ?? null;
}

/** Verifikat-push:aren, eller ett tydligt fel. Porten gör metoden valfri och
 *  kapabiliteten är sanningen — den kopplingen löses EN gång, här. */
type PushFn = NonNullable<LedgerConnector["pushVoucher"]>;
function pushFnOf(connector: BookInvoicesDeps["connector"]): PushFn {
  const push = connector.pushVoucher;
  if (!connector.capabilities().pushVoucher || !push) {
    throw new Error("Ledger-connectorn saknar pushVoucher-kapabilitet.");
  }
  return push.bind(connector);
}

/**
 * Write-back efter en lyckad push (#1453). Misslyckas den finns verifikatet
 * ändå i bokföringssystemet, och en omkörning skulle bokföra en gång till.
 * Felet säger därför vilket verifikat som skapades och att det inte ska
 * bokföras igen — en administratör kan märka posten med det id:t.
 */
export async function markBookedOrExplain(externalId: string, markBooked: () => Promise<unknown>): Promise<void> {
  try {
    await markBooked();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Verifikatet ${externalId} skapades i bokföringssystemet men kunde inte sparas i AVA (${reason}). ` +
      `Bokför inte igen — en administratör kan märka posten som bokförd med ${externalId}.`,
    );
  }
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
    const fetched = await attachmentOrNone(inv, deps.attachmentFor);
    const res = await push(voucher, {
      idempotencyKey: inv.id,
      ...(fetched.attachment ? { attachment: fetched.attachment } : {}),
    });
    // Write-back FÖRST efter lyckad push: kraschar vi mellan dem är fakturan
    // bokförd men omärkt → nästa körning dubbelbokför. Därför är det här den
    // enda riskfönstret, och felet säger vilket verifikat som skapades.
    await markBookedOrExplain(res.externalId, () => deps.markBooked(inv.id, res.externalId));
    return { ...base, externalId: res.externalId, error: null, attachmentError: attachmentErrorOf(fetched, res) };
  } catch (e) {
    return { ...base, externalId: null, error: reasonOf(e), attachmentError: null };
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
