/**
 * Fakturor för golden-testerna (#2251, #2255): en vy-modell per fakturavariant,
 * byggd med appens egen `buildFakturaView` ur realistiska fakturor — slutfaktura
 * med flera kategorier, utlägg och avdragna aconton, aconto med självrisk-
 * avräkning (och öresutjämning), kredit, rådgivning, självrisk-nedbrytning,
 * logga, sigill och en flersidig specifikation. All data är påhittad.
 */

import { buildFakturaView, type FakturaTemplateArgs, type FakturaView } from "@/lib/client/kostnadsrakning/faktura-template";
import { buildInvoiceSpecification, type SpecExpenseLine, type SpecTimeLine } from "@/lib/shared/billing/invoice-specification";
import { orgImageSchema } from "@/lib/shared/org-image";
import { asId } from "@/lib/shared/schemas/ids";

/** 1×1 px PNG — minsta giltiga byråbild. */
export const PNG_LOGO = orgImageSchema.parse("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");

/** Byråns uppgifter (påhittade) — som organisationsinställningarna ger dem. */
export const ORG = {
  organizationName: "Advokatfirman Exempel AB", organizationOrgNumber: "556677-8899",
  organizationPhone: "08-123 456 78", organizationWebsite: "https://www.exempel.se/", organizationBankgiro: "123-4567",
};

const META = {
  matterNumber: "2026-0042", matterTitle: "Brottmål Falk", ...ORG,
  clientName: "Kalle Klientsson", recipientAddress: "Exempelgatan 1\n123 45 Exempelstad",
};

const invoice = (over: Partial<FakturaTemplateArgs["invoice"]> = {}): FakturaTemplateArgs["invoice"] => ({
  id: asId<"InvoiceId">("inv-golden"), amount: 1_046_875, invoiceNumber: "F-2026-0101", ocrReference: "202601014",
  invoiceDate: "2026-06-30", dueDate: "2026-07-30", invoiceType: "FINAL", amountRounding: "KRONOR", ...over,
});

const LONG = "Genomgång av förundersökningsprotokollet med samtliga bilagor, förhörsutskrifter och tekniska utredningar inför huvudförhandlingen";

const TIME: SpecTimeLine[] = [
  { date: "2026-05-02", description: "Genomgång av handlingar", minutes: 150, amountOre: 375_000, kind: "ARBETE" },
  { date: "2026-05-03", description: LONG, minutes: 90, amountOre: 225_000, kind: "ARBETE" },
  { date: "2026-05-04", description: "Restid till tingsrätten", minutes: 90, amountOre: 150_000, kind: "TIDSSPILLAN" },
  { date: "2026-05-05", description: "", minutes: 30, amountOre: 75_000, kind: "ARBETE" },
];

const EXPENSES: SpecExpenseLine[] = [
  { date: "2026-05-04", description: "Tågbiljett Stockholm–Uppsala t/r", netOre: 90_000, grossOre: 112_500 },
  { date: "2026-05-06", description: "Ansökningsavgift (äkta utlägg)", netOre: 90_000, grossOre: 90_000, passThrough: true },
];

const slutfaktura = (): FakturaView => buildFakturaView({
  invoice: invoice({ amount: 768_750, vatOre: 153_750 }), recipient: "Klient AB", meta: META,
  spec: buildInvoiceSpecification({
    timeLines: TIME, expenseLines: EXPENSES, rounding: "KRONOR", payableOre: 768_750,
    deductions: [{ invoiceNumber: "F-2026-0090", date: "2026-04-01", amountOre: 200_000 }],
  }),
});

/**
 * Aconto med självrisk (#151): underlaget, klientens självrisk 20 % och momsen —
 * raderna går på 2 999,60 kr, fakturan på hela kronor, så tabellen får en rad
 * Öresutjämning på 0,40 kr.
 */
const aconto = (): FakturaView => buildFakturaView({
  invoice: invoice({ invoiceType: "ACCONTO", amount: 300_000, vatOre: 60_000, notes: "Áconto debitering Brottmål Falk 2026-0042" }),
  recipient: "Kalle Klientsson", meta: { ...META, organizationLogo: PNG_LOGO, organizationFooterSeal: PNG_LOGO },
  breakdown: {
    rows: [
      { label: "Upparbetat arvode (exkl moms)", amountOre: 1_199_840, kind: "add", role: "basis" },
      { label: "Klientens självrisk (exkl moms)", amountOre: 239_968, kind: "add", basisOre: 1_199_840, shareBips: 2000 },
      { label: "Moms", amountOre: 59_992, kind: "add", basisOre: 239_968, shareBips: 2500 },
      { label: "Självrisk inkl utlägg (inkl moms)", amountOre: 299_960, kind: "add", role: "subtotal" },
    ],
    totalLabel: "Att betala (inkl moms)", totalOre: 300_000, timeLines: TIME,
  },
});

