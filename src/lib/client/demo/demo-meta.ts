/**
 * `loadDemoMeta` — hämtar `.ava/meta.json` från demo-builden så att
 * web-appen vet vilken organisation + vilka users som finns utan att
 * hårdkoda identifierare. Anropas av:
 *   - `/login` (lista users)
 *   - `demo-bootstrap` (validera principalId mot user-listan)
 *
 * Cachas i minne efter första hämtningen (samma data hela sessionen).
 */
import { DEMO_META_PATH } from "../../../../tooling/demo-config";
import { resolveGhPagesUrl } from "../../server/local-first/gh-pages-loader";

export interface DemoMetaUser {
  /** UUID — principalId som /login sparar i firma-config. */
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "LAWYER" | "ASSISTANT";
  title?: string;
}

export interface DemoMeta {
  /** UUID på orgen. */
  organizationId: string;
  organizationName: string;
  users: DemoMetaUser[];
  buildAt: string;
}

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

  const res = await fetchFn(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(
      `Kunde inte hämta demo-meta från ${url}: HTTP ${res.status}. ` +
      `Är meta.json genererad av build-demo-repo?`,
    );
  }
  const json = await res.json() as unknown;
  const meta = validate(json, url);
  cache = { url, data: meta };
  return meta;
}

/** Bara för tester. */
export function _resetDemoMetaCache(): void { cache = null; }

function requireString(value: unknown, errorMsg: string): string {
  if (typeof value !== "string" || !value) throw new Error(errorMsg);
  return value;
}

function asObject(value: unknown, errorMsg: string): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new Error(errorMsg);
  return value as Record<string, unknown>;
}

function validate(json: unknown, url: string): DemoMeta {
  const o = asObject(json, `meta.json från ${url} är inte ett objekt`);
  if (!Array.isArray(o.users) || o.users.length === 0) {
    throw new Error(`meta.json från ${url} saknar users`);
  }
  return {
    organizationId: requireString(o.organizationId, `meta.json från ${url} saknar organizationId`),
    organizationName: requireString(o.organizationName, `meta.json från ${url} saknar organizationName`),
    users: o.users.map((u, i) => validateUser(u, url, i)),
    buildAt: typeof o.buildAt === "string" ? o.buildAt : "",
  };
}

function validateUser(raw: unknown, url: string, idx: number): DemoMetaUser {
  const u = asObject(raw, `meta.json från ${url}: users[${idx}] är inte objekt`);
  if (typeof u.name !== "string" || typeof u.role !== "string") {
    throw new Error(`meta.json från ${url}: users[${idx}] saknar name/role`);
  }
  return {
    id: requireString(u.id, `meta.json från ${url}: users[${idx}] saknar id`),
    name: u.name,
    email: typeof u.email === "string" ? u.email : "",
    role: u.role as "ADMIN" | "LAWYER" | "ASSISTANT",
    title: typeof u.title === "string" ? u.title : undefined,
  };
}
