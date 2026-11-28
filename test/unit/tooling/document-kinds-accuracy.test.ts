/**
 * Träffsäkerheten för dokumentklassningen (#2018) mot pglite: urvalet (facit),
 * överhoppade dokument, siffrorna per typ, tiderna och anropen, jämförelsebasen
 * utan LLM, att rapporten inte läcker dokumentens innehåll, att inget skrivs,
 * och att anslutningen stängs även när körningen fallerar.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { documentPages, documents } from "@/lib/server/db/schema";
import type { DocumentKind } from "@/lib/shared/document-kind";
import { asId, type BillingRunId, type DocumentId, type InvoiceId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import {
  type AccuracyConnection, classifierFromEnv, classifyPages, formatReport, kindStats, listTruthDocuments, main,
  measureAccuracy, type Measurement, parseLimit, pct, percentile, runAccuracy, spread, summarize, truthKinds,
} from "../../../tooling/scripts/document-kinds-accuracy";
import { createTestDb, type TestDbHandle } from "../server/db/pg-test-db";

let handle: TestDbHandle;
const MATTER = asId<"MatterId">(uuidv7());
const USER = asId<"UserId">(uuidv7());
const CUSTOM = "Byråns hemliga typ";
const SECRET_TEXT = "Hemlig brödtext om klienten som är tillräckligt lång för att skickas till modellen i sin helhet.";
const SECRET_FILE = "hemligt-klientnamn.pdf";
const SECRET_TITLE = "Hemlig titel";

interface DocSeed {
  createdAt: string;
  kinds: string[];
  manual?: boolean;
  pages?: string[];
  fileName?: string;
  deletedAt?: Date;
  billingRunId?: BillingRunId;
  invoiceId?: InvoiceId;
  mimeType?: string;
}

async function addDoc(s: DocSeed): Promise<DocumentId> {
  const id = asId<"DocumentId">(uuidv7());
  await handle.db.insert(documents).values({
    id, matterId: MATTER, fileName: s.fileName ?? "a.pdf", mimeType: s.mimeType ?? "application/pdf", sizeBytes: 1,
    storagePath: `documents/content/${id}.pdf`, uploadedById: USER, createdAt: new Date(s.createdAt), title: SECRET_TITLE,
    kinds: s.kinds, kindsManual: s.manual ?? true, deletedAt: s.deletedAt ?? null,
    billingRunId: s.billingRunId ?? null, invoiceId: s.invoiceId ?? null,
  });
  for (const [i, text] of (s.pages ?? []).entries()) {
    await handle.db.insert(documentPages).values({ documentId: id, pageNo: i + 1, text });
  }
  return id;
}

/** Påhittad klassificerare: svarar alltid INLAGA och räknar inget själv. */
const fakeClassify = (): Promise<DocumentKind | null> => Promise.resolve("INLAGA");

/** Klocka som går 10 ms per avläsning. */
function tickingClock(): () => number {
  let t = 0;
  return () => (t += 10);
}

const measured: DocumentId[] = [];

beforeAll(async () => {
  handle = await createTestDb();
  // Facit, äldst först: DOM (rubrik), STÄMNING + FULLMAKT (två delar), AVTAL (LLM gissar fel).
  measured.push(await addDoc({ createdAt: "2026-01-01", kinds: ["DOM"], pages: ["DOM\nMeddelad i tingsrätten"] }));
  measured.push(await addDoc({
    createdAt: "2026-01-02", kinds: ["STAMNING", "FULLMAKT", CUSTOM],
    pages: ["STÄMNINGSANSÖKAN\nKärande", "FULLMAKT\nHärmed befullmäktigas"],
  }));
  measured.push(await addDoc({ createdAt: "2026-01-03", kinds: ["AVTAL"], pages: [SECRET_TEXT], fileName: SECRET_FILE }));
  // Överhoppade: utan sidtext, och med bara byråns egna typer.
  await addDoc({ createdAt: "2026-01-04", kinds: ["DOM"] });
  await addDoc({ createdAt: "2026-01-05", kinds: [CUSTOM], pages: ["DOM\nx"] });
  // Inte facit: automatiska typer, raderat, kostnadsräkning, faktura, importerad e-post.
  await addDoc({ createdAt: "2026-02-01", kinds: ["DOM"], manual: false, pages: ["DOM"] });
  await addDoc({ createdAt: "2026-02-02", kinds: ["DOM"], deletedAt: new Date(), pages: ["DOM"] });
  await addDoc({ createdAt: "2026-02-03", kinds: ["KOSTNADSRAKNING"], billingRunId: asId<"BillingRunId">(uuidv7()), pages: ["x"] });
  await addDoc({ createdAt: "2026-02-04", kinds: ["FAKTURA"], invoiceId: asId<"InvoiceId">(uuidv7()), pages: ["x"] });
  await addDoc({ createdAt: "2026-02-05", kinds: ["EPOST"], mimeType: "message/rfc822", pages: ["x"] });
});

