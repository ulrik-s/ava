/**
 * `billedPerLawyer` — ren beräkning för rapporten "Fakturerat per advokat och
 * period" (#90).
 *
 * Modellbeslut (spikade i #90):
 *   - **Attribution faktura → advokat:** proportionellt mot advokatens andel
 *     av ARBETSVÄRDET i de tidsposter som frystes in i fakturan. En faktura
 *     med flera advokaters tid fördelas alltså i proportion till var och ens
 *     debiterade arbete. Fakturor utan frozen tid (t.ex. ren utläggsfaktura)
 *     kan inte attribueras → 0 för alla advokater.
 *   - **"Gått ut" i perioden:** `invoiceDate` inom [from, to] och status är en
 *     utfärdad status (ej DRAFT/CANCELLED).
 *   - **Avskrivet:** status `BAD_DEBT` ("Kundförlust"), avskrivnings-tidpunkt =
 *     `writtenOffAt` (router skickar invoice.updatedAt vid BAD_DEBT).
 *   - **Netto:** fakturerat i perioden − advokatens andel av fakturor som
 *     skrevs av i FÖREGÅENDE period.
 *
 * Ren och ramverks-agnostisk → enhetstestbar isolerat. Alla belopp i öre.
 */

/** Utfärdade statusar som räknas som "gått ut" (fakturan har lämnat huset). */
const ISSUED_STATUSES: ReadonlySet<string> = new Set(["SENT", "PAID", "BAD_DEBT", "INSTALLMENT_PLAN"]);

export interface BilledInvoiceInput {
  id: string;
  amountOre: number;
  invoiceDate: Date;
  status: string;
  /** Avskrivnings-tidpunkt (invoice.updatedAt vid BAD_DEBT), annars null. */
  writtenOffAt: Date | null;
}

/** Frozen arbetsvärde per (faktura, advokat). Råposter aggregeras internt. */
export interface FrozenWorkInput {
  invoiceId: string;
  userId: string;
  workOre: number;
}

export interface DateRange {
  from: Date;
  to: Date;
}

export interface BilledInvoiceRow {
  id: string;
  invoiceDate: Date;
  amountOre: number;
  /** Advokatens proportionella andel av fakturans belopp. */
  shareOre: number;
}

export interface BilledPerLawyerResult {
  /** Fakturor som gått ut i perioden, attribuerade till advokaten (share > 0). */
  invoices: BilledInvoiceRow[];
  /** Summa av advokatens andelar av utgångna fakturor i perioden. */
  billedOre: number;
  /** Avdrag: advokatens andel av fakturor avskrivna i föregående period. */
  writeOffOre: number;
  /** Netto-fakturerat = billedOre − writeOffOre. */
  netOre: number;
}

function inRange(d: Date, range: DateRange): boolean {
  const t = d.getTime();
  return t >= range.from.getTime() && t <= range.to.getTime();
}

/** Bygg map invoiceId → { total, perUser } arbetsvärde. */
function indexWork(frozenWork: FrozenWorkInput[]): Map<string, { total: number; perUser: Map<string, number> }> {
  const byInvoice = new Map<string, { total: number; perUser: Map<string, number> }>();
  for (const fw of frozenWork) {
    let entry = byInvoice.get(fw.invoiceId);
    if (!entry) {
      entry = { total: 0, perUser: new Map() };
      byInvoice.set(fw.invoiceId, entry);
    }
    entry.total += fw.workOre;
    entry.perUser.set(fw.userId, (entry.perUser.get(fw.userId) ?? 0) + fw.workOre);
  }
  return byInvoice;
}

/** Advokatens proportionella andel av en fakturas belopp (öre, avrundat). */
function lawyerShareOre(
  invoice: BilledInvoiceInput,
  userId: string,
  work: Map<string, { total: number; perUser: Map<string, number> }>,
): number {
  const entry = work.get(invoice.id);
  if (!entry || entry.total <= 0) return 0;
  const userWork = entry.perUser.get(userId) ?? 0;
  if (userWork <= 0) return 0;
  return Math.round((invoice.amountOre * userWork) / entry.total);
}

export interface BilledPerLawyerOpts {
  userId: string;
  invoices: BilledInvoiceInput[];
  frozenWork: FrozenWorkInput[];
  /** Rapportperioden. */
  period: DateRange;
  /** Föregående period (för avskrivnings-avdraget). */
  prevPeriod: DateRange;
}

export function billedPerLawyer(opts: BilledPerLawyerOpts): BilledPerLawyerResult {
  const work = indexWork(opts.frozenWork);

  const invoices: BilledInvoiceRow[] = [];
  let billedOre = 0;
  let writeOffOre = 0;

  for (const inv of opts.invoices) {
    const share = lawyerShareOre(inv, opts.userId, work);
    if (share <= 0) continue;

    // Fakturerat i perioden: utfärdad + invoiceDate inom perioden.
    if (ISSUED_STATUSES.has(inv.status) && inRange(inv.invoiceDate, opts.period)) {
      invoices.push({ id: inv.id, invoiceDate: inv.invoiceDate, amountOre: inv.amountOre, shareOre: share });
      billedOre += share;
    }

    // Avdrag: avskriven (BAD_DEBT) i föregående period.
    if (inv.status === "BAD_DEBT" && inv.writtenOffAt && inRange(inv.writtenOffAt, opts.prevPeriod)) {
      writeOffOre += share;
    }
  }

  invoices.sort((a, b) => a.invoiceDate.getTime() - b.invoiceDate.getTime());
  return { invoices, billedOre, writeOffOre, netOre: billedOre - writeOffOre };
}
