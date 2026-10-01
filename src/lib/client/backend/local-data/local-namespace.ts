/**
 * Lokala databaser per användare och byrå (#1347, advokatsekretess).
 *
 * Allt klienten sparar om byråns data i webbläsaren (cachen, kön, avvisade
 * ändringar, dokumentbytes, dokumenttext …) ligger i IndexedDB-databaser vars
 * namn bär användarens och byråns id: `ava-local-store@<byrå>:<användare>`.
 * Två användare i samma webbläsarprofil delar då aldrig en databas, och A:s
 * osynkade kö kan inte spelas upp som B.
 *
 * Vilken namnrymd som gäller binds en gång per sidladdning, i bootstrappen:
 *   - `user`   — self-hosted: den inloggade användarens egna databaser.
 *   - `shared` — demon: de gamla, gemensamma namnen (påhittad, publik data;
 *                demoanvändarna delar medvetet samma byrå-data).
 * Innan något är bundet kastar `localDbName` — hellre ett fel än att skriva
 * en användares data under ett namn en annan användare kan läsa.
 */

import { z } from "zod";
import { organizationIdSchema, userIdSchema } from "@/lib/shared/schemas/ids";

/**
 * Inventariet (#1347): basnamnen på de IndexedDB-databaser som håller byråns
 * data. En ny lokal databas med byråns data MÅSTE läggas till här — annars
 * scopas den inte och rensas inte vid utloggning.
 */
export const LOCAL_DB = {
  /** Cachen av byråns data (hela source-snapshotet). */
  localStore: "ava-local-store",
  /** Osynkade ändringar (radkön + procedur-anropen). */
  mutationQueue: "ava-mutation-queue",
  /** Ändringar servern avvisade, som väntar på att användaren tar ställning. */
  rejectedChanges: "ava-rejected-changes",
  /** Dokumentbytes (läs-cache) + dokument som väntar på uppladdning. */
  docContent: "ava-doc-content",
  /** Dokumenttext för den lokala sökningen. */
  docText: "ava-doc-text",
  /** Lokalt genererade dokument (räddningskopior tills de laddats upp). */
  generatedDocs: "ava-generated-docs",
  /** Fakturadokument som väntar på serverns fakturanummer. */
  deferredFakturaDocs: "ava-deferred-faktura-docs",
} as const;

/** Basnamnet på en lokal databas med byråns data. */
export type LocalDbBase = (typeof LOCAL_DB)[keyof typeof LOCAL_DB];

/** Vems lokala data: en användare i en byrå. */
export const localScopeSchema = z.object({
  organizationId: organizationIdSchema,
  principalId: userIdSchema,
}).strict();

/** Vems lokala data: en användare i en byrå. */
export type LocalScope = z.infer<typeof localScopeSchema>;

/** Namnrymden databaserna öppnas i. */
export type LocalNamespace =
  | { kind: "shared" }
  | { kind: "user"; scope: LocalScope };

/** Demons namnrymd: de gamla, gemensamma namnen. */
export const SHARED_NAMESPACE: LocalNamespace = Object.freeze({ kind: "shared" });

/** Namnrymden för en användare i en byrå. */
export function userNamespace(scope: LocalScope): LocalNamespace {
  return { kind: "user", scope };
}

/** Nyckeln som skiljer en användares databaser från andras. */
export function scopeKey(scope: LocalScope): string {
  return `${scope.organizationId}:${scope.principalId}`;
}

/** Är det samma användare i samma byrå? */
export function sameScope(a: LocalScope, b: LocalScope): boolean {
  return a.organizationId === b.organizationId && a.principalId === b.principalId;
}

/** Databasens namn i namnrymden. */
export function dbNameIn(ns: LocalNamespace, base: LocalDbBase): string {
  return ns.kind === "shared" ? base : `${base}@${scopeKey(ns.scope)}`;
}

/** En lokal databas öppnades innan bootstrappen bundit en namnrymd. */
export class LocalNamespaceUnboundError extends Error {
  constructor() {
    super("Lokala databaser kan inte öppnas innan inloggningen avgjort vems de är.");
    this.name = "LocalNamespaceUnboundError";
  }
}

// ponytail: en modul-global — en sidladdning arbetar som exakt en användare.
let active: LocalNamespace | null = null;

/** Bind namnrymden för den här sidladdningen (bootstrappen). */
export function bindLocalNamespace(ns: LocalNamespace): void {
  active = ns;
}

/** Släpp bindningen (utloggning, tester). */
export function unbindLocalNamespace(): void {
  active = null;
}

/** Den bundna namnrymden; kastar om ingen är bunden. */
export function activeLocalNamespace(): LocalNamespace {
  if (!active) throw new LocalNamespaceUnboundError();
  return active;
}

/** Den bundna användaren, eller null (demon / obundet). */
export function activeLocalScope(): LocalScope | null {
  return active?.kind === "user" ? active.scope : null;
}

/** Databasens namn i den bundna namnrymden. */
export function localDbName(base: LocalDbBase): string {
  return dbNameIn(activeLocalNamespace(), base);
}
