/**
 * `tool-outputs` — svarskontrakt för läse-ytan, på MCP-lagret (#1012).
 *
 * Varför HÄR och inte som `.output()` på procedurerna: tRPC:s `.output()`
 * ersätter procedurens klient-typ med schemats output-typ. Ett partiellt
 * (löst) schema smalnar då av typerna i hela UI:t — provat, bröt dussintals
 * sidor — och ett exakt schema är runtime-validering i produktionens väg där
 * en enda missad nullbarhet fäller anropet för alla klienter. Sidoregistret
 * ger AI:n svarsformen utan att röra vare sig UI-typer eller produktions-
 * validering; SDK:n validerar `structuredContent` mot schemat vid anropet.
 *
 * Schemana är LÖSA (`looseObject`): de dokumenterar vad som garanterat finns,
 * inte allt som råkar finnas. `dateish` speglar att runtime-värdet är ett
 * `Date` som JSON-serialiseras till ISO-sträng.
 *
 * Scope: läse-ytan med OBJEKT-svar — vilket sedan #1014 är alla listor:
 * `invoice.list`, `task.list` och `paymentPlan.list` bär kuvertform
 * (`{ items, total }`) och kunde därmed få sina kontrakt. Deras `items` speglar
 * den PROJICERADE raden (`tool-projections.ts`), inte routerns fulla rad — det
 * är den formen modellen faktiskt får.
 */

import { z } from "zod";

/** Datum i svar: `Date` i processen, ISO-sträng efter JSON-serialisering. */
const dateish = z.union([z.date(), z.string()]);

/** Essensen av ett ärende — det som alltid finns, oavsett join-djup. */
const matterRow = z.looseObject({
  id: z.string(),
  matterNumber: z.string(),
  title: z.string(),
  status: z.string(),
  paymentMethod: z.string(),
});

const userRow = z.looseObject({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.string(),
});

/** Svarskontrakt per procedur-path. Bara objekt-svar (MCP-kravet). */
const TOOL_OUTPUTS: Readonly<Record<string, z.ZodType>> = {
  "matter.list": z.looseObject({ matters: z.array(matterRow), total: z.number() }),
  "matter.getById": matterRow,
  "timeEntry.list": z.looseObject({
    entries: z.array(z.looseObject({
      id: z.string(),
      matterId: z.string(),
      date: dateish,
      minutes: z.number(),
      description: z.string(),
      billable: z.boolean(),
    })),
    total: z.number(),
    totalMinutes: z.number(),
    pages: z.number(),
  }),
  "contacts.list": z.looseObject({
    contacts: z.array(z.looseObject({ id: z.string(), name: z.string(), contactType: z.string() })),
    total: z.number(),
    pages: z.number(),
  }),
  // Kuvertlistorna (#1014). `total` är antalet FÖRE sidningen — utan det kan
  // modellen inte skilja "tio fakturor" från "första sidan av hundra".
  "invoice.list": z.looseObject({
    items: z.array(z.looseObject({
      id: z.string(),
      invoiceNumber: z.string(),
      status: z.string(),
      amount: z.number(),
      matterId: z.string(),
    })),
    total: z.number(),
  }),
  "task.list": z.looseObject({
    items: z.array(z.looseObject({ id: z.string(), title: z.string(), status: z.string() })),
    total: z.number(),
  }),
  "paymentPlan.list": z.looseObject({
    items: z.array(z.looseObject({ id: z.string(), invoiceId: z.string(), status: z.string() })),
    total: z.number(),
  }),
  "user.current": userRow,
  "user.list": z.looseObject({ users: z.array(userRow) }),
  "reports.firmOverview": z.looseObject({
    period: z.looseObject({ from: z.string(), to: z.string() }),
    lawyers: z.array(z.looseObject({
      userId: z.string(),
      name: z.string(),
      totalMinutes: z.number(),
      billableMinutes: z.number(),
      workValueOre: z.number(),
      unbilledOre: z.number(),
      billedOre: z.number(),
      netOre: z.number(),
    })),
    totals: z.looseObject({ workValueOre: z.number(), unbilledOre: z.number(), billedOre: z.number(), netOre: z.number() }),
    ar: z.looseObject({ fakturerat: z.number(), inbetalt: z.number(), utestaende: z.number() }),
  }),
};

/** Paths med svarskontrakt — drift-/integrationstesterna läser den här. */
export function outputDescribedPaths(): readonly string[] {
  return Object.keys(TOOL_OUTPUTS);
}

/**
 * Svarskontraktet som JSON Schema, eller `null` för procedurer utan.
 * Datumfält annonseras som `{ type: "string", format: "date-time" }` — det är
 * formen `structuredContent` faktiskt bär efter JSON-serialiseringen.
 */
export function toolOutputJsonSchema(path: string): Record<string, unknown> | null {
  const schema = TOOL_OUTPUTS[path];
  if (!schema) return null;
  return z.toJSONSchema(schema, {
    io: "output",
    unrepresentable: "any",
    override: (ctx) => {
      const def = (ctx.zodSchema as { _zod?: { def?: { type?: string } } })._zod?.def;
      if (def?.type === "date") Object.assign(ctx.jsonSchema, { type: "string", format: "date-time" });
    },
  }) as Record<string, unknown>;
}