const kredit = (): FakturaView => buildFakturaView({
  invoice: invoice({ invoiceType: "CREDIT", amount: -203_250, vatOre: -40_650, invoiceNumber: "K-2026-0003", ocrReference: null, dueDate: null }),
  recipient: "Kalle Klientsson", meta: { ...META, organizationOrgNumber: "", organizationBankgiro: "" },
});

const radgivning = (): FakturaView => buildFakturaView({
  invoice: invoice({ invoiceType: "STANDARD", amount: 162_600, vatOre: 32_520, notes: "Rådgivningstimme enligt rättshjälpstaxan (1 tim)." }),
  recipient: "Cecilia Carlsson", meta: { matterNumber: "2026-0010", matterTitle: "Umgängestvist Carlsson", recipientAddress: "Provvägen 7, 234 56 Testby" },
});

const sjalvrisk = (): FakturaView => buildFakturaView({
  invoice: invoice({ invoiceType: "FINAL", amount: 250_000 }), recipient: "Klient AB", meta: { ...META, organizationLogo: PNG_LOGO },
  breakdown: {
    rows: [
      { label: "Upparbetat arvode enligt specifikation (exkl moms)", amountOre: 1_200_000, kind: "add" },
      { label: "Avgår försäkringsbolagets ersättning — rättsskyddsförsäkring Länsförsäkringar, skadenummer 2026-123456", amountOre: 950_000, kind: "deduct" },
      { label: "Betalt via aconto", amountOre: 50_000, kind: "info" },
    ],
    totalLabel: "Att betala (självrisk inkl moms)", totalOre: 250_000, timeLines: TIME.slice(0, 2), expenseLines: EXPENSES.slice(0, 1),
  },
});

const timeLine = (i: number): SpecTimeLine => ({
  date: `2026-0${3 + (i % 6)}-1${i % 10}`, description: i % 4 === 0 ? `${LONG} (${i})` : `Post ${i} — genomgång av handlingar`,
  minutes: 60, amountOre: 162_600, kind: i % 5 === 0 ? "TIDSSPILLAN" : "ARBETE",
});

const expense = (i: number): SpecExpenseLine => ({ date: "2026-05-03", description: `Utlägg ${i}`, netOre: 90_000, grossOre: 112_500 });

const flersidig = (): FakturaView => buildFakturaView({
  invoice: invoice({ amount: 12_000_000 }), recipient: "Domstolsverket", meta: { ...META, recipientAddress: "", organizationFooterSeal: PNG_LOGO },
  spec: buildInvoiceSpecification({
    timeLines: Array.from({ length: 70 }, (_, i) => timeLine(i)), expenseLines: Array.from({ length: 25 }, (_, i) => expense(i)),
    rounding: "KRONOR", payableOre: 12_000_000, deductions: [],
  }),
});

/** Fakturavarianterna golden-testerna jämför, per namn (= golden-filens namn). */
export const FAKTURA_FIXTURES: Readonly<Record<string, () => FakturaView>> = {
  slutfaktura, aconto, kredit, radgivning, sjalvrisk, flersidig,
};

/**
 * En faktura med `n` utlägg — för sidbrytningssvepet: summaraden ska hamna på
 * samma sida som i den gamla renderaren för varje längd.
 */
export function expenseSweep(n: number): FakturaView {
  return sweep([], Array.from({ length: n }, (_, i) => expense(i)));
}

/** En faktura med `n` tidsposter i två kategorier — sidbrytningssvepet för tidsspecifikationen. */
export function timeSweep(n: number): FakturaView {
  return sweep(Array.from({ length: n }, (_, i) => timeLine(i)), [expense(0)]);
}

function sweep(timeLines: SpecTimeLine[], expenseLines: SpecExpenseLine[]): FakturaView {
  return buildFakturaView({
    invoice: invoice({ amount: 1_000_000 }), recipient: "Klient AB", meta: META,
    spec: buildInvoiceSpecification({ timeLines, expenseLines, rounding: "KRONOR", payableOre: 1_000_000, deductions: [] }),
  });
}
