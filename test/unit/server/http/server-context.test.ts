/**
 * `createServerContext` (#410) — server-verifierad principal ur oauth2-proxy-
 * headers + Drizzle-repos (pglite/Postgres via createTestDb).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import { users } from "@/lib/server/db/schema";
import type { AppDb } from "@/lib/server/db/types";
import {
  createServerContext,
  serverFirstEventLog,
} from "@/lib/server/http/server-context";
import { buildDrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import type { Repositories } from "@/lib/server/repositories/repositories";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ORG = uuidv7();
const ANNA = uuidv7();

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://ava.test/api/trpc/user.current", { headers });
}

describe("createServerContext (#410)", () => {
  let handle: TestDbHandle;
  let repos: Repositories;

  beforeAll(async () => {
    handle = await createTestDb();
    repos = buildDrizzleRepositories(handle.db);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await handle.db.insert(users).values(
      v({ id: ANNA, organizationId: ORG, email: "anna@byra.se", name: "Anna", role: "LAWYER", active: true }),
    );
    await handle.db.insert(users).values(
      v({ id: uuidv7(), organizationId: ORG, email: "gamla@byra.se", name: "Gamla", role: "LAWYER", active: false }),
    );
  });
  afterAll(async () => { await handle.close(); });

  const deps = () => ({ repos, ports: noopPorts, organizationId: ORG });

  it("verifierar principalen server-side ur forwarded email-header", async () => {
    const ctx = await createServerContext(req({ "X-Auth-Request-Email": "anna@byra.se" }), deps());
    expect(ctx.user).toMatchObject({ id: ANNA, email: "anna@byra.se", role: "LAWYER", organizationId: ORG });
    expect(ctx.repos).toBe(repos);
  });

  it("ger null-principal utan forwarded identitet (→ UNAUTHORIZED i procedurer)", async () => {
    const ctx = await createServerContext(req({}), deps());
    expect(ctx.user).toBeNull();
  });

  it("nekar okänd email (autentisering ≠ auktorisering)", async () => {
    const ctx = await createServerContext(req({ "X-Auth-Request-Email": "okand@annan.se" }), deps());
    expect(ctx.user).toBeNull();
  });

  it("nekar avprovisionerad (inaktiv) användare", async () => {
    const ctx = await createServerContext(req({ "X-Auth-Request-Email": "gamla@byra.se" }), deps());
    expect(ctx.user).toBeNull();
  });

  it("matchar email case-insensitivt", async () => {
    const ctx = await createServerContext(req({ "X-Auth-Request-Email": "ANNA@Byra.SE" }), deps());
    expect(ctx.user?.id).toBe(ANNA);
  });
});

describe("serverFirstEventLog (#410, ADR 0017/#408 ej byggt)", () => {
  it("emit kastar ReadOnlyError-namngivet fel (sväljs av safeEmit)", async () => {
    await expect(serverFirstEventLog.emit({} as never)).rejects.toMatchObject({ name: "ReadOnlyError" });
  });
  it("query ger tom logg", async () => {
    expect(await serverFirstEventLog.query()).toEqual([]);
  });
});
