/**
 * `loadDemoMeta` — hämtar `.ava/meta.json` från demo-builden så att
 * web-appen vet vilken organisation + vilka users som finns utan att
 * hårdkoda identifierare. Anropas av:
 *   - `/login` (lista users)
 *   - `demo-bootstrap` (validera principalId mot user-listan)
 *
 * Cachas i minne efter första hämtningen (samma data hela sessionen).
 */
import { z } from "zod";

import { DEMO_META_PATH } from "../../../../tooling/demo-config";
import { resolveGhPagesUrl } from "@/lib/shared/gh-pages-url";
import { assertRepoSchemaCompatible } from "@/lib/shared/schema-version";

// Zod vid parsegränsen (#187): meta.json är extern nätverksdata — valideras
// strikt här i stället för handrullade typeof-helpers. Felmeddelandena är
// del av kontraktet ("saknar X" pekar byggaren rätt).
export const demoMetaUserSchema = z.object({
  /** UUID — principalId som /login sparar i firma-config. */
  id: z.string({ message: "saknar id" }).min(1, "saknar id"),
  name: z.string({ message: "saknar name" }).min(1, "saknar name"),
  email: z.string().default(""),
  role: z.enum(["ADMIN", "LAWYER", "ASSISTANT"]),
  title: z.string().optional(),
});

export const demoMetaSchema = z.object({
  /** Datamodellens version (ADR 0004). Saknas/ogiltig i repon byggda före
   *  grinden → undefined = v1-baslinje (samma tolerans som parseSchemaVersion). */
  schemaVersion: z.number().int().positive().optional().catch(undefined),
  /** UUID på orgen. */
  organizationId: z.string({ message: "saknar organizationId" }).min(1, "saknar organizationId"),
  organizationName: z.string({ message: "saknar organizationName" }).min(1, "saknar organizationName"),
  users: z.array(demoMetaUserSchema).min(1, "saknar users"),
  buildAt: z.string().default(""),
});

export type DemoMetaUser = z.infer<typeof demoMetaUserSchema>;
export type DemoMeta = z.infer<typeof demoMetaSchema>;

let cache: { url: string; data: DemoMeta } | null = null;

/** Bygg URL till meta.json från firma-config:s repo (samma origin som datan). */
export function demoMetaUrl(repo: string): string {
  const base = resolveGhPagesUrl(repo).replace(/\/+$/, "");
  return `${base}/${DEMO_META_PATH}`;
}

export async function loadDemoMeta(
  repo: string,
  fetchFn: typeof fetch = fetch,
): Promise<DemoMeta> {
  const url = demoMetaUrl(repo);
  if (cache && cache.url === url) return cache.data;

  // `cache: "no-store"` — samma skäl som i gh-pages-loader: kringgå
  // browserns HTTP-cache så att "Återställ demo" / ny deploy ger färsk
  // meta.json (annars kan stale user-/org-lista överleva en reset).
  const res = await fetchFn(url, { method: "GET", cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      `Kunde inte hämta demo-meta från ${url}: HTTP ${res.status}. ` +
      `Är meta.json genererad av build-demo-repo?`,
    );
  }
  const json: unknown = await res.json();
  const parsed = demoMetaSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
      .join("; ");
    throw new Error(`meta.json från ${url} ogiltig: ${issues}`);
  }
  const meta = parsed.data;
  // Versionsgrind (ADR 0004): vägra ett repo som är nyare än koden förstår,
  // INNAN user-/org-data används. Saknad version → baslinje (v1) → OK.
  assertRepoSchemaCompatible(meta.schemaVersion);
  cache = { url, data: meta };
  return meta;
}

/** Bara för tester. */
export function _resetDemoMetaCache(): void { cache = null; }
