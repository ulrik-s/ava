import { describe, expect, test } from "bun:test";

import { createHandler, type ServerDeps } from "../src/server.ts";
import { mkRequest as req } from "./helpers.ts";

function handler(overrides: Partial<ServerDeps> = {}): (req: Request) => Promise<Response> {
  return createHandler({ version: "v1.2.3-test", ...overrides });
}

describe("GET /ping", () => {
  test("returnerar version i text", async () => {
    const res = await handler()(req("/ping"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("ava-helper v1.2.3-test");
  });
});

describe("GET /version", () => {
  test("returnerar current i JSON", async () => {
    const res = await handler()(req("/version"));
    const body = (await res.json()) as { current: string; updateAvailable: boolean };
    expect(body.current).toBe("v1.2.3-test");
    expect(body.updateAvailable).toBe(false);
  });
});

describe("CORS", () => {
  function corsFor(origin: string): Promise<Response> {
    return handler()(req("/ping", { method: "OPTIONS", headers: { Origin: origin } }));
  }

  test("tillåter localhost", async () => {
    const res = await corsFor("http://localhost:3000");
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
  });

  test("tillåter github.io", async () => {
    const res = await corsFor("https://ulrik-s.github.io");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://ulrik-s.github.io");
  });

  test("blockerar okänd origin", async () => {
    const res = await corsFor("https://evil.example.com");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  test("custom origin via extraOrigins", async () => {
    const h = handler({ extraOrigins: ["https://firma.ava.se"] });
    const res = await h(req("/ping", { method: "OPTIONS", headers: { Origin: "https://firma.ava.se" } }));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://firma.ava.se");
  });
});

describe("/open routing", () => {
  test("kräver POST", async () => {
    const res = await handler()(req("/open"));
    expect(res.status).toBe(405);
  });

  test("avvisar ogiltig body", async () => {
    const res = await handler()(req("/open", { method: "POST", body: "not-json" }));
    expect(res.status).toBe(400);
  });

  test("avvisar path-traversal-filnamn", async () => {
    const res = await handler()(
      req("/open", {
        method: "POST",
        body: JSON.stringify({ downloadUrl: "http://x/f", fileName: "../etc/passwd" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("/check-update", () => {
  test("500 när ej konfigurerad", async () => {
    const res = await handler()(req("/check-update", { method: "POST" }));
    expect(res.status).toBe(500);
  });

  test("202 + triggar callback", async () => {
    let called = false;
    const h = handler({ onCheckUpdate: () => { called = true; } });
    const res = await h(req("/check-update", { method: "POST" }));
    expect(res.status).toBe(202);
    expect(called).toBe(true);
  });
});

describe("okänd route", () => {
  test("404", async () => {
    const res = await handler()(req("/nope"));
    expect(res.status).toBe(404);
  });
});
