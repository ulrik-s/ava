import { z } from "zod";
import { timeEntryKindSchema } from "./enums";

/**
 * Persisterad nedbrytningsvy på en faktura (#876/#880) — matchar `SettlementView`.
 * Tidsspec-tabell (arbetad tid) + rader (trappa) + total. Delas av slutreglering
 * OCH aconto (aconton visar det upparbetade arbetet klienten betalar för).
 *
 * `expenseLines` (#1938): utläggsrader med samma form som slutfakturans
 * utläggsspecifikation (`SpecExpenseLine`), så att en faktura vars underlag bärs
 * av nedbrytningen kan specificera sina utlägg. Valfritt: äldre fakturor saknar
 * fältet och ritas som förut.
 */
export const settlementBreakdownSchema = z.object({
  timeLines: z.array(z.object({
    date: z.string(),
    description: z.string(),
    minutes: z.number().int(),
    amountOre: z.number().int(),
    /** Arvodeskategori (#953) — sammanställningen på klientens faktura benämner
     *  raderna på den (arbete/obekväm tid/tidsspillan). Saknas på äldre fakturor. */
    kind: timeEntryKindSchema.nullish(),
  })),
  rows: z.array(z.object({
    label: z.string(),
    amountOre: z.number().int(),
    kind: z.enum(["add", "deduct", "info"]),
    /** Avräkningstabellens Underlag och Andel (#2255/#151) — bara presentation,
     *  saknas på äldre fakturor (de ritas med etiketten som förut). */
    basisOre: z.number().int().optional(),
    shareBips: z.number().int().nonnegative().optional(),
    /** `basis` = bygger underlaget, `subtotal` = mellansumma (utelämnas i tabellen). */
    role: z.enum(["basis", "subtotal"]).optional(),
  })),
  totalLabel: z.string(),
  totalOre: z.number().int(),
  expenseLines: z.array(z.object({
    date: z.string(),
    description: z.string(),
    netOre: z.number().int(),
    grossOre: z.number().int(),
    /** Äkta utlägg — vidarefakturerat utan moms (#975). */
    passThrough: z.boolean().optional(),
  })).optional(),
});
