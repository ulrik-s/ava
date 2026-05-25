/**
 * `vat.ts` — pure helpers för moms-uppdelning av belopp i öre.
 *
 * Vi använder **basis points** (1 bps = 0.01 %) för moms-satsen så vi
 * slipper floats helt:
 *   - 0    →  0 % (momsfritt — t.ex. domstolsavgifter, vissa hyresavgifter)
 *   - 600  →  6 % (böcker, tidningar, persontransporter, viss kultur)
 *   - 1200 → 12 % (restaurang, livsmedel, hotell)
 *   - 2500 → 25 % (default för advokattjänster och de flesta utlägg)
 *
 * Alla belopp är i ÖRE (heltal). Rundning sker vid uppdelning och är
 * deterministisk (Math.round). Eventuell skillnad mot källan ligger
 * på maximalt 1 öre.
 */

export const VAT_RATES = [0, 600, 1200, 2500] as const;
export type VatRate = (typeof VAT_RATES)[number];

export const DEFAULT_VAT_RATE: VatRate = 2500;

export const VAT_RATE_LABELS: Record<VatRate, string> = {
  0: "0 % (momsfritt)",
  600: "6 %",
  1200: "12 %",
  2500: "25 %",
};

export interface VatSplit {
  /** Belopp exklusive moms (öre). */
  exclVat: number;
  /** Momsbeloppet i öre. */
  vat: number;
  /** Belopp inklusive moms (öre). */
  inclVat: number;
}

export interface SplitInput {
  /** Beloppet i öre. Är inkl moms om `vatIncluded=true`, annars exkl. */
  amount: number;
  /** Moms-sats i basis points (0/600/1200/2500). */
  vatRate: number;
  /** True om `amount` redan innehåller moms (kvitto-fall — vanligast). */
  vatIncluded: boolean;
}

/**
 * Dela upp ett belopp i exkl/moms/inkl. Båda riktningarna stöds:
 *   - `vatIncluded=true`: amount = inkl moms → räkna ut exkl
 *   - `vatIncluded=false`: amount = exkl moms → räkna ut inkl
 *
 * 0 % moms → exkl = inkl = amount, vat = 0.
 *
 * Heltals-rundning är deterministisk och momsbeloppet beräknas som
 * skillnaden mellan inkl och exkl så summan stämmer per öre.
 */
export function splitVat({ amount, vatRate, vatIncluded }: SplitInput): VatSplit {
  if (vatRate === 0) return { exclVat: amount, vat: 0, inclVat: amount };
  if (vatIncluded) {
    const exclVat = Math.round((amount * 10000) / (10000 + vatRate));
    return { exclVat, vat: amount - exclVat, inclVat: amount };
  }
  const inclVat = amount + Math.round((amount * vatRate) / 10000);
  return { exclVat: amount, vat: inclVat - amount, inclVat };
}

/** True om värdet är en av de tillåtna satserna. */
export function isVatRate(v: unknown): v is VatRate {
  return typeof v === "number" && (VAT_RATES as readonly number[]).includes(v);
}
