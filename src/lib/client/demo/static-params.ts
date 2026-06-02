/**
 * `demoStaticParams` — generateStaticParams för demo-builden.
 *
 * Next 16 + `output: "export"` kräver att alla dynamic-route-params
 * enumereras vid build-tid; client-side navigation till okända params
 * fungerar inte (det är skillnaden mot full-server-builds). Därför
 * pre-renderar vi 1 HTML per seed-id PLUS en sentinel-shell.
 *
 * Sentinel-shellen (`/<route>/__shell__/`) används både för:
 *   - self-hosted (nginx try_files-fallback för nya entity-id:n)
 *   - GH Pages demo (404.html redirectar nya id:n hit + #orig=<path>)
 *
 * Datan kommer in-process från `buildSeed()` — single source of truth
 * delad med seed-skrivnings-stegen.
 */

import {
  DEMO_ORG_ID,
  DEMO_CURRENT_USER_ID,
  DEMO_EMAIL_DOMAIN,
  DEMO_ORG_NAME,
} from "../../../../tooling/demo-config";

export const SHELL_PARAM = "__shell__";

export async function demoStaticParams(pathPrefix: string): Promise<{ id: string }[]> {
  if (process.env.DEMO_BUILD !== "1") return [];
  // invoices/payment-plans skapas av demo-generatorn via API:t med store-
  // genererade id:n som INTE matchar buildSeed/billing-id-prediktionen (drev
  // isär → döda "kunde inte ladda"-rutter + oprerenderade riktiga id:n).
  // __shell__-shimmen (404.html → /<route>/__shell__/#orig=<path> → useRouteId
  // → getById) renderar VILKET id som helst client-side, så per-id-prerendering
  // är onödig — och skadlig — här. Pre-rendera bara sentinellen.
  if (pathPrefix === "invoices" || pathPrefix === "payment-plans") {
    return [{ id: SHELL_PARAM }];
  }
  const ids = await collectDemoIds(pathPrefix);
  return [...ids, SHELL_PARAM].map((id) => ({ id }));
}

export async function collectDemoIds(pathPrefix: string): Promise<string[]> {
  try {
    const { buildSeed, seedToFiles } = await import("../../../../tooling/scripts/seed-data");
    const { createIdTranslator, translateSeed } = await import("../../../../tooling/demo-generator/id-translator");
    // Måste matcha generateInto:s translation så static-params:n pekar på de
    // UUID:n som faktiskt persisteras i datat.
    const translator = createIdTranslator();
    const seed = translateSeed(buildSeed({
      orgId: DEMO_ORG_ID,
      currentUserId: DEMO_CURRENT_USER_ID,
      emailDomain: DEMO_EMAIL_DOMAIN,
      organizationName: DEMO_ORG_NAME,
    }), translator);
    const files = seedToFiles(seed);
    const prefix = pathPrefix.replace(/\/+$/, "") + "/";
    const seedIds = files
      .map((f) => f.path)
      .filter((p: string) => p.startsWith(prefix) && p.endsWith(".json"))
      .map((p: string) => p.slice(prefix.length, -".json".length));

    // Demo-generatorn skapar billing-rader (invoices, payment-plans) med
    // deterministiska id:n (1 per ärende). Lägg till dem som pre-renderbara
    // params så /invoices/<id> + /payment-plans/<id> inte 404:ar.
    if (pathPrefix === "invoices" || pathPrefix === "payment-plans") {
      const ids = await collectBillingIds(pathPrefix, seed.matters as Array<{ id?: unknown }>);
      return [...seedIds, ...ids];
    }
    return seedIds;
  } catch {
    return [];
  }
}

async function collectBillingIds(prefix: string, matters: Array<{ id?: unknown }>): Promise<string[]> {
  const mod = await import("../../../../tooling/scripts/demo-billing-ids");
  return prefix === "invoices" ? mod.allDemoBillingInvoiceIds(matters) : mod.allDemoBillingPlanIds(matters);
}

/**
 * `demoStaticParamsBySeedId` — för entiteter där FILNAMNET skiljer sig
 * från route-id:t. Users lagras som `.ava/users/<email>.json` men UI
 * länkar till `/users/<user.id>` (t.ex. u-anna) → collectDemoIds (som
 * läser filnamn) skulle ge fel värden. Här läser vi seed-objektens
 * `.id`-fält direkt.
 */
export async function demoStaticParamsBySeedId(sourceKey: string): Promise<{ id: string }[]> {
  if (process.env.DEMO_BUILD !== "1") return [];
  try {
    const { buildSeed } = await import("../../../../tooling/scripts/seed-data");
    const { createIdTranslator, translateSeed } = await import("../../../../tooling/demo-generator/id-translator");
    const seed = translateSeed(buildSeed({
      orgId: DEMO_ORG_ID,
      currentUserId: DEMO_CURRENT_USER_ID,
      emailDomain: DEMO_EMAIL_DOMAIN,
      organizationName: DEMO_ORG_NAME,
    }), createIdTranslator()) as unknown as Record<string, Array<{ id?: string }>>;
    const list = seed[sourceKey] ?? [];
    const ids = list.map((x) => x.id).filter((x): x is string => typeof x === "string");
    return [...ids, SHELL_PARAM].map((id) => ({ id }));
  } catch {
    return [{ id: SHELL_PARAM }];
  }
}
