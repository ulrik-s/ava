/**
 * `createPostgresDb` (#410) — produktions-Postgres-handle. Anslutningen är lat
 * (postgres-js kopplar först vid query) → handle-formen + livscykeln testas
 * utan live-server; den riktiga driver-vägen täcks av repository-sviten mot
 * Postgres (CI:s "Repository (Postgres)"-jobb via `createTestDb`).
 */

import { describe, it, expect } from "vitest-compat";
import { createPostgresDb } from "@/lib/server/db/client";

describe("createPostgresDb", () => {
  it("ger ett { db, close }-handle utan att ansluta (lat connection)", async () => {
    const handle = createPostgresDb("postgres://ava:ava@127.0.0.1:1/ava_test", { max: 1 });
    expect(typeof handle.db.select).toBe("function");
    await expect(handle.close()).resolves.toBeUndefined();
  });

  it("accepterar default-options (ingen max)", async () => {
    const handle = createPostgresDb("postgres://ava:ava@127.0.0.1:1/ava_test");
    expect(handle.db).toBeDefined();
    await handle.close();
  });
});
