/**
 * `writeDemoMeta(outDir, seed)` — skriver `out/.ava/meta.json` som
 * web-appen läser vid bootstrap (istället för att hårdkoda `u-anna` etc.).
 *
 * Schema:
 * ```
 * {
 *   organizationId, organizationName,
 *   users: [{ id, name, email, role, title }, ...],
 *   buildAt
 * }
 * ```
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CURRENT_SCHEMA_VERSION } from "../../src/lib/shared/schema-version";
import { DEMO_META_PATH } from "../demo-config";
import type { IdTranslator } from "../demo-generator/id-translator";

export interface DemoMetaUser {
  /** UUID — det `principalId` som /login sparar i firma-config. */
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "LAWYER" | "ASSISTANT";
  title?: string;
}

export interface DemoMeta {
  /** Datamodellens version (ADR 0004) — versionsgrinden vid hydrering läser den. */
  schemaVersion: number;
  /** UUID på orgen — matchar det som persisteras i datat. */
  organizationId: string;
  organizationName: string;
  users: DemoMetaUser[];
  buildAt: string;
}

interface SeedShape {
  organizations: Array<Record<string, unknown>>;
  users: Array<Record<string, unknown>>;
}

/**
 * @param seed Source-seed (FÖRE id-translation). Vi översätter till UUID
 *   lokalt via translator:n så meta.json matchar persisted data.
 */
export function buildDemoMeta(seed: SeedShape, translator: IdTranslator, now: Date = new Date()): DemoMeta {
  const org = seed.organizations[0];
  if (!org) throw new Error("Seed saknar organization — kan inte bygga meta.json");
  const orgRawId = String(org.id ?? "");
  const orgName = String(org.name ?? "");
  if (!orgRawId || !orgName) throw new Error("Organization saknar id eller name");

  const users: DemoMetaUser[] = seed.users.map((u) => ({
    id: translator.toUuid(String(u.id ?? "")),
    name: String(u.name ?? ""),
    email: String(u.email ?? ""),
    role: u.role as "ADMIN" | "LAWYER" | "ASSISTANT",
    ...(u.title ? { title: String(u.title) } : {}),
  }));
  if (users.some((u) => !u.id || !u.name || !u.role)) {
    throw new Error("User-rad saknar id/name/role");
  }

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    organizationId: translator.toUuid(orgRawId),
    organizationName: orgName,
    users,
    buildAt: now.toISOString(),
  };
}

export function writeDemoMeta(outDir: string, seed: SeedShape, translator: IdTranslator, now: Date = new Date()): string {
  const meta = buildDemoMeta(seed, translator, now);
  const fullPath = resolve(outDir, DEMO_META_PATH);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, JSON.stringify(meta, null, 2), "utf8");
  return fullPath;
}
