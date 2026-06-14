import { createServer } from "node:net";
import { describe, it, expect } from "vitest-compat";
import {
  interpretPreflight,
  dockerAvailable,
  portFree,
} from "../../tooling/scripts/install-server/preflight";

describe("interpretPreflight", () => {
  it("alla ok → inga fel", () => {
    expect(interpretPreflight([{ name: "docker", ok: true }, { name: "port 8080", ok: true }])).toEqual({
      ok: true,
      errors: [],
    });
  });

  it("samlar fel med hint", () => {
    const out = interpretPreflight([
      { name: "docker", ok: false, hint: "docker saknas" },
      { name: "port 8080", ok: true },
    ]);
    expect(out.ok).toBe(false);
    expect(out.errors).toEqual(["docker: docker saknas"]);
  });
});

describe("dockerAvailable", () => {
  it("status 0 → tillgängligt", async () => {
    expect(await dockerAvailable(() => ({ status: 0 }))).toBe(true);
  });
  it("status !=0 / saknas → ej tillgängligt", async () => {
    expect(await dockerAvailable(() => ({ status: 127 }))).toBe(false);
    expect(await dockerAvailable(() => ({ status: null }))).toBe(false);
  });
});

describe("portFree", () => {
  it("upptagen port → false, ledig → true", async () => {
    const server = createServer();
    await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
    const port = (server.address() as { port: number }).port;
    try {
      expect(await portFree(port)).toBe(false); // vi håller porten
    } finally {
      await new Promise<void>((res) => server.close(() => res()));
    }
    // Samma port är ledig igen efter close
    expect(await portFree(port)).toBe(true);
  });
});
