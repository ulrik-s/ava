/**
 * Aconto-avräkning mot slutfakturans momsuppdelning (#968).
 *
 * ## Problemet
 *
 * Ett aconto är i AVA en DELFAKTURERING av redan utfört arbete — beloppet räknas
 * fram som `klientandel × upparbetat värde`. Acontofakturan bokför därför sin
 * egen intäkt, sin egen moms och sin egen kundfordran när den skickas.
 *
 * Slutfakturan drog av acontobeloppen från `amount` men lämnade `vatBreakdown`
 * orörd. Resultatet blev att acontot bokfördes TVÅ gånger — en gång på
 * acontofakturan, en gång som del av slutfakturan. På demons F-2026-0039 gav det
 * 1 910,20 kr för mycket utgående moms, 9 551,00 kr för mycket kundfordran och
 * 7 640,80 kr för mycket intäkt.
 *
 * ## Modellen (modell A, beslutad)
 *
 * Acontot är en riktig faktura. Slutfakturan får därför bara bära det som ÅTERSTÅR:
 * dess momsuppdelning minskas med exakt det acontona redan tagit, och `amount`,
 * `vatOre` och verifikatet härleds ur samma reducerade rader. Summan över
 * acontofakturorna + slutfakturan blir då precis ärendets faktiska intäkt och moms.
 *
 * ## Avräkningsordningen
 *
 * Acontot faktureras som rent arvode med 25 % moms, så det ska i första hand
 * kvittas mot arvodesraden med samma sats. Ordningen är: arvode före utlägg,
 * och inom varje grupp högsta momssats först. Ett aconto som överstiger
 * arvodesraden spiller vidare — det måste minska något, och då ligger närmaste
 * sats närmast till hands. Ordningen spelar roll: SIE-exporten bokför per sats på
 * separata momskonton (#790), så fel val skulle förskjuta momsen mellan konton.
 */

import type { VatBreakdownLine } from "@/lib/shared/accounting/semantic-voucher";
import { splitVat } from "@/lib/shared/vat";

/** Momssatsen aconton faktureras med — rent arvode (#968). */
const ACCONTO_VAT_RATE = 2500;

export interface AccontoDeductionResult {
  /** Raderna som ÅTERSTÅR att fakturera — slutfakturans `vatBreakdown`. */
  lines: VatBreakdownLine[];
  /** Netto som acontona redan fakturerat (och bokfört som intäkt). */
  deductedNetOre: number;
  /** Moms som acontona redan redovisat. */
  deductedVatOre: number;
  /** Brutto som INTE fick plats — acontona översteg fakturan → kreditering. */
  overpaidGrossOre: number;
}

/** Netto/moms i ett acontobelopp (brutto, inkl 25 % moms). */
export function accontoSplit(grossOre: number): { netOre: number; vatOre: number } {
  const { exclVat } = splitVat({ amount: grossOre, vatRate: ACCONTO_VAT_RATE, vatIncluded: true });
  return { netOre: exclVat, vatOre: grossOre - exclVat };
}

const grossOf = (l: VatBreakdownLine): number => l.netOre + l.vatOre;

/**
 * Index i den ordning raderna ska kvittas: arvode före utlägg, högsta momssats
 * först. Returnerar index så att UTDATAN kan behålla radernas ursprungliga
 * ordning (fakturan och verifikatet ska se likadana ut som förut).
 */
function deductionOrder(lines: readonly VatBreakdownLine[]): number[] {
  return lines
    .map((line, index) => ({ line, index }))
    .sort((a, b) => (a.line.kind === b.line.kind
      ? b.line.vatRate - a.line.vatRate
      : (a.line.kind === "arvode" ? -1 : 1)))
    .map((x) => x.index);
}

/** Rad med `takeGrossOre` bortdraget — momssatsen bevaras exakt. */
function shrink(line: VatBreakdownLine, takeGrossOre: number): VatBreakdownLine {
  const rest = grossOf(line) - takeGrossOre;
  const netOre = Math.round((rest * 10_000) / (10_000 + line.vatRate));
  return { ...line, netOre, vatOre: rest - netOre };
}

/**
 * Dra av ett acontobelopp (BRUTTO) ur slutfakturans momsuppdelning.
 *
 * Rader som går till noll faller bort — de har inget kvar att fakturera och
 * skulle bara bli tomma rader i verifikatet.
 */
export function deductAcconto(
  lines: readonly VatBreakdownLine[],
  deductionGrossOre: number,
): AccontoDeductionResult {
  const out = [...lines];
  let remaining = Math.max(0, deductionGrossOre);

  for (const i of deductionOrder(lines)) {
    if (remaining <= 0) break;
    const line = out[i];
    if (!line) continue;
    const take = Math.min(remaining, grossOf(line));
    out[i] = shrink(line, take);
    remaining -= take;
  }

  const kept = out.filter((l) => grossOf(l) > 0);
  return {
    lines: kept,
    deductedNetOre: sumNet(lines) - sumNet(kept),
    deductedVatOre: sumVat(lines) - sumVat(kept),
    overpaidGrossOre: remaining,
  };
}

const sumNet = (ls: readonly VatBreakdownLine[]): number => ls.reduce((s, l) => s + l.netOre, 0);
const sumVat = (ls: readonly VatBreakdownLine[]): number => ls.reduce((s, l) => s + l.vatOre, 0);

/**
 * Kreditfakturans netto/moms när acontona ÖVERSTEG klientens slutliga andel.
 *
 * Krediteringen ska vända exakt det som blev för mycket bokfört: acontonas
 * intäkt och moms minus fakturans faktiska. Att i stället räkna 25 % på
 * mellanskillnaden (som förr) blir fel så snart fakturan bär utlägg med andra
 * satser, eftersom acontot alltid är 25 %.
 */
export function accontoCreditAmounts(
  lines: readonly VatBreakdownLine[],
  deductionGrossOre: number,
): { netOre: number; vatOre: number } {
  const acconto = accontoSplit(deductionGrossOre);
  return { netOre: acconto.netOre - sumNet(lines), vatOre: acconto.vatOre - sumVat(lines) };
}

/**
 * Kreditfakturans momsuppdelning (#977) — med TECKEN, så verifikatet kan bokföra
 * varje konto för sig.
 *
 * Krediteringen är skillnaden mellan två dokumentuppsättningar: acontona (som
 * bokförde arvode + 25 % moms) och slutfakturans rader (som är vad klienten
 * faktiskt skulle ha betalat). Uppdelningen är därför slutfakturans rader
 * PLUS acontot med omvänt tecken.
 *
 * Poängen är att posterna kan gå åt OLIKA håll samtidigt: arvodesintäkten ska
 * minska (acontot vänds) medan utläggsintäkten ska öka (utlägget fanns inte i
 * acontot). Ett enda nettobelopp kan inte uttrycka det, och den gamla vägen
 * klumpade därför hela intäktsvändningen på arvodeskontot.
 */
export function accontoCreditLines(
  lines: readonly VatBreakdownLine[],
  deductionGrossOre: number,
): VatBreakdownLine[] {
  const { netOre, vatOre } = accontoSplit(deductionGrossOre);
  return [
    ...lines,
    { kind: "arvode", vatRate: ACCONTO_VAT_RATE, netOre: -netOre, vatOre: -vatOre },
  ];
}
