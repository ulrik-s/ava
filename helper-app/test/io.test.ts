import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";

import { downloadTo, uploadFile } from "../src/open.ts";
import { expectRejection } from "./helpers.ts";

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function tmpFile(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ava-io-"));
  dirs.push(dir);
  return join(dir, name);
}

describe("downloadTo (integration)", () => {
  test("laddar ner body till fil", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("PDF-bytes") });
    try {
      const path = await tmpFile("a.pdf");
      await downloadTo(path, `http://127.0.0.1:${server.port}/f`);
      expect(await readFile(path, "utf8")).toBe("PDF-bytes");
    } finally {
      void server.stop(true);
    }
  });

  test("vidarebefordrar Authorization-header", async () => {
    const cap: { auth: string | null } = { auth: null };
    const server = Bun.serve({
      port: 0,
      fetch: (req) => {
        cap.auth = req.headers.get("Authorization");
        return new Response("ok");
      },
    });
    try {
      await downloadTo(await tmpFile("b.txt"), `http://127.0.0.1:${server.port}/f`, "Bearer tok");
      expect(cap.auth).toBe("Bearer tok");
    } finally {
      void server.stop(true);
    }
  });

  test("HTTP >= 400 → kastar", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("no", { status: 404 }) });
    try {
      const err = await expectRejection(downloadTo(await tmpFile("c.txt"), `http://127.0.0.1:${server.port}/f`));
      expect(String(err)).toContain("HTTP 404");
    } finally {
      void server.stop(true);
    }
  });
});

describe("uploadFile (integration)", () => {
  test("PUT:ar fil-bytes med octet-stream + auth", async () => {
    const cap: { body: string; ctype: string | null; auth: string | null } = {
      body: "",
      ctype: null,
      auth: null,
    };
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        cap.body = await req.text();
        cap.ctype = req.headers.get("Content-Type");
        cap.auth = req.headers.get("Authorization");
        return new Response(null, { status: 200 });
      },
    });
    try {
      const path = await tmpFile("upload.bin");
      await writeFile(path, "ÄNDRADE bytes");
      await uploadFile(path, `http://127.0.0.1:${server.port}/u`, "Bearer up");
      expect(cap.body).toBe("ÄNDRADE bytes");
      expect(cap.ctype).toBe("application/octet-stream");
      expect(cap.auth).toBe("Bearer up");
    } finally {
      void server.stop(true);
    }
  });

  test("upload HTTP >= 400 → kastar", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("err", { status: 500 }) });
    try {
      const path = await tmpFile("u2.bin");
      await writeFile(path, "x");
      const err = await expectRejection(uploadFile(path, `http://127.0.0.1:${server.port}/u`, undefined));
      expect(String(err)).toContain("upload HTTP 500");
    } finally {
      void server.stop(true);
    }
  });
});
