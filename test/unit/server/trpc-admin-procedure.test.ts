/**
 * `adminProcedure` (#1947): `orgProcedure` som bara släpper igenom
 * administratörer. Samma fel som `assertAdmin` gav i handlern, och
 * kontrollen ligger före indatavalideringen.
 */

import { describe, it, expect } from "vitest-compat";
import { z } from "zod";
import { adminProcedure, router, type Context } from "@/lib/server/trpc-core";
import { asId } from "@/lib/shared/schemas/ids";
import { mockStoreAndRepos } from "./helpers/mock-data-store";

const testRouter = router({
  orgOf: adminProcedure
    .input(z.object({ n: z.number() }))
    .query(({ ctx, input }) => ({ orgId: ctx.orgId, n: input.n })),
});

function caller(role: "ADMIN" | "LAWYER") {
  const { dataStore, repos } = mockStoreAndRepos({});
  const user: Context["user"] = {
    id: asId<"UserId">("u-1"),
    email: "a@example.com",
    name: "Test",
    role,
    organizationId: asId<"OrganizationId">("org-1"),
  };
  // Testet anropar inga portar; en tom portmängd räcker (som i trpc-logging.test.ts).
  return testRouter.createCaller({ dataStore, repos, user, ports: {} as Context["ports"] });
}

describe("adminProcedure", () => {
  it("släpper igenom en admin och ger ctx.orgId", async () => {
    expect(await caller("ADMIN").orgOf({ n: 1 })).toEqual({ orgId: "org-1", n: 1 });
  });

  it("ger en icke-admin FORBIDDEN med dagens text", async () => {
    await expect(caller("LAWYER").orgOf({ n: 1 })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Endast administratörer kan göra det här.",
    });
  });

  it("ger en icke-admin FORBIDDEN också med ogiltig indata (inte BAD_REQUEST)", async () => {
    // @ts-expect-error -- medvetet ogiltig indata
    await expect(caller("LAWYER").orgOf({ n: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("validerar fortfarande indata för en admin", async () => {
    // @ts-expect-error -- medvetet ogiltig indata
    await expect(caller("ADMIN").orgOf({ n: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
