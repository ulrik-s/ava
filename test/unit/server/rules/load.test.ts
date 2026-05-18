/**
 * Tester för `PostgresRuleLoader` — hämtar regler från avaRule-tabellen
 * och validerar mot Zod-schemat.
 */

import { describe, it, expect, vi } from "vitest";
import { PostgresRuleLoader } from "@/server/rules/load";

const validRule = {
  id: "r1",
  name: "Test",
  ownerId: "_org",
  enabled: true,
  trigger: { kind: "event", type: "matter.created" },
  steps: [{ do: "audit.log", message: "x" }],
};

interface PrismaMock {
  avaRule: { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
}

function makePrisma(rows: Array<{ id: string; body: unknown }>): PrismaMock {
  return {
    avaRule: {
      findMany: vi.fn().mockResolvedValue(rows),
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
        return rows.find((r) => r.id === where.id) ?? null;
      }),
    },
  };
}

describe("PostgresRuleLoader.loadEnabled", () => {
  it("returnerar parsade regler", async () => {
    const prisma = makePrisma([{ id: "r1", body: validRule }]);
    const loader = new PostgresRuleLoader(prisma as never, "org-1");
    const rules = await loader.loadEnabled();
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe("r1");
  });

  it("filtrerar på org + enabled=true", async () => {
    const prisma = makePrisma([]);
    const loader = new PostgresRuleLoader(prisma as never, "org-1");
    await loader.loadEnabled();
    const args = (prisma.avaRule.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.where.organizationId).toBe("org-1");
    expect(args.where.enabled).toBe(true);
  });

  it("hoppar över trasiga rader (loggar fel)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const prisma = makePrisma([
      { id: "ok", body: validRule },
      { id: "trasig", body: { id: "x", trigger: {} } }, // ofullständig
    ]);
    const loader = new PostgresRuleLoader(prisma as never, "org-1");
    const rules = await loader.loadEnabled();
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe("r1");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("PostgresRuleLoader.loadById", () => {
  it("returnerar parse:ad regel om id matchar org", async () => {
    const prisma = makePrisma([{ id: "r1", body: validRule }]);
    const loader = new PostgresRuleLoader(prisma as never, "org-1");
    const rule = await loader.loadById("r1");
    expect(rule?.id).toBe("r1");
  });

  it("returnerar null om id inte hittas", async () => {
    const prisma = makePrisma([]);
    const loader = new PostgresRuleLoader(prisma as never, "org-1");
    expect(await loader.loadById("ghost")).toBeNull();
  });

  it("returnerar null vid Zod-fel (korrupt body)", async () => {
    const prisma = makePrisma([{ id: "bad", body: { id: "bad" } }]);
    const loader = new PostgresRuleLoader(prisma as never, "org-1");
    expect(await loader.loadById("bad")).toBeNull();
  });
});