afterAll(async () => { await handle.close(); });

describe("urvalet (facit)", () => {
  it("bara levande manuella dokument som en person typat, de senaste först", async () => {
    const rows = await listTruthDocuments(handle.db);
    expect(rows).toHaveLength(5);
    expect(rows.slice(2).map((r) => r.id)).toEqual([...measured].reverse());
  });

  it("--limit tar de N senaste", async () => {
    const rows = await listTruthDocuments(handle.db, 3);
    expect(rows.map((r) => r.fileName)).toEqual(["a.pdf", "a.pdf", SECRET_FILE]);
    expect(parseLimit(["--limit", "3"])).toBe(3);
    expect(parseLimit([])).toBeUndefined();
    expect(parseLimit(["--limit", "noll"])).toBeUndefined();
    expect(parseLimit(["--limit", "0"])).toBeUndefined();
  });

  it("facit är de inbyggda typerna enligt läsregeln, också ur de äldre fälten", () => {
    const base = { id: asId<"DocumentId">("d"), fileName: "a.pdf", kindsManual: true };
    expect(truthKinds({ ...base, kinds: ["DOM", CUSTOM], documentType: null, tags: [] })).toEqual(["DOM"]);
    expect(truthKinds({ ...base, kinds: [], kindsManual: false, documentType: "FULLMAKT", tags: [CUSTOM] })).toEqual(["FULLMAKT"]);
  });
});

describe("klassningen som i jobbet", () => {
  it("delarnas typer i sidordning, utan anrop när rubrikerna räcker", async () => {
    expect(await classifyPages(["STÄMNINGSANSÖKAN", "FULLMAKT"], "a.pdf", fakeClassify)).toEqual({ kinds: ["STAMNING", "FULLMAKT"], calls: 0 });
  });

  it("en sida utan rubrik går till klassificeraren, och anropen räknas", async () => {
    expect(await classifyPages([SECRET_TEXT], "a.pdf", fakeClassify)).toEqual({ kinds: ["INLAGA"], calls: 1 });
  });

  it("utan klassificerare: filnamnet är reserven", async () => {
    expect(await classifyPages([SECRET_TEXT], "fullmakt.pdf")).toEqual({ kinds: ["FULLMAKT"], calls: 0 });
  });

  it("inga delar (inga sidor): filnamnet", async () => {
    expect(await classifyPages([], "fullmakt.pdf")).toEqual({ kinds: ["FULLMAKT"], calls: 0 });
  });
});

describe("siffrorna", () => {
  it("per typ, rätt primärtyp, exakt samma typer, tider och anrop", async () => {
    const r = await measureAccuracy(handle.db, { classify: fakeClassify, model: "testmodell", now: tickingClock() });
    expect(r).toMatchObject({ model: "testmodell", measured: 3, skipped: 2, primaryCorrect: 2, exactCorrect: 2 });
    expect(r.perKind).toEqual([
      { kind: "STAMNING", inTruth: 1, hits: 1, falseHits: 0 },
      { kind: "INLAGA", inTruth: 0, hits: 0, falseHits: 1 },
      { kind: "DOM", inTruth: 1, hits: 1, falseHits: 0 },
      { kind: "FULLMAKT", inTruth: 1, hits: 1, falseHits: 0 },
      { kind: "AVTAL", inTruth: 1, hits: 0, falseHits: 0 },
    ]);
    expect(r.ms).toEqual({ median: 10, p90: 10, max: 10 });
    expect(r.calls).toEqual({ median: 0, p90: 1, max: 1 });
  });

  it("kindStats räknar träffar och falska träffar", () => {
    const ms: Measurement[] = [
      { truth: ["DOM"], predicted: ["DOM"], ms: 1, calls: 0 },
      { truth: ["AVTAL"], predicted: ["DOM"], ms: 1, calls: 0 },
      { truth: ["DOM"], predicted: ["INLAGA"], ms: 1, calls: 0 },
    ];
    expect(kindStats("DOM", ms)).toEqual({ kind: "DOM", inTruth: 2, hits: 1, falseHits: 1 });
  });

  it("percentil och spridning (närmaste rang); tom lista ger 0", () => {
    const v = [5, 1, 4, 2, 3, 10, 9, 8, 7, 6];
    expect(spread(v)).toEqual({ median: 5, p90: 9, max: 10 });
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([7], 0)).toBe(7);
  });

  it("pct: en decimal, och – utan nämnare", () => {
    expect(pct(2, 3)).toBe("66.7 %");
    expect(pct(0, 0)).toBe("–");
  });

  it("summarize utan mätta dokument", () => {
    expect(summarize([{ kind: "skipped" }], null)).toMatchObject({ measured: 0, skipped: 1, perKind: [], ms: { median: 0, p90: 0, max: 0 } });
  });
});

