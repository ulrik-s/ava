/**
 * Lokala databaser per användare (#1347) — mot riktig IndexedDB (fake-indexeddb):
 *
 *   - migrering: de gemensamma databaserna från före #1347 flyttas in hos sin
 *     ägare — idempotent, utan att en köad ändring försvinner, och utan att de
 *     gamla databaserna uppgraderas;
 *   - en annan användare tar aldrig över dem (bara cache-kopiorna tas bort);
 *   - byte av användare: den förras cache rensas, hennes osynkade arbete ligger kvar;
 *   - utloggningens rensning och raderingar som görs om vid nästa start.
 */
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest-compat";
import { DocumentContentCache } from "@/lib/client/backend/content-cache";
import { IndexedDbListStore } from "@/lib/client/backend/idb-list-store";
import { LEGACY_OWNER_KEY } from "@/lib/client/backend/local-data/legacy-owner";
import { queueLocation, rejectedLocation, type LocalDataPlace } from "@/lib/client/backend/local-data/local-data-locations";
import { boundEmail, boundScope, openLocalDataSession, workingScope } from "@/lib/client/backend/local-data/local-data-session";
import {
  activeLocalScope, bindLocalNamespace, dbNameIn, LOCAL_DB, localScopeSchema, SHARED_NAMESPACE, userNamespace,
} from "@/lib/client/backend/local-data/local-namespace";
import { PENDING_PURGE_KEY, purgeLocalData, resumePendingPurge } from "@/lib/client/backend/local-data/purge-local-data";
import { LocalDocumentTextStore } from "@/lib/client/backend/local-document-text";
import { IndexedDbRejectedChangesPersistence } from "@/lib/client/backend/rejected-changes";
import { IdbKv } from "@/lib/server/data-store/in-memory/idb-kv";
import { IndexedDbPersistence } from "@/lib/server/data-store/in-memory/indexeddb-persistence";
import { IndexedDbMutationQueuePersistence, type QueuedMutation } from "@/lib/server/data-store/in-memory/mutation-queue";
import { asId } from "@/lib/shared/schemas/ids";

const ORG = "org-1";
const anna = localScopeSchema.parse({ organizationId: ORG, principalId: "u-anna" });
const bo = localScopeSchema.parse({ organizationId: ORG, principalId: "u-bo" });
const annaCfg = { organizationId: ORG, principalId: "u-anna", authorEmail: "anna@byra.se" };
const boCfg = { organizationId: ORG, principalId: "u-bo", authorEmail: "bo@byra.se" };

const entry = (mutationId: string): QueuedMutation =>
  ({ mutationId, entity: "contact", kind: "create", row: { id: `c-${mutationId}` }, enqueuedAt: 1 });

let factory: IDBFactory;
const env = () => ({ factory, storage: localStorage, timeoutMs: 200 });
const names = async (): Promise<string[]> => (await factory.databases()).map((d) => d.name ?? "").sort();
const queueIds = async (place: LocalDataPlace): Promise<string[]> =>
  (await new IndexedDbMutationQueuePersistence(factory, queueLocation(place)).load()).map((e) => e.mutationId);

/** Webbläsaren som den såg ut före #1347: gemensamma databaser med Annas data. */
async function seedLegacy(): Promise<void> {
  await new IdbKv(factory, "ava-mutation-queue", "queue").put("pending", [entry("old-1")]); // före #1346
  await new IndexedDbMutationQueuePersistence(factory, "ava-mutation-queue").add(entry("v2-1")); // #1346
  await new IndexedDbRejectedChangesPersistence(factory, "ava-rejected-changes")
    .add({ id: "r1", rejectedAt: 1, label: "Ny kontakt", reason: "nej", entry: entry("r1") });
  await new IndexedDbPersistence(factory, "ava-local-store").save({ contacts: [{ id: "c1", name: "Klient" }] } as never);
  const content = new DocumentContentCache(factory, "ava-doc-content");
  await content.cache(asId<"DocumentId">("d-pending"), "sha-p", new Uint8Array([1]));
  await content.putBytes("sha-read", new Uint8Array([2]));
  await new LocalDocumentTextStore(factory, { dbName: "ava-doc-text" }).put("d1", "stämningsansökan");
  await new IndexedDbListStore("ava-deferred-faktura-docs", factory).save([{ invoiceId: "i1" }]);
}

