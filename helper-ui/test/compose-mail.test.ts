import { describe, expect, test } from "bun:test";

import { handleComposeMail, type ComposeMailDeps } from "../src/engine/compose-mail.ts";
import type { ComposeMailOpts } from "../src/engine/platform/mail.ts";
import { jsonRequest, mkRequest } from "./helpers.ts";

function deps(capture?: (o: ComposeMailOpts) => void): ComposeMailDeps {
  return {
    compose: async (o) => { capture?.(o); },
    makeSessionDir: async () => "/tmp/ava-mail",
    writeAttachment: async () => undefined,
  };
}

function mailReq(body: unknown): Request {
  return jsonRequest("/compose-mail", body);
}

const validContent = Buffer.from("hello").toString("base64");

describe("handleComposeMail", () => {
  test("skriver bilaga + öppnar mail + 200", async () => {
    let opts: ComposeMailOpts | undefined;
    const res = await handleComposeMail(
      mailReq({ fileName: "brev.html", contentBase64: validContent, subject: "Hej", body: "Text", to: "a@b.se" }),
      deps((o) => { opts = o; }),
    );
    expect(res.status).toBe(200);
    expect(opts?.attachmentPath).toBe("/tmp/ava-mail/brev.html");
    expect(opts?.subject).toBe("Hej");
    expect(opts?.to).toBe("a@b.se");
  });

  test("avvisar GET", async () => {
    const res = await handleComposeMail(mkRequest("/compose-mail"), deps());
    expect(res.status).toBe(405);
  });

  test("avvisar saknade fält", async () => {
    const res = await handleComposeMail(mailReq({}), deps());
    expect(res.status).toBe(400);
  });

  test("avvisar ogiltig base64", async () => {
    const res = await handleComposeMail(
      mailReq({ fileName: "x.html", contentBase64: "%%%%", subject: "s", body: "b" }),
      deps(),
    );
    expect(res.status).toBe(400);
  });

  test("avvisar path-traversal-filnamn", async () => {
    const res = await handleComposeMail(
      mailReq({ fileName: "../etc/passwd", contentBase64: validContent, subject: "s", body: "b" }),
      deps(),
    );
    expect(res.status).toBe(400);
  });

  test("500 när skrivning av bilaga misslyckas", async () => {
    const failing: ComposeMailDeps = {
      compose: async () => undefined,
      makeSessionDir: async () => "/tmp/ava-mail",
      writeAttachment: async () => { throw new Error("disk full"); },
    };
    const res = await handleComposeMail(
      mailReq({ fileName: "x.html", contentBase64: validContent, subject: "s", body: "b" }),
      failing,
    );
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("write failed");
  });

  test("500 när mail-appen inte kan öppnas", async () => {
    const failing: ComposeMailDeps = {
      compose: async () => { throw new Error("no mail app"); },
      makeSessionDir: async () => "/tmp/ava-mail",
      writeAttachment: async () => undefined,
    };
    const res = await handleComposeMail(
      mailReq({ fileName: "x.html", contentBase64: validContent, subject: "s", body: "b" }),
      failing,
    );
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("compose-mail failed");
  });
});
