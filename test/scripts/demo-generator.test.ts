/**
 * Demo-generatorn (slice: organization → users → contacts via tRPC-API:t).
 *
 * Bevisar "drive the API" (ADR-beslut): populate kör create-mutationerna mot
 * en backend-target (här git/in-memory) med klient-genererade id:n (ADR 0003),
 * och Node-git-writeBack:en skriver ren JSON i rätt git-layout.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { createGitTarget, createPostgresTarget } from "../../tooling/demo-generator/backend-target";
import { makeNodeGitWriteBack } from "../../tooling/demo-generator/node-git-writeback";
import { populate } from "../../tooling/demo-generator/populate";
import type { SeedDataset } from "../../tooling/scripts/seed-data";

const now = new Date("2026-01-01T00:00:00Z");
const tinySeed = {
  organizations: [{ id: "org-test", name: "Testbyrå AB", orgNumber: "556111-0001", createdAt: now, updatedAt: now }],
  users: [{ id: "u-test", email: "anna@test.se", name: "Anna Advokat", role: "ADMIN", hourlyRate: 250_000, organizationId: "org-test", createdAt: now, updatedAt: now }],
  contacts: [{ id: "c-test", name: "Klient AB", contactType: "COMPANY", organizationId: "org-test", createdAt: now, updatedAt: now }],
} as unknown as SeedDataset;

const ADMIN = { id: "gen", email: "gen@ava.local", name: "Generator", role: "ADMIN", organizationId: "org-test" };

describe("demo-generator — populate (org/users/contacts via tRPC)", () => {
  it("skapar entiteterna via create-mutationerna med klient-genererade id:n", async () => {
    const captured: Array<{ entity: string; id: string }> = [];
    const target = createGitTarget({
      principal: ADMIN,
      writeBack: async (e) => { if (e.kind !== "delete") captured.push({ entity: e.entity, id: String(e.row.id) }); },
    });
    const res = await populate(target.caller, tinySeed);
    expect(res).toEqual({ organizations: 1, users: 1, contacts: 1 });
    expect(captured.find((c) => c.entity === "organization")?.id).toBe("org-test");
    expect(captured.find((c) => c.entity === "user")?.id).toBe("u-test");
    expect(captured.find((c) => c.entity === "contact")?.id).toBe("c-test");
  });

  it("läsbar via samma caller (org-scopad list ser kontakten)", async () => {
    const target = createGitTarget({ principal: ADMIN, writeBack: async () => {} });
    await populate(target.caller, tinySeed);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list = await (target.caller as any).contacts.list({ page: 1, pageSize: 10 });
    expect(list.contacts.map((c: { id: string }) => c.id)).toContain("c-test");
  });
});

describe("makeNodeGitWriteBack — git-fillayout med ren JSON", () => {
  it("skriver contact till contacts/<id>.json (strippar joins)", async () => {
    const dir = mkdtempSync(join(os.tmpdir(), "ava-gen-"));
    try {
      const wb = makeNodeGitWriteBack(dir);
      await wb({ entity: "contact", kind: "create", row: { id: "c1", name: "X", contactType: "COMPANY", organizationId: "org-test", createdAt: now, updatedAt: now, matterLinks: [{ joink: "skräp" }] } });
      const p = join(dir, "contacts/c1.json");
      expect(existsSync(p)).toBe(true);
      const data = JSON.parse(readFileSync(p, "utf8"));
      expect(data.id).toBe("c1");
      expect(data.matterLinks).toBeUndefined(); // join strippad av schema.parse
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("createPostgresTarget — stub", () => {
  it("kastar tydligt fel (ADR 0001 Fas 3)", () => {
    expect(() => createPostgresTarget()).toThrow(/Postgres/i);
  });
});