beforeEach(() => {
  factory = new IDBFactory();
  localStorage.clear();
});
afterEach(() => { bindLocalNamespace(SHARED_NAMESPACE); });

describe("boundScope / workingScope", () => {
  it("bunden principal → hennes scope; utan principal → null resp. den obundna principalen", () => {
    expect(boundScope(annaCfg)).toEqual(anna);
    expect(boundScope({ ...annaCfg, principalId: "" })).toBeNull();
    expect(boundScope({ ...annaCfg, organizationId: "" })).toBeNull();
    expect(workingScope({ organizationId: ORG, authorEmail: "" })).toEqual({ organizationId: ORG, principalId: "current-user" });
  });

  it("den bundnas e-post (#1404) — null när ingen är bunden", () => {
    expect(boundEmail(annaCfg)).toBe("anna@byra.se");
    expect(boundEmail({ ...annaCfg, principalId: "" })).toBeNull();
  });
});

describe("migrering — ägaren tar över de gemensamma databaserna", () => {
  it("allt flyttas in hos Anna, kön post för post, och de gamla databaserna töms", async () => {
    await seedLegacy();
    const place = await openLocalDataSession(env(), annaCfg, { binding: false });
    expect(place).toEqual({ factory, ns: userNamespace(anna), adoptsLegacy: true });
    expect(activeLocalScope()).toEqual(anna);
    if (!place) throw new Error("ingen plats");

    expect((await queueIds(place)).sort()).toEqual(["old-1", "v2-1"]);
    expect((await new IndexedDbRejectedChangesPersistence(factory, rejectedLocation(place)).load()).map((r) => r.id)).toEqual(["r1"]);
    const ns = userNamespace(anna);
    expect(await new IndexedDbPersistence(factory, dbNameIn(ns, LOCAL_DB.localStore)).hydrate()).toMatchObject({ contacts: [{ id: "c1" }] });
    const content = new DocumentContentCache(factory, dbNameIn(ns, LOCAL_DB.docContent));
    expect(await content.pendingUploads()).toEqual([{ documentId: "d-pending", sha: "sha-p" }]);
    expect(await content.getBytes("sha-read")).toEqual(new Uint8Array([2]));
    expect(await new LocalDocumentTextStore(factory, { dbName: dbNameIn(ns, LOCAL_DB.docText) }).loadAll()).toEqual([["d1", "stämningsansökan"]]);
    expect(await new IndexedDbListStore(dbNameIn(ns, LOCAL_DB.deferredFakturaDocs), factory).load()).toEqual([{ invoiceId: "i1" }]);

    // De gemensamma kv-databaserna är raderade; den gamla kön är tömd (aldrig uppgraderad).
    const all = await names();
    for (const base of ["ava-local-store", "ava-doc-content", "ava-doc-text", "ava-deferred-faktura-docs"]) expect(all).not.toContain(base);
    expect(await new IndexedDbMutationQueuePersistence(factory, "ava-mutation-queue").load()).toEqual([]);
  });

  it("idempotent: en andra start dubblerar inget; en gammal fliks nya post flyttas in, en kvitterad kommer inte tillbaka", async () => {
    await seedLegacy();
    const place = await openLocalDataSession(env(), annaCfg, { binding: false });
    if (!place) throw new Error("ingen plats");
    const queue = new IndexedDbMutationQueuePersistence(factory, queueLocation(place));
    await queue.load();
    await queue.delete("old-1"); // kvitterad av servern

    // En flik med gammal kod skriver om sin array (med den kvitterade posten) och köar en ny.
    await new IdbKv(factory, "ava-mutation-queue", "queue").put("pending", [entry("old-1"), entry("old-2")]);
    await new IndexedDbMutationQueuePersistence(factory, "ava-mutation-queue").add(entry("v2-2"));
    await new IndexedDbListStore("ava-deferred-faktura-docs", factory).save([{ invoiceId: "i1" }, { invoiceId: "i2" }]);
    await new DocumentContentCache(factory, "ava-doc-content").cache(asId<"DocumentId">("d-new"), "sha-n", new Uint8Array([3]));

    const again = await openLocalDataSession(env(), annaCfg, { binding: false });
    if (!again) throw new Error("ingen plats");
    expect((await queueIds(again)).sort()).toEqual(["old-2", "v2-1", "v2-2"]);
    const ns = userNamespace(anna);
    expect(await new IndexedDbListStore(dbNameIn(ns, LOCAL_DB.deferredFakturaDocs), factory).load()).toEqual([{ invoiceId: "i1" }, { invoiceId: "i2" }]);
    expect((await new DocumentContentCache(factory, dbNameIn(ns, LOCAL_DB.docContent)).pendingUploads()).map((p) => p.documentId).sort())
      .toEqual(["d-new", "d-pending"]);
  });

  it("ägaren avgörs en gång: loggar Bo in först efter Anna tar han aldrig över", async () => {
    await seedLegacy();
    // Ny kod körs första gången med Anna bunden → hon är ägaren.
    localStorage.setItem(LEGACY_OWNER_KEY, JSON.stringify({ kind: "user", organizationId: ORG, principalId: "u-anna" }));
    const place = await openLocalDataSession(env(), boCfg, { binding: false });
    expect(place).toEqual({ factory, ns: userNamespace(bo), adoptsLegacy: false });
    if (!place) throw new Error("ingen plats");
    expect(await queueIds(place)).toEqual([]);
    // Annas köade ändringar ligger kvar orörda åt henne …
    expect((await new IndexedDbMutationQueuePersistence(factory, "ava-mutation-queue").load()).map((e) => e.mutationId).sort())
      .toEqual(["old-1", "v2-1"]);
    expect(await new DocumentContentCache(factory, "ava-doc-content").pendingUploads()).toHaveLength(1);
    // … men kopiorna av serverns data är borta.
    const all = await names();
    expect(all).not.toContain("ava-local-store");
    expect(all).not.toContain("ava-doc-text");
    expect(await new DocumentContentCache(factory, "ava-doc-content").getBytes("sha-read")).toBeNull();
  });

  it("utloggad med gammal kod (bara e-posten kvar): Anna känns igen på e-posten", async () => {
    await seedLegacy();
    const loggedOut = { organizationId: ORG, authorEmail: "anna@byra.se" };
    expect(await openLocalDataSession(env(), loggedOut, { binding: true })).toBeNull();
    const place = await openLocalDataSession(env(), annaCfg, { binding: false });
    expect(place?.adoptsLegacy).toBe(true);
  });

  it("ingen ägare och ingen gemensam läs-cache: inget skapas", async () => {
    await openLocalDataSession(env(), { organizationId: ORG, authorEmail: "user@firma.local" }, { binding: true });
    const place = await openLocalDataSession(env(), boCfg, { binding: false });
    expect(place?.adoptsLegacy).toBe(false);
    expect(await names()).toEqual([]);
  });
});

