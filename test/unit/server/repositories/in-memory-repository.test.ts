/**
 * InMemoryRepository (ADR 0020, #409 Fas 1) — bas-CRUD ovanpå en LocalStore-
 * delegate: getById (mjuk-delete-filter), create (version=1), update (version-
 * bump + updatedAt), softDelete (deletedAt + tombstone-bump).
 */

import { describe, it, expect } from "vitest-compat";
import type { Delegate } from "@/lib/server/data-store/IDataStore";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { InMemoryRepository } from "@/lib/server/repositories/in-memory-repository";
import type { RowBase } from "@/lib/server/repositories/types";

const NOW = new Date("2026-06-16T12:00:00.000Z");

interface UserRow extends RowBase { name: string }

function makeRepo(seed: UserRow[] = []) {
  const store = new LocalStore({ users: seed as unknown as Record<string, unknown>[] }, async () => {});
  return new InMemoryRepository<UserRow>(store.users as unknown as Delegate, () => NOW);
}

describe("InMemoryRepository", () => {
  it("getById returnerar raden; okänt id → null", async () => {
    const repo = makeRepo([{ id: "u1", name: "Anna", version: 1 }]);
    expect(await repo.getById("u1")).toMatchObject({ name: "Anna" });
    expect(await repo.getById("saknas")).toBeNull();
  });

  it("getById filtrerar bort mjukraderade rader", async () => {
    const repo = makeRepo([{ id: "u1", name: "Borta", version: 1, deletedAt: NOW }]);
    expect(await repo.getById("u1")).toBeNull();
  });

  it("getByIdOrThrow kastar för okänt id", async () => {
    await expect(makeRepo().getByIdOrThrow("x")).rejects.toThrow(/Ingen rad/);
  });

  it("create sätter version=1", async () => {
    const repo = makeRepo();
    const row = await repo.create({ id: "u2", name: "Bo" });
    expect(row).toMatchObject({ id: "u2", name: "Bo", version: 1 });
    expect(await repo.getById("u2")).toMatchObject({ name: "Bo" });
  });

  it("update bumpar version + sätter updatedAt", async () => {
    const repo = makeRepo([{ id: "u1", name: "Anna", version: 2 }]);
    const row = await repo.update("u1", { name: "Anna II" });
    expect(row.name).toBe("Anna II");
    expect(row.version).toBe(3);
    // In-memory-delegaten sätter sin egen updatedAt (Drizzle-impl:en använder repo:ns now()).
    expect(row.updatedAt).toBeInstanceOf(Date);
  });

  it("updateMetadata uppdaterar fält + updatedAt MEN bumpar INTE version", async () => {
    const repo = makeRepo([{ id: "u1", name: "Anna", version: 2 }]);
    const row = await repo.updateMetadata("u1", { name: "Anna (metadata)" });
    expect(row.name).toBe("Anna (metadata)");
    expect(row.version).toBe(2); // oförändrad — metadata-skrivning, ingen innehållsändring
    expect(row.updatedAt).toBeInstanceOf(Date);
  });

  it("softDelete sätter deletedAt + bumpar version, raden försvinner ur getById", async () => {
    const repo = makeRepo([{ id: "u1", name: "Anna", version: 1 }]);
    const row = await repo.softDelete("u1");
    expect(row.deletedAt).toBe(NOW);
    expect(row.version).toBe(2);
    expect(await repo.getById("u1")).toBeNull();
  });
});
