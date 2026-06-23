/**
 * Helperns tunna tRPC-klient (ADR 0031). Driver `createDocumentClient` via en
 * injicerad fetch som returnerar ett superjson-kodat httpBatchLink-svar →
 * bevisar wire-kompatibilitet (samma `/api/trpc`-endpoint, superjson, Bearer)
 * och att `downloadDocumentBytes` avkodar base64 → bytes.
 */

import { describe, expect, test } from "bun:test";
import superjson from "superjson";

import { asId } from "@/lib/shared/schemas/ids";

import {
  createDocumentClient,
  documentTrpcEndpoint,
  downloadDocumentBytes,
  saveConflictCopyBytes,
  uploadDocumentBytes,
  type FetchLike,
} from "../src/engine/trpc-client.ts";

/** Ett httpBatchLink-fel-svar: `{ error: <superjson(error-shape)> }` (se transformResult). */
function batchError(code: string, httpStatus: number): Response {
  const shape = { message: code, code: -32603, data: { code, httpStatus, path: "document.uploadContent" } };
  return new Response(JSON.stringify([{ error: superjson.serialize(shape) }]), {
    status: 200, headers: { "content-type": "application/json" },
  });
}

/** Ett httpBatchLink-success-svar med superjson-kodad data. */
function batchOk(data: unknown): Response {
  return new Response(JSON.stringify([{ result: { data: superjson.serialize(data) } }]), {
    status: 200, headers: { "content-type": "application/json" },
  });
}

describe("documentTrpcEndpoint", () => {
  test("lägger på /api/trpc och trimmar avslutande slash", () => {
    expect(documentTrpcEndpoint("http://h:8080")).toBe("http://h:8080/api/trpc");
    expect(documentTrpcEndpoint("http://h:8080/")).toBe("http://h:8080/api/trpc");
    expect(documentTrpcEndpoint("http://h:8080///")).toBe("http://h:8080/api/trpc");
  });
});

describe("createDocumentClient + downloadDocumentBytes", () => {
  test("anropar document.downloadContent med Bearer och avkodar base64 → bytes", async () => {
    const captured: { url: string; auth: string | null } = { url: "", auth: null };
    const fetchImpl: FetchLike = async (input, init) => {
      captured.url = String(input);
      captured.auth = new Headers(init?.headers).get("authorization");
      // httpBatchLink-svar: array (batch) av { result: { data: <superjson> } }.
      return batchOk({
        contentBase64: Buffer.from("PDF-BYTES").toString("base64"),
        mimeType: "application/pdf",
        fileName: "x.pdf",
        version: 5,
      });
    };

    const client = createDocumentClient({
      trpcUrl: "http://h:8080/api/trpc",
      token: "tok-123",
      fetch: fetchImpl,
    });
    const res = await downloadDocumentBytes(client, "doc-1");

    expect(new TextDecoder().decode(res.bytes)).toBe("PDF-BYTES");
    expect(res.mimeType).toBe("application/pdf");
    expect(res.fileName).toBe("x.pdf");
    expect(res.version).toBe(5); // basversion (ADR 0033 §1)
    expect(captured.url).toContain("/api/trpc");
    expect(captured.url).toContain("document.downloadContent");
    expect(captured.auth).toBe("Bearer tok-123");
  });
});

describe("uploadDocumentBytes (ADR 0033 §1 — optimistisk version)", () => {
  function clientWith(fetchImpl: FetchLike): ReturnType<typeof createDocumentClient> {
    return createDocumentClient({ trpcUrl: "http://h:8080/api/trpc", token: "t", fetch: fetchImpl });
  }

  test("success → {status:'ok', version} och skickar med baseVersion", async () => {
    let sentBody = "";
    const client = clientWith(async (_input, init) => {
      sentBody = String(init?.body ?? "");
      return batchOk({ id: "doc-1", version: 9 });
    });
    const res = await uploadDocumentBytes(client, "doc-1", new TextEncoder().encode("x"), 8);
    expect(res).toEqual({ status: "ok", version: 9 });
    expect(sentBody).toContain("\"baseVersion\""); // basversionen bars med i mutationen
  });

  test("409 CONFLICT → {status:'conflict'} (kastar inte)", async () => {
    const client = clientWith(async () => batchError("CONFLICT", 409));
    expect(await uploadDocumentBytes(client, "doc-1", new TextEncoder().encode("x"), 3)).toEqual({ status: "conflict" });
  });

  test("annat fel (t.ex. INTERNAL_SERVER_ERROR) → kastar vidare (→ kö-backoff)", async () => {
    const client = clientWith(async () => batchError("INTERNAL_SERVER_ERROR", 500));
    await expect(uploadDocumentBytes(client, "doc-1", new TextEncoder().encode("x"), 3)).rejects.toThrow();
  });
});

describe("saveConflictCopyBytes (ADR 0033 §4 — keep-both)", () => {
  test("anropar document.saveConflictCopy och returnerar kopians id+namn", async () => {
    let url = "";
    let body = "";
    const client = createDocumentClient({
      trpcUrl: "http://h:8080/api/trpc", token: "t",
      fetch: async (input, init) => {
        url = String(input);
        body = String(init?.body ?? "");
        return batchOk({ id: "copy-1", fileName: "Avtal (din ändring 2026-06-22 14:32).docx" });
      },
    });
    const copy = await saveConflictCopyBytes(client, "doc-1", new TextEncoder().encode("min"), "2026-06-22 14:32");
    expect(copy).toEqual({ id: asId<"DocumentId">("copy-1"), fileName: "Avtal (din ändring 2026-06-22 14:32).docx" });
    expect(url).toContain("document.saveConflictCopy");
    expect(body).toContain("\"label\"");
  });
});