describe("byte av användare (bindningsfasen)", () => {
  it("Annas cache rensas, hennes osynkade arbete ligger kvar; inget binds", async () => {
    bindLocalNamespace(SHARED_NAMESPACE);
    const annaPlace = await openLocalDataSession(env(), annaCfg, { binding: false });
    if (!annaPlace) throw new Error("ingen plats");
    const ns = userNamespace(anna);
    await new IndexedDbMutationQueuePersistence(factory, queueLocation(annaPlace)).add(entry("offline-1"));
    await new IndexedDbPersistence(factory, dbNameIn(ns, LOCAL_DB.localStore)).save({ contacts: [{ id: "x" }] } as never);
    await new LocalDocumentTextStore(factory, { dbName: dbNameIn(ns, LOCAL_DB.docText) }).put("d1", "hemligt");

    // Bos cookie, men configen är fortfarande Annas → bindningsfasen.
    expect(await openLocalDataSession(env(), annaCfg, { binding: true })).toBeNull();

    const all = await names();
    expect(all).toContain(dbNameIn(ns, LOCAL_DB.mutationQueue));
    expect(all).not.toContain(dbNameIn(ns, LOCAL_DB.localStore));
    expect(all).not.toContain(dbNameIn(ns, LOCAL_DB.docText));
    expect(await queueIds(annaPlace)).toEqual(["offline-1"]);
  });

  it("Bo ser aldrig Annas kö", async () => {
    const annaPlace = await openLocalDataSession(env(), annaCfg, { binding: false });
    if (!annaPlace) throw new Error("ingen plats");
    await new IndexedDbMutationQueuePersistence(factory, queueLocation(annaPlace)).add(entry("offline-1"));
    const boPlace = await openLocalDataSession(env(), boCfg, { binding: false });
    if (!boPlace) throw new Error("ingen plats");
    expect(await queueIds(boPlace)).toEqual([]);
    expect(activeLocalScope()).toEqual(bo);
  });
});