describe("rapporten", () => {
  it("modellen, antalen, andelarna och tabellen per typ", async () => {
    const report = formatReport(await measureAccuracy(handle.db, { classify: fakeClassify, model: "testmodell", now: tickingClock() }));
    expect(report).toContain("- Modell: testmodell");
    expect(report).toContain("- Mätta dokument: 3");
    expect(report).toContain("- Överhoppade dokument (ingen sidtext eller bara byråns egna typer): 2");
    expect(report).toContain("- Rätt primärtyp: 66.7 %");
    expect(report).toContain("- Exakt samma typer: 66.7 %");
    expect(report).toContain("- Tid per dokument (ms): median 10, p90 10, max 10");
    expect(report).toContain("- Anrop till klassificeraren per dokument: median 0, p90 1, max 1");
    expect(report).toContain("| AVTAL | 1 | 0 | 0 | 0.0 % | – |");
    expect(report).toContain("| INLAGA | 0 | 0 | 1 | – | 0.0 % |");
  });

  it("jämförelsebasen utan LLM-konfig: bara rubrik och filnamn", async () => {
    const env = classifierFromEnv({});
    expect(env).toEqual({ model: null });
    const report = formatReport(await measureAccuracy(handle.db, env));
    expect(report).toContain("- Modell: ingen LLM: bara rubrik och filnamn");
    expect(report).toContain("- Anrop till klassificeraren per dokument: median 0, p90 0, max 0");
  });

  it("med LLM-konfig: modellens namn och en klassificerare", () => {
    const env = classifierFromEnv({ AVA_LLM_ENDPOINT: "http://ollama:11434/v1", AVA_LLM_MODEL: "qwen2.5:1.5b" });
    expect(env.model).toBe("qwen2.5:1.5b");
    expect(typeof env.classify).toBe("function");
  });

  it("innehåller aldrig dokument-id, filnamn, titel, sidtext eller egna typnamn", async () => {
    const report = formatReport(await measureAccuracy(handle.db, { classify: fakeClassify, model: "m" }));
    for (const secret of [SECRET_FILE, SECRET_TITLE, SECRET_TEXT.slice(0, 20), CUSTOM, ...measured]) {
      expect(report).not.toContain(secret);
    }
  });

  it("ändrar ingenting i databasen", async () => {
    const before = { docs: await handle.db.select().from(documents), pages: await handle.db.select().from(documentPages) };
    await measureAccuracy(handle.db, { classify: fakeClassify, model: "m" });
    expect(await handle.db.select().from(documents)).toEqual(before.docs);
    expect(await handle.db.select().from(documentPages)).toEqual(before.pages);
  });
});

describe("anslutningen och main", () => {
  const open = (onClose: () => void) => (): Promise<AccuracyConnection> =>
    Promise.resolve({ db: handle.db, close: () => { onClose(); return Promise.resolve(); } });

  it("runAccuracy ansluter, mäter och stänger", async () => {
    let closed = 0;
    const report = await runAccuracy("postgres://x", { model: null }, open(() => { closed++; }));
    expect(report).toContain("- Mätta dokument: 3");
    expect(closed).toBe(1);
  });

  it("runAccuracy stänger även när körningen fallerar", async () => {
    let closed = 0;
    const failing = (): Promise<DocumentKind | null> => Promise.reject(new Error("modellen nere"));
    await expect(runAccuracy("postgres://x", { model: "m", classify: failing }, open(() => { closed++; })))
      .rejects.toThrow("modellen nere");
    expect(closed).toBe(1);
  });

  function recordingOut() {
    const o = { stdout: [] as string[], stderr: [] as string[], failed: 0 };
    return { o, out: { stdout: (s: string) => { o.stdout.push(s); }, stderr: (s: string) => { o.stderr.push(s); }, fail: () => { o.failed++; } } };
  }

  it("main utan AVA_DATABASE_URL skriver ett fel och sätter exit-koden", async () => {
    const { o, out } = recordingOut();
    await main([], {}, out);
    expect(o.stderr.join("")).toContain("AVA_DATABASE_URL");
    expect(o.failed).toBe(1);
    expect(o.stdout).toEqual([]);
  });

  it("main skriver rapporten på stdout och tar --limit", async () => {
    const { o, out } = recordingOut();
    const urls: string[] = [];
    await main(["--limit", "1"], { AVA_DATABASE_URL: "postgres://db" }, out, (url) => {
      urls.push(url);
      return Promise.resolve({ db: handle.db, close: () => Promise.resolve() });
    });
    expect(urls).toEqual(["postgres://db"]);
    expect(o.stdout.join("")).toContain("- Överhoppade dokument (ingen sidtext eller bara byråns egna typer): 1");
    expect(o.failed).toBe(0);
  });
});
