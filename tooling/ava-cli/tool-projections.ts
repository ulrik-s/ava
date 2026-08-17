/**
 * `tool-projections` — smala listrader för MCP-ytan (#1014).
 *
 * ## Varför bara här
 *
 * Listraderna är join-tunga för att UI:t behöver dem så: fakturalistan visar
 * ärendets titel, planens status och betalningarna utan ett andra anrop. För
 * en modell är samma join ren kostnad — en fakturarad på 2 292 tecken bestod
 * till 74 % av två inbäddade objekt (`creditedInvoice` 1 086, `matter` 608),
 * medan fakturans egna fält rymdes på ~600.
 *
 * Projektionen ligger därför på MCP-lagret och INTE i routern: UI:t behåller
 * sina fält, AI:n får en rad den kan lista hundra av. Detaljerna hämtas med
 * `getById`, som verktygsbeskrivningen påminner om.
 *
 * ## Varför en tillåtlista och inte en blocklista
 *
 * En blocklista ("ta bort `matter`, `creditedInvoice`, …") släpper igenom
 * varje nytt join-fält som läggs till i routern, och budget-regressionen
 * märks först när någon råkar mäta. Tillåtlistan gör det omvända felet: ett
 * nytt fält syns inte för modellen förrän någon lägger till det här — vilket
 * upptäcks direkt, av den som saknar fältet.
 */

/** Var raderna bor i svaret + vilka fält som behålls. */
export interface ListProjection {
  /** Kuvertets array-nyckel: `items` sedan #1014, domännamn i de äldre. */
  key: string;
  /** Fält som behålls per rad. Övriga hämtas via `getById`. */
  fields: readonly string[];
}

/**
 * Projicerade listverktyg. Fältlistorna måste rymma det svarskontraktet i
 * `tool-outputs.ts` utlovar — kontraktet valideras mot `structuredContent`,
 * så ett bortprojicerat kontraktsfält fäller anropet.
 *
 * `contacts.list` står medvetet utanför: dess rader är redan smala (id, namn,
 * typ) och varje projektion är ett åtagande att hålla tillåtlistan aktuell.
 */
const LIST_PROJECTIONS: Readonly<Record<string, ListProjection>> = {
  "invoice.list": {
    key: "items",
    fields: ["id", "invoiceNumber", "invoiceType", "status", "amount", "vatOre",
      "matterId", "issuedAt", "dueAt", "paidAt", "ocrReference"],
  },
  "task.list": {
    key: "items",
    fields: ["id", "title", "status", "priority", "dueAt", "matterId", "assignedToId"],
  },
  "paymentPlan.list": {
    key: "items",
    fields: ["id", "invoiceId", "status", "monthlyAmount", "dayOfMonth", "startDate", "notes"],
  },
  // De två äldre kuvertlistorna bär sina rader under domännamn. `contacts`
  // (1 103 tecken/rad) resp. `matter` + `user` (849) dominerade dem helt.
  "matter.list": {
    key: "matters",
    fields: ["id", "matterNumber", "title", "status", "paymentMethod", "matterType",
      "isTaxeArende", "createdAt"],
  },
  "timeEntry.list": {
    key: "entries",
    fields: ["id", "matterId", "userId", "date", "minutes", "description",
      "billable", "hourlyRate", "kind", "invoiceId"],
  },
  "expense.list": {
    key: "expenses",
    fields: ["id", "matterId", "userId", "date", "description", "amount",
      "billable", "vatRate", "vatIncluded", "kind", "invoiceId"],
  },
};

/** Paths med projektion — integrationstesterna läser den här. */
export function projectedPaths(): readonly string[] {
  return Object.keys(LIST_PROJECTIONS);
}

/** Projektionen för ett listverktyg, eller null om ingen finns. */
export function projectionFor(path: string): ListProjection | null {
  return LIST_PROJECTIONS[path] ?? null;
}

/** Behåll de vitlistade nycklarna. Saknade fält utelämnas (inte null:as) —
 *  `undefined` försvinner ändå i JSON, och en null-rad ljuger om innehåll. */
function pickFields(row: unknown, fields: readonly string[]): unknown {
  if (row === null || typeof row !== "object" || Array.isArray(row)) return row;
  const src = row as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of fields) if (f in src) out[f] = src[f];
  return out;
}

/**
 * Projicera ett listverktygs kuvert-svar. Okända paths, och svar där nyckeln
 * inte bär en array, passerar orörda — så funktionen kan läggas i varje
 * verktygsväg utan att förändra något annat.
 */
export function projectToolResult(path: string, data: unknown): unknown {
  const projection = projectionFor(path);
  if (projection === null || data === null || typeof data !== "object") return data;
  const env = data as Record<string, unknown>;
  const rows = env[projection.key];
  if (!Array.isArray(rows)) return data;
  return { ...env, [projection.key]: rows.map((row) => pickFields(row, projection.fields)) };
}
