/**
 * `canonicalRows` (#1276, #1348, #1674): radernas kanoniska läge efter en
 * omkörning. Ett anrop kan röra tusentals rader; de läses i omgångar och
 * ALLA kommer med, i samma ordning.
 */
import { describe, expect, it } from "vitest-compat";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { MAX_ROW_REFS } from "@/lib/server/data-store/in-memory/sync-transport";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { canonicalRows } from "@/lib/server/sync/entity-repo";
import { uuidv7 } from "@/lib/shared/uuid";

describe("canonicalRows", () => {
  it("fler rader än en omgång: alla kommer med i ordning; okända blir tombstones, osynkade hoppas", async () => {
    const repos = buildInMemoryRepositories(new DemoDataStore({}));
    const refs = Array.from({ length: MAX_ROW_REFS * 2 + 50 }, () => ({ entity: "timeEntry", id: uuidv7() }));
    const out = await canonicalRows(repos, [...refs, { entity: "finnsInte", id: uuidv7() }], uuidv7());
    expect(out).toHaveLength(refs.length);
    expect(out.map((c) => c.row.id)).toEqual(refs.map((r) => r.id));
    expect(out.every((c) => c.deleted === true)).toBe(true);
  });
});
