/**
 * Test för `mailDocument` (#72 slice 3, funktion 2) — bifoga ärende-dokument
 * och skicka/utkast via Graph. fetch-injicerad.
 */

import { describe, it, expect, vi } from "vitest-compat";
import { mailDocument } from "@/lib/client/graph/mail-document";
import { GRAPH_BASE, type GraphFetch } from "@/lib/client/graph/graph-mail";

const doc = { fileName: "stamning.pdf", mimeType: "application/pdf", bytes: new Uint8Array([37, 80, 68, 70]) };
const b64 = Buffer.from([37, 80, 68, 70]).toString("base64");

describe("mailDocument", () => {
  it("skickar direkt (sendMail) med dokumentet som bilaga", async () => {
    const f: GraphFetch = vi.fn(async () => new Response("", { status: 202 }));
    const res = await mailDocument({ token: "t", doc, to: ["klient@ex.se"], subject: "Stämning", body: "Bifogat.", fetch: f });
    expect(res).toEqual({ sent: true });
    const [url, init] = (f as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe(`${GRAPH_BASE}/me/sendMail`);
    const parsed = JSON.parse((init as RequestInit).body as string);
    expect(parsed.message.attachments[0]).toEqual({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: "stamning.pdf",
      contentType: "application/pdf",
      contentBytes: b64,
    });
    expect(parsed.message.toRecipients).toEqual([{ emailAddress: { address: "klient@ex.se" } }]);
  });

  it("asDraft → createDraft, returnerar draftId + webLink", async () => {
    const f: GraphFetch = vi.fn(async () => new Response(JSON.stringify({ id: "d9", webLink: "https://o/d9" }), { status: 201 }));
    const res = await mailDocument({ token: "t", doc, to: ["a@b.se"], subject: "S", body: "b", asDraft: true, fetch: f });
    expect(res).toEqual({ draftId: "d9", webLink: "https://o/d9" });
    expect((f as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(`${GRAPH_BASE}/me/messages`);
  });

  it("skickar cc + html-body när angivet", async () => {
    const f: GraphFetch = vi.fn(async () => new Response("", { status: 202 }));
    await mailDocument({ token: "t", doc, to: ["a@b.se"], cc: ["chef@ex.se"], subject: "S", body: "<p>x</p>", html: true, fetch: f });
    const parsed = JSON.parse(((f as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit).body as string);
    expect(parsed.message.body.contentType).toBe("HTML");
    expect(parsed.message.ccRecipients).toEqual([{ emailAddress: { address: "chef@ex.se" } }]);
  });

  it("propagerar Graph-fel", async () => {
    const f: GraphFetch = vi.fn(async () => new Response("bad", { status: 400 }));
    await expect(mailDocument({ token: "t", doc, to: ["a@b.se"], subject: "S", body: "b", fetch: f }))
      .rejects.toThrow(/sendMail.*400/);
  });
});
