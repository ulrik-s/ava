/**
 * `PostgresSearchIndex` (#1215) mot en riktig Postgres-motor (pglite in-process;
 * `PG_TEST_URL` → riktig Postgres i CI:s "Repository (Postgres)"-jobb).
 * pglite har 'swedish'-konfigen, så stemming testas på riktigt.
 */

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { likePatternOf, markHeadline, PostgresSearchIndex } from "@/lib/server/adapters/postgres-search-index";
import { documentPages, documents, matters, users } from "@/lib/server/db/schema";
import { DrizzleDocumentRepository } from "@/lib/server/repositories/drizzle-document-repository";
import { asId, type DocumentId, type MatterId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ORG = asId<"OrganizationId">(uuidv7());
const OTHER_ORG = asId<"OrganizationId">(uuidv7());
const M1 = asId<"MatterId">(uuidv7());
const M2 = asId<"MatterId">(uuidv7());
const M_OTHER = asId<"MatterId">(uuidv7());
const USER = asId<"UserId">(uuidv7());

let handle: TestDbHandle;
let index: PostgresSearchIndex;

async function addDoc(matterId: MatterId, extra: { fileName: string; documentType?: string; summary?: string }): Promise<DocumentId> {
  const id = asId<"DocumentId">(uuidv7());
  await handle.db.insert(documents).values({
    id, matterId, mimeType: "application/pdf", sizeBytes: 1, storagePath: `documents/content/${id}.pdf`,
    uploadedById: USER, ...extra,
  });
  return id;
}

async function pagesOf(id: DocumentId): Promise<Array<{ pageNo: number; text: string }>> {
  const rows = await handle.db.select({ pageNo: documentPages.pageNo, text: documentPages.text, documentId: documentPages.documentId })
    .from(documentPages);
  return rows.filter((r) => r.documentId === id).map(({ pageNo, text }) => ({ pageNo, text })).sort((a, b) => a.pageNo - b.pageNo);
}

beforeAll(async () => {
  handle = await createTestDb();
  index = new PostgresSearchIndex(handle.db);
  await handle.db.insert(matters).values([
    { id: M1, organizationId: ORG, matterNumber: "AA2026-0001", title: "Tvist Andersson" },
    { id: M2, organizationId: ORG, matterNumber: "AA2026-0002", title: "Bodelning" },
    { id: M_OTHER, organizationId: OTHER_ORG, matterNumber: "BB2026-0001", title: "Annan byrå" },
  ]);
  await handle.db.insert(users).values({ id: USER, organizationId: ORG, email: "a@x", name: "Anna" });
});

afterAll(async () => { await handle.close(); });

describe("replacePages", () => {
  it("skriver sidorna 1-baserat och ersätter vid omindexering", async () => {
    const id = await addDoc(M1, { fileName: "a.pdf" });
    await index.replacePages(id, ["ett", "två", "tre"]);
    expect(await pagesOf(id)).toEqual([{ pageNo: 1, text: "ett" }, { pageNo: 2, text: "två" }, { pageNo: 3, text: "tre" }]);
    await index.replacePages(id, ["ny"]);
    expect(await pagesOf(id)).toEqual([{ pageNo: 1, text: "ny" }]);
  });

  it("tom lista tar bort sidorna; remove likaså", async () => {
    const id = await addDoc(M1, { fileName: "b.pdf" });
    await index.replacePages(id, ["x"]);
    await index.replacePages(id, []);
    expect(await pagesOf(id)).toEqual([]);
    await index.replacePages(id, ["y"]);
    await index.remove(id);
    expect(await pagesOf(id)).toEqual([]);
  });

  it("upsert (port-ytan) indexerar innehållet som en sida; tomt innehåll → inga sidor", async () => {
    const id = await addDoc(M1, { fileName: "c.pdf" });
    const base = { id, fileName: "c.pdf", matterId: M1, matterNumber: "", matterTitle: "", organizationId: ORG };
    await index.upsert({ ...base, content: "hela texten" });
    expect(await pagesOf(id)).toEqual([{ pageNo: 1, text: "hela texten" }]);
    await index.upsert({ ...base, content: "" });
    expect(await pagesOf(id)).toEqual([]);
  });

  it("hård delete av dokumentet kaskaderar till sidorna", async () => {
    const id = await addDoc(M1, { fileName: "d.pdf" });
    await index.replacePages(id, ["kaskad"]);
    await new DrizzleDocumentRepository(handle.db).hardDelete(id);
    expect(await pagesOf(id)).toEqual([]);
  });

  it("mjuk delete (tombstone) rensar sidorna", async () => {
    const id = await addDoc(M1, { fileName: "e.pdf" });
    await index.replacePages(id, ["tombstone"]);
    const row = await new DrizzleDocumentRepository(handle.db).softDelete(id);
    expect(row.deletedAt).toBeTruthy();
    expect(await pagesOf(id)).toEqual([]);
  });
});

describe("search", () => {
  let stamning: DocumentId;
  let yttrande: DocumentId;
  let bodelning: DocumentId;
  let foreign: DocumentId;
  let deleted: DocumentId;

  beforeAll(async () => {
    stamning = await addDoc(M1, { fileName: "inlaga.pdf", documentType: "STAMNING" });
    await index.replacePages(stamning, [
      "Till Stockholms tingsrätt. Kärande Anna Andersson.",
      "Yrkanden: svaranden ska förpliktas betala. Grunden för stämningen är avtalsbrott.",
    ]);
    yttrande = await addDoc(M1, { fileName: "yttrande.pdf", documentType: "YTTRANDE", summary: "Diarieförd av Bertil" });
    await index.replacePages(yttrande, ["Svaranden bestrider <script>alert(1)</script> käromålet & kostnaden."]);
    bodelning = await addDoc(M2, { fileName: "bodelning.pdf", documentType: "AVTAL" });
    await index.replacePages(bodelning, ["Bodelningsavtal. Parterna har tidigare haft stämningar i tingsrätt."]);
    foreign = await addDoc(M_OTHER, { fileName: "stamning.pdf", documentType: "STAMNING" });
    await index.replacePages(foreign, ["En stämning i annan byrå."]);
    deleted = await addDoc(M1, { fileName: "raderad.pdf", documentType: "STAMNING" });
    await index.replacePages(deleted, ["stämning som raderats"]);
    await handle.db.update(documents).set({ deletedAt: new Date() }).where(eq(documents.id, deleted));
  });

  it("svensk stemming: 'stämningar' hittar 'stämningen' (och vice versa); rätt sida", async () => {
    const r = await index.search("stämningar", ORG);
    const ids = r.hits.map((h) => h.id);
    expect(ids).toContain(stamning);
    expect(ids).toContain(bodelning);
    expect(r.hits.find((h) => h.id === stamning)?.page).toBe(2);
    expect(r.hits.find((h) => h.id === bodelning)?.page).toBe(1);
  });

  it("org-scopning: annan byrås dokument och raderade dokument hittas aldrig", async () => {
    const ids = (await index.search("stämning", ORG)).hits.map((h) => h.id);
    expect(ids).not.toContain(foreign);
    expect(ids).not.toContain(deleted);
    expect((await index.search("stämning", OTHER_ORG)).hits.map((h) => h.id)).toEqual([foreign]);
  });

  it("matterId begränsar till ärendet", async () => {
    const r = await index.search("stämning", ORG, 20, { matterId: M2 });
    expect(r.hits.map((h) => h.id)).toEqual([bodelning]);
  });

  it("facetter per typ oavsett typ-filter; filtret begränsar träffarna", async () => {
    const r = await index.search("stämning", ORG, 20, { documentTypes: ["AVTAL"] });
    expect(r.hits.map((h) => h.id)).toEqual([bodelning]);
    expect(r.estimatedTotalHits).toBe(1);
    expect(r.facets?.documentTypes).toEqual([
      { type: "AVTAL", count: 1 }, { type: "STAMNING", count: 1 },
    ]);
  });

  it("snippet: ts_headline med <mark> runt träffen, matter-fält ifyllda", async () => {
    const hit = (await index.search("stämningar", ORG)).hits.find((h) => h.id === stamning);
    expect(hit?._formatted?.content).toContain("<mark>stämningen</mark>");
    expect(hit).toMatchObject({ matterId: M1, matterNumber: "AA2026-0001", matterTitle: "Tvist Andersson", organizationId: ORG });
    expect(hit?.storagePath).toBe(`documents/content/${stamning}.pdf`);
  });

  it("snippet HTML-escapas (dokumenttext är inte betrodd)", async () => {
    const hit = (await index.search("käromålet", ORG)).hits.find((h) => h.id === yttrande);
    expect(hit?._formatted?.content).toContain("&amp; kostnaden");
    expect(hit?._formatted?.content).not.toContain("<script");
  });

  it("metadata-träff utan innehållsträff: sida null, snippet = sammanfattningen", async () => {
    const r = await index.search("bertil", ORG);
    const hit = r.hits.find((h) => h.id === yttrande);
    expect(hit?.page).toBeNull();
    expect(hit?._formatted?.content).toBe("Diarieförd av Bertil");
  });

  it("filnamnsträff rankas över ren innehållsträff", async () => {
    const r = await index.search("bodelning", ORG);
    expect(r.hits[0]?.id).toBe(bodelning);
  });

  it("wildcard: `*` matchar sidtexten med ILIKE", async () => {
    const r = await index.search("förplikt*betala", ORG);
    expect(r.hits.map((h) => h.id)).toEqual([stamning]);
    expect(r.hits[0]?.page).toBe(2);
  });

  it("limit kapar träffarna men inte totalen", async () => {
    const r = await index.search("stämning", ORG, 1);
    expect(r.hits).toHaveLength(1);
    expect(r.estimatedTotalHits).toBe(2);
  });

  it("tom fråga → inga träffar", async () => {
    expect(await index.search("   ", ORG)).toEqual({ hits: [], estimatedTotalHits: 0 });
  });

  it("ingen träff alls → tomt resultat med tomma facetter", async () => {
    expect(await index.search("finnsinte", ORG)).toEqual({ hits: [], estimatedTotalHits: 0, facets: { documentTypes: [] } });
  });
});

describe("rena hjälpare", () => {
  it("likePatternOf escapar ILIKE-specialtecken och gör * till %", () => {
    expect(likePatternOf("50%_a\\b*c")).toBe("%50\\%\\_a\\\\b%c%");
  });

  it("markHeadline escapar HTML och byter markörerna mot <mark>", () => {
    expect(markHeadline("a & \u0001b\u0002 \"<\"")).toBe("a &amp; <mark>b</mark> &quot;&lt;&quot;");
  });
});
