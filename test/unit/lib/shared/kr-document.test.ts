/**
 * Kostnadsräkningens dokument ↔ körning (#1230): vad som tas bort när en
 * körning ångras, och vilket dokument panelen länkar.
 */

import { describe, expect, it } from "vitest-compat";
import { LEGACY_KR_DOC_LEAD_MS, pickKrDocForRun, selectKrDocsForRun, type KrDocLike } from "@/lib/shared/kr-document";
import { asId } from "@/lib/shared/schemas/ids";

const RUN = { id: asId<"BillingRunId">("r1"), createdAt: "2026-03-10T10:00:00Z" };
const KR = "Kostnadsräkning";

function doc(id: string, extra: Partial<KrDocLike> = {}): KrDocLike {
  return { id: asId<"DocumentId">(id), fileName: `${id}.pdf`, documentType: KR, ...extra };
}

describe("selectKrDocsForRun", () => {
  it("länkade dokument väljs — oavsett tid, och andra dokument lämnas", () => {
    const linked = doc("a", { billingRunId: RUN.id, createdAt: "2020-01-01" });
    const other = doc("b", { billingRunId: asId<"BillingRunId">("r0"), createdAt: RUN.createdAt });
    const plain = doc("c", { documentType: "Inlaga", createdAt: RUN.createdAt });
    expect(selectKrDocsForRun([linked, other, plain], RUN, [RUN])).toEqual({ kind: "found", docs: [linked] });
  });

  it("inga KR-dokument alls → none", () => {
    expect(selectKrDocsForRun([doc("c", { documentType: "Inlaga" })], RUN, [RUN])).toEqual({ kind: "none" });
  });

  it("äldre olänkat dokument skapat strax efter körningen → entydigt körningens", () => {
    const legacy = doc("a", { createdAt: "2026-03-10T10:00:05Z" });
    expect(selectKrDocsForRun([legacy], RUN, [RUN])).toEqual({ kind: "found", docs: [legacy] });
  });

  it("äldre dokument genererat strax FÖRE körningen (domstolsmodalen) räknas också", () => {
    const legacy = doc("a", { createdAt: new Date(Date.parse(RUN.createdAt) - LEGACY_KR_DOC_LEAD_MS + 1000) });
    expect(selectKrDocsForRun([legacy], RUN, [RUN])).toEqual({ kind: "found", docs: [legacy] });
  });

  it("två olänkade kandidater i fönstret → ambiguous", () => {
    const docs = [doc("a", { createdAt: "2026-03-10T10:00:01Z" }), doc("b", { createdAt: "2026-03-10T10:00:02Z" })];
    expect(selectKrDocsForRun(docs, RUN, [RUN])).toEqual({ kind: "ambiguous" });
  });

  it("olänkat dokument som hör till en SENARE körning → ambiguous för denna", () => {
    const later = { id: asId<"BillingRunId">("r2"), createdAt: "2026-04-01T10:00:00Z" };
    const docs = [doc("a", { createdAt: "2026-04-01T10:00:01Z" })];
    expect(selectKrDocsForRun(docs, RUN, [RUN, later])).toEqual({ kind: "ambiguous" });
  });

  it("föregående körning avgränsar fönstret bakåt", () => {
    // Inom modalens 10-minutersfönster, men före den föregående körningen → dess dokument.
    const prev = { id: asId<"BillingRunId">("r0"), createdAt: "2026-03-10T09:55:00Z" };
    const prevDoc = doc("a", { createdAt: "2026-03-10T09:54:00Z" });
    const ownDoc = doc("b", { createdAt: "2026-03-10T10:00:01Z" });
    expect(selectKrDocsForRun([prevDoc, ownDoc], RUN, [prev, RUN])).toEqual({ kind: "found", docs: [ownDoc] });
  });

  it("olänkat dokument utan createdAt faller utanför fönstret → ambiguous", () => {
    expect(selectKrDocsForRun([doc("a")], RUN, [RUN])).toEqual({ kind: "ambiguous" });
  });
});

describe("pickKrDocForRun", () => {
  it("länken går före ett olänkat dokument närmare i tid", () => {
    const linked = doc("a", { billingRunId: RUN.id, createdAt: "2020-01-01" });
    const near = doc("b", { createdAt: RUN.createdAt });
    expect(pickKrDocForRun([near, linked], RUN)).toBe(linked);
  });

  it("äldre dokument: det olänkade närmast körningen i tid", () => {
    const far = doc("a", { createdAt: "2026-01-01" });
    const near = doc("b", { createdAt: "2026-03-10T11:00:00Z" });
    const undated = doc("c");
    expect(pickKrDocForRun([far, undated, near], RUN)).toBe(near);
  });

  it("dokument länkade till en ANNAN körning väljs aldrig", () => {
    expect(pickKrDocForRun([doc("a", { billingRunId: asId<"BillingRunId">("r9"), createdAt: RUN.createdAt })], RUN)).toBeNull();
  });

  it("inga KR-dokument → null", () => {
    expect(pickKrDocForRun([doc("a", { documentType: null })], RUN)).toBeNull();
  });
});
