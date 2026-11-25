/**
 * Fakturans PDF som bilaga till verifikatet (#1887): rätt dokument väljs, och
 * när inget finns att bifoga kastas ett skäl utan filnamn.
 */

import { describe, it, expect } from "vitest-compat";
import { invoicePdfAttachment } from "@/lib/server/integrations/ledger/invoice-attachment";

const BYTES = new Uint8Array([37, 80, 68, 70]);

function doc(over: Record<string, unknown> = {}) {
  return {
    fileName: "faktura-F-1.pdf",
    mimeType: "application/pdf",
    storagePath: "documents/content/doc-1.pdf",
    createdAt: new Date("2026-11-01T10:00:00Z"),
    ...over,
  };
}

/** En content-store som bara har de angivna sökvägarna. */
function store(paths: Record<string, Uint8Array>) {
  const reads: string[] = [];
  return {
    reads,
    content: { read: (p: string) => { reads.push(p); return Promise.resolve(paths[p] ?? null); } },
  };
}

describe("invoicePdfAttachment", () => {
  it("ger PDF:ens bytes, namn och typ", async () => {
    const { content } = store({ "documents/content/doc-1.pdf": BYTES });
    expect(await invoicePdfAttachment(content, [doc()])).toEqual({
      fileName: "faktura-F-1.pdf", bytes: BYTES, contentType: "application/pdf",
    });
  });

  it("väljer den nyaste PDF:en, oavsett ordning", async () => {
    const older = doc({ fileName: "gammal.pdf", storagePath: "documents/content/old.pdf", createdAt: new Date("2026-10-01") });
    const newer = doc({ fileName: "ny.pdf", storagePath: "documents/content/new.pdf", createdAt: new Date("2026-11-02") });
    const { content, reads } = store({ "documents/content/old.pdf": BYTES, "documents/content/new.pdf": BYTES });
    expect((await invoicePdfAttachment(content, [older, newer])).fileName).toBe("ny.pdf");
    expect((await invoicePdfAttachment(content, [newer, older])).fileName).toBe("ny.pdf");
    expect(reads).toEqual(["documents/content/new.pdf", "documents/content/new.pdf"]);
  });

  it("hoppar över mjukt raderade, HTML och ogiltiga sökvägar", async () => {
    const valid = doc({ fileName: "giltig.pdf", createdAt: new Date("2026-09-01") });
    const docs = [
      valid,
      doc({ fileName: "raderad.pdf", deletedAt: new Date("2026-11-03"), createdAt: new Date("2026-11-03") }),
      doc({ fileName: "faktura.html", mimeType: "text/html", createdAt: new Date("2026-11-04") }),
      doc({ fileName: "fel.pdf", storagePath: ".git/index", createdAt: new Date("2026-11-05") }),
    ];
    const { content } = store({ "documents/content/doc-1.pdf": BYTES });
    expect((await invoicePdfAttachment(content, docs)).fileName).toBe("giltig.pdf");
  });

  it("inget dokument → skäl utan filnamn", async () => {
    const { content } = store({});
    await expect(invoicePdfAttachment(content, [])).rejects.toThrow("Fakturan har ingen PDF att bifoga.");
  });

  it("bara HTML, raderade eller ogiltiga → samma skäl, och inget läses", async () => {
    const { content, reads } = store({});
    const docs = [doc({ mimeType: "text/html" }), doc({ deletedAt: new Date() }), doc({ storagePath: "../x.pdf" })];
    await expect(invoicePdfAttachment(content, docs)).rejects.toThrow("Fakturan har ingen PDF att bifoga.");
    expect(reads).toEqual([]);
  });

  it("saknade bytes → skäl utan filnamn", async () => {
    const { content } = store({});
    const err = await invoicePdfAttachment(content, [doc()]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Fakturans PDF saknas på servern.");
    expect((err as Error).message).not.toContain("faktura-F-1");
  });
});
