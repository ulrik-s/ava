/**
 * InterrogationRepository-paritet (#1855, ADR 0020) — samma scenario mot
 * in-memory och Drizzle (pglite): ärendets förhör äldst först, byrå-
 * avgränsning, mjuk borttagning.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { matters } from "@/lib/server/db/schema";
import { DrizzleInterrogationRepository } from "@/lib/server/repositories/drizzle-interrogation-repository";
import { InMemoryInterrogationRepository } from "@/lib/server/repositories/in-memory-interrogation-repository";
import type { InterrogationRepository } from "@/lib/server/repositories/interrogation-repository";
import { asId, type InterrogationId, type MatterId, type OrganizationId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const at = (hhmm: string): Date => new Date(`2026-10-01T${hhmm}:00.000Z`);

interface Ctx { org: OrganizationId; other: OrganizationId; matter: MatterId; matter2: MatterId }

async function scenario(repo: InterrogationRepository, c: Ctx): Promise<void> {
  const make = async (matterId: MatterId, start: string, end: string, organizationId = c.org): Promise<InterrogationId> => {
    const row = await repo.create({ id: asId<"InterrogationId">(uuidv7()), organizationId, matterId, start: at(start), end: at(end), pauses: [] });
    return row.id;
  };
  const late = await make(c.matter, "14:00", "15:00");
  const early = await make(c.matter, "08:00", "09:00");
  const gone = await make(c.matter, "10:00", "11:00");
  await make(c.matter2, "08:00", "09:00");
  await make(c.matter, "07:00", "08:00", c.other);
  await repo.softDelete(gone);

  const list = await repo.listForMatter(c.org, c.matter);
  expect(list.map((r) => r.id)).toEqual([early, late]);
  expect(await repo.getByIdInOrg(early, c.org)).toMatchObject({ id: early });
  expect(await repo.getByIdInOrg(early, c.other)).toBeNull();
  expect(await repo.getByIdInOrg(gone, c.org)).toBeNull();
}

function ids(): Ctx {
  return {
    org: asId<"OrganizationId">(uuidv7()), other: asId<"OrganizationId">(uuidv7()),
    matter: asId<"MatterId">(uuidv7()), matter2: asId<"MatterId">(uuidv7()),
  };
}

describe("InterrogationRepository — in-memory", () => {
  it("listForMatter äldst först, byrå och mjuk borttagning; getByIdInOrg", async () => {
    const c = ids();
    const store = new LocalStore({}, async () => {});
    await scenario(new InMemoryInterrogationRepository(store), c);
  });
});

describe("InterrogationRepository — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("listForMatter äldst först, byrå och mjuk borttagning; getByIdInOrg", async () => {
    const c = ids();
    for (const id of [c.matter, c.matter2]) {
      await handle.db.insert(matters).values({ id, organizationId: c.org, matterNumber: `2026-${id.slice(-4)}`, title: "T", version: 1 });
    }
    await scenario(new DrizzleInterrogationRepository(handle.db), c);
  });
});
