/**
 * Test för `graph-mail` (#72 slice 2) — MS Graph-mail-helpers. Rena builders +
 * fetch-injicerade anrop (ingen Graph-runtime). API-form mot Microsoft Learn.
 */

import { describe, it, expect, vi } from "vitest-compat";
import {
  GRAPH_BASE, messageMimeUrl, fileAttachment, buildMessage,
  fetchMessageEml, sendMail, createDraft, type GraphFetch,
} from "@/lib/client/graph/graph-mail";

const ok = (body: BodyInit, status = 200) => new Response(body, { status });

describe("messageMimeUrl", () => {
  it("bygger /me/messages/{id}/$value och url-enkodar id:t (default Graph)", () => {
    expect(messageMimeUrl("AAMk=")).toBe(`${GRAPH_BASE}/me/messages/AAMk%3D/$value`);
  });

  it("respekterar baseUrl-override (Outlook REST) + trimmar slash", () => {
    expect(messageMimeUrl("id1", "https://outlook.office.com/api/v2.0/")).toBe(
      "https://outlook.office.com/api/v2.0/me/messages/id1/$value",
    );
  });
});

describe("fileAttachment", () => {
  it("bygger en #microsoft.graph.fileAttachment med base64-innehåll", () => {
    const att = fileAttachment("mail.eml", "message/rfc822", new Uint8Array([72, 105]));
    expect(att).toEqual({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: "mail.eml",
      contentType: "message/rfc822",
      contentBytes: Buffer.from([72, 105]).toString("base64"),
    });
  });
});

describe("buildMessage", () => {
  it("Text-default + to-recipients", () => {
    const m = buildMessage({ subject: "Hej", body: "kropp", to: ["a@b.se"] });
    expect(m.body).toEqual({ contentType: "Text", content: "kropp" });
    expect(m.toRecipients).toEqual([{ emailAddress: { address: "a@b.se" } }]);
    expect(m.ccRecipients).toBeUndefined();
    expect(m.attachments).toBeUndefined();
  });

  it("html:true → HTML; cc + attachments inkluderas när de finns", () => {
    const att = fileAttachment("d.pdf", "application/pdf", new Uint8Array([1]));
    const m = buildMessage({ subject: "S", body: "<p>x</p>", html: true, to: ["a@b.se"], cc: ["c@d.se"], attachments: [att] });
    expect(m.body.contentType).toBe("HTML");
    expect(m.ccRecipients).toEqual([{ emailAddress: { address: "c@d.se" } }]);
    expect(m.attachments).toEqual([att]);
  });

  it("tom cc/attachments-array utelämnas", () => {
    const m = buildMessage({ subject: "S", body: "b", to: ["a@b.se"], cc: [], attachments: [] });
    expect(m.ccRecipients).toBeUndefined();
    expect(m.attachments).toBeUndefined();
  });
});

describe("fetchMessageEml", () => {
  it("hämtar $value med Bearer-token → bytes + base64", async () => {
    const raw = "Subject: Hej\r\n\r\nKropp";
    const f: GraphFetch = vi.fn(async () => ok(new TextEncoder().encode(raw)));
    const res = await fetchMessageEml({ token: "gtok", restId: "id1", fetch: f });
    expect(Buffer.from(res.bytes).toString("utf8")).toBe(raw);
    expect(res.base64).toBe(Buffer.from(raw, "utf8").toString("base64"));
    const [url, init] = (f as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe(messageMimeUrl("id1"));
    expect((init as RequestInit).headers).toEqual({ authorization: "Bearer gtok" });
  });

  it("kastar vid icke-2xx", async () => {
    const f: GraphFetch = vi.fn(async () => ok("nope", 404));
    await expect(fetchMessageEml({ token: "t", restId: "x", fetch: f })).rejects.toThrow(/GET \$value.*404/);
  });
});

describe("sendMail", () => {
  it("POST /me/sendMail med message + saveToSentItems(default true)", async () => {
    const f: GraphFetch = vi.fn(async () => ok("", 202));
    await sendMail({ token: "t", message: { subject: "S", body: "b", to: ["a@b.se"] }, fetch: f });
    const [url, init] = (f as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe(`${GRAPH_BASE}/me/sendMail`);
    const ri = init as RequestInit;
    expect(ri.method).toBe("POST");
    expect((ri.headers as Record<string, string>).authorization).toBe("Bearer t");
    const parsed = JSON.parse(ri.body as string);
    expect(parsed.saveToSentItems).toBe(true);
    expect(parsed.message.subject).toBe("S");
  });

  it("saveToSentItems:false respekteras", async () => {
    const f: GraphFetch = vi.fn(async () => ok("", 202));
    await sendMail({ token: "t", message: { subject: "S", body: "b", to: ["a@b.se"] }, saveToSentItems: false, fetch: f });
    const parsed = JSON.parse(((f as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit).body as string);
    expect(parsed.saveToSentItems).toBe(false);
  });

  it("kastar vid fel", async () => {
    const f: GraphFetch = vi.fn(async () => ok("bad", 400));
    await expect(sendMail({ token: "t", message: { subject: "S", body: "b", to: ["a@b.se"] }, fetch: f }))
      .rejects.toThrow(/sendMail.*400/);
  });
});

describe("createDraft", () => {
  it("POST /me/messages → returnerar id + webLink", async () => {
    const f: GraphFetch = vi.fn(async () => ok(JSON.stringify({ id: "d1", webLink: "https://outlook/d1" }), 201));
    const res = await createDraft({ token: "t", message: { subject: "S", body: "b", to: ["a@b.se"] }, fetch: f });
    expect(res).toEqual({ id: "d1", webLink: "https://outlook/d1" });
    expect((f as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(`${GRAPH_BASE}/me/messages`);
  });

  it("utelämnar webLink om Graph inte gav någon", async () => {
    const f: GraphFetch = vi.fn(async () => ok(JSON.stringify({ id: "d2" }), 201));
    const res = await createDraft({ token: "t", message: { subject: "S", body: "b", to: ["a@b.se"] }, fetch: f });
    expect(res).toEqual({ id: "d2" });
  });
});