describe("purgeLocalData", () => {
  const annaPlace = (): LocalDataPlace => ({ factory, ns: userNamespace(anna), adoptsLegacy: false });

  it("inget osynkat → allt raderas", async () => {
    const ns = userNamespace(anna);
    await new IndexedDbPersistence(factory, dbNameIn(ns, LOCAL_DB.localStore)).save({} as never);
    expect(await purgeLocalData(env(), annaPlace())).toEqual({ kept: [] });
    expect(await names()).toEqual([]);
  });

  it("osynkat arbete behålls, kopiorna av serverns data raderas", async () => {
    const ns = userNamespace(anna);
    const place = annaPlace();
    await new IndexedDbMutationQueuePersistence(factory, queueLocation(place)).add(entry("q"));
    await new IndexedDbRejectedChangesPersistence(factory, rejectedLocation(place))
      .add({ id: "r", rejectedAt: 1, label: "x", reason: "y", entry: entry("r") });
    await new IndexedDbListStore(dbNameIn(ns, LOCAL_DB.deferredFakturaDocs), factory).save([{ invoiceId: "i" }]);
    const content = new DocumentContentCache(factory, dbNameIn(ns, LOCAL_DB.docContent));
    await content.cache(asId<"DocumentId">("d"), "sha-p", new Uint8Array([1]));
    await content.putBytes("sha-read", new Uint8Array([2]));
    await new IndexedDbPersistence(factory, dbNameIn(ns, LOCAL_DB.localStore)).save({} as never);

    expect((await purgeLocalData(env(), place)).kept).toEqual([
      LOCAL_DB.mutationQueue, LOCAL_DB.rejectedChanges, LOCAL_DB.docContent, LOCAL_DB.generatedDocs, LOCAL_DB.deferredFakturaDocs,
    ]);
    expect(await names()).not.toContain(dbNameIn(ns, LOCAL_DB.localStore));
    expect(await content.getBytes("sha-read")).toBeNull();
    expect(await content.getBytes("sha-p")).toEqual(new Uint8Array([1]));
  });

  it("en blockerad radering görs om vid nästa start", async () => {
    const name = dbNameIn(userNamespace(anna), LOCAL_DB.localStore);
    await new IndexedDbPersistence(factory, name).save({} as never);
    // En annan flik håller databasen öppen (utan att stänga vid versionchange).
    const held = await new Promise<IDBDatabase>((resolve) => {
      const req = factory.open(name);
      req.onsuccess = () => resolve(req.result);
    });
    await purgeLocalData(env(), annaPlace());
    expect(JSON.parse(localStorage.getItem(PENDING_PURGE_KEY) ?? "[]")).toContain(name);
    held.close();
    await resumePendingPurge(env());
    expect(localStorage.getItem(PENDING_PURGE_KEY)).toBeNull();
    expect(await names()).not.toContain(name);
  });

  it("resumePendingPurge utan väntande raderingar gör ingenting; en trasig post ignoreras", async () => {
    await resumePendingPurge(env());
    localStorage.setItem(PENDING_PURGE_KEY, "{ trasig");
    await resumePendingPurge(env());
    expect(await names()).toEqual([]);
  });
});
