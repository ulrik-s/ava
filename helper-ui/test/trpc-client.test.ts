/**
 * Helperns tunna tRPC-klient (ADR 0031). Driver `createDocumentClient` via en
 * injicerad fetch som returnerar ett superjson-kodat httpBatchLink-svar →
 * bevisar wire-kompatibilitet (samma `/api/trpc`-endpoint, superjson, Bearer)
 * och att `downloadDocumentBytes` avkodar base64 → bytes.
 */

import { describe, expect, test } from "bun:test";
import superjson from "superjson";

import {
  createDocumentClient,
  documentTrpcEndpoint,
  downloadDocumentBytes,
  type FetchLike,
} from "../src/engine/trpc-client.ts";

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
      const out = {
        contentBase64: Buffer.from("PDF-BYTES").toString("base64"),
        mimeType: "application/pdf",
        fileName: "x.pdf",
      };
      // httpBatchLink-svar: array (batch) av { result: { data: <superjson> } }.
      return new Response(JSON.stringify([{ result: { data: superjson.serialize(out) } }]), {
        status: 200,
        headers: { "content-type": "application/json" },
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
    expect(captured.url).toContain("/api/trpc");
    expect(captured.url).toContain("document.downloadContent");
    expect(captured.auth).toBe("Bearer tok-123");
  });
});
