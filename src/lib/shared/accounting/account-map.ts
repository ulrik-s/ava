/**
 * Konto-mappning per byrå (#249, ADR 0011-uppföljning).
 *
 * Vendor-neutral roll→konto-mappning som org-inställning: vilka BAS-konton
 * (nummer + namn) + verifikatserie en byrå bokför sina semantiska verifikat
 * ([[semantic-voucher]]) mot. Används av SIE-exporten ([[sie-from-invoices]]);
 * samma modell kan senare driva Fortnox-mappningen (#217). Strikt zod.
 */

import { z } from "zod";
import type { SieAccountMap } from "./sie";

/** Ett bokföringskonto: BAS-nummer (4–6 siffror) + namn (för SIE #KONTO). */
export const ledgerAccountSchema = z.object({
  number: z.string().regex(/^\d{4,6}$/, "Kontonummer ska vara 4–6 siffror"),
  name: z.string().min(1),
});
export type LedgerAccount = z.infer<typeof ledgerAccountSchema>;

/**
 * Roll→konto + verifikatserie. `intaktUtlagg` är valfritt (bara byråer som
 * vidarefakturerar utlägg behöver det). Övriga roller är obligatoriska — utan
 * dem kan ett verifikat inte balanseras (completeness-gate i renderaren).
 */
export const ledgerAccountMapSchema = z.object({
  voucherSeries: z.string().min(1),
  kundfordran: ledgerAccountSchema,
  intaktArvode: ledgerAccountSchema,
  momsUtgaende: ledgerAccountSchema,
  intaktUtlagg: ledgerAccountSchema.optional(),
});
export type LedgerAccountMap = z.infer<typeof ledgerAccountMapSchema>;

/** BAS-standard för en advokatbyrå (default tills byrån redigerar själv). */
export const DEFAULT_LEDGER_ACCOUNT_MAP: LedgerAccountMap = {
  voucherSeries: "A",
  kundfordran: { number: "1510", name: "Kundfordringar" },
  intaktArvode: { number: "3041", name: "Advokatarvoden" },
  momsUtgaende: { number: "2611", name: "Utgående moms 25 %" },
  intaktUtlagg: { number: "3590", name: "Övriga sidointäkter" },
};

/** Plocka ut roll→konto-delen (utan serie) som SIE-renderarens `SieAccountMap`. */
export function toSieAccountMap(map: LedgerAccountMap): SieAccountMap {
  return {
    kundfordran: map.kundfordran,
    intaktArvode: map.intaktArvode,
    momsUtgaende: map.momsUtgaende,
    ...(map.intaktUtlagg ? { intaktUtlagg: map.intaktUtlagg } : {}),
  };
}
