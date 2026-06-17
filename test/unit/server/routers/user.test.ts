/**
 * Test för userRouter — list/getById/create/update/delete med org-scoping.
 * Migrerad till repository-sömmen (ADR 0020): projektionen (säkra fält) sker i
 * routern, repot läser hela raden via findFirst/findMany.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import type { IDataStore } from "@/lib/server/data-store/IDataStore";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { userRouter } from "@/lib/server/routers/user";
import { dataStoreFromMockPrisma } from "../helpers/mock-data-store";

const mockPrisma = {
  user: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
};

function callerFor(role: "ADMIN" | "LAWYER" | "ASSISTANT", userId: string, orgId: string) {
  const dataStore = dataStoreFromMockPrisma(mockPrisma as unknown as Record<string, unknown>);
  const ctx = {
    user: { id: userId, email: "a@b.com", name: "Test", role, organizationId: orgId },
    prisma: mockPrisma, dataStore,
    repos: buildInMemoryRepositories(dataStore as unknown as IDataStore),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return userRouter.createCaller(ctx as any);
}

function makeCaller(userId = "user-1", orgId = "org-a") {
  return callerFor("ADMIN", userId, orgId);
}

function makeCallerWithRole(role: "ADMIN" | "LAWYER" | "ASSISTANT", userId = "u1", orgId = "org-a") {
  return callerFor(role, userId, orgId);
}

beforeEach(() => vi.clearAllMocks());

describe("user.list", () => {
  it("returnerar bara användare i samma org", async () => {
    mockPrisma.user.findMany.mockResolvedValue([{ id: "u1", name: "A" }]);
    const res = await makeCaller().list();
    expect(res.users).toHaveLength(1);
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-a" },
      }),
    );
  });

  it("projicerar bara säkra fält (inte passwordHash)", async () => {
    // Repot läser hela raden; routern (pickList) släpper passwordHash/publicKeys.
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "u1", email: "u1@x", name: "A", role: "LAWYER", passwordHash: "secret", publicKeys: [{ fingerprint: "x" }] },
    ]);
    const res = await makeCaller().list();
    const u = res.users[0] as Record<string, unknown>;
    expect(u.passwordHash).toBeUndefined();
    expect(u.publicKeys).toBeUndefined();
    expect(u.email).toBe("u1@x");
    expect(u.name).toBe("A");
  });
});

describe("user.getById", () => {
  it("hämtar med org-scope (findFirst)", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u1", name: "A" });
    await makeCaller().getById({ id: "u1" });
    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u1", organizationId: "org-a" },
      }),
    );
  });

  it("NOT_FOUND när användaren saknas/annan org", async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    await expect(makeCaller().getById({ id: "nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("user.create", () => {
  it("hashar lösenord och skapar användare", async () => {
    mockPrisma.user.create.mockResolvedValue({ id: "new" });
    await makeCaller().create({
      email: "ny@test.se",
      name: "Ny",
      password: "hemligt-lösenord",
    });
    const args = mockPrisma.user.create.mock.calls[0]![0];
    expect(args.data.passwordHash).toBeDefined();
    expect(args.data.passwordHash).not.toBe("hemligt-lösenord"); // bcrypt
    expect(args.data.email).toBe("ny@test.se");
    expect(args.data.organizationId).toBe("org-a");
  });

  it("tillåter användare utan lösenord (Microsoft-only)", async () => {
    mockPrisma.user.create.mockResolvedValue({ id: "new" });
    await makeCaller().create({ email: "x@y.se", name: "Y" });
    const args = mockPrisma.user.create.mock.calls[0]![0];
    expect(args.data.passwordHash).toBeNull();
  });

  it("default-role är LAWYER", async () => {
    mockPrisma.user.create.mockResolvedValue({});
    await makeCaller().create({ email: "x@y.se", name: "Y" });
    const args = mockPrisma.user.create.mock.calls[0]![0];
    expect(args.data.role).toBe("LAWYER");
  });

  it("lagrar ärendenummer-prefix när angivet (#174)", async () => {
    mockPrisma.user.create.mockResolvedValue({});
    await makeCaller().create({ email: "x@y.se", name: "Y", matterNumberPrefix: "AA" });
    const args = mockPrisma.user.create.mock.calls[0]![0];
    expect(args.data.matterNumberPrefix).toBe("AA");
  });

  it("avvisar ogiltigt prefix (gemener/för långt) (#174)", async () => {
    await expect(makeCaller().create({ email: "x@y.se", name: "Y", matterNumberPrefix: "aa" })).rejects.toThrow();
    await expect(makeCaller().create({ email: "x@y.se", name: "Y", matterNumberPrefix: "ABCD" })).rejects.toThrow();
  });

  it("validerar epost-format", async () => {
    await expect(makeCaller().create({ email: "inte-epost", name: "X" })).rejects.toThrow();
  });

  it("kräver lösenord ≥ 6 tecken om angivet", async () => {
    await expect(
      makeCaller().create({ email: "x@y.se", name: "X", password: "kort" }),
    ).rejects.toThrow();
  });
});

describe("user.update", () => {
  it("hashar lösenord när password skickas", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u1", organizationId: "org-a" });
    mockPrisma.user.update.mockResolvedValue({ id: "u1" });
    await makeCaller().update({ id: "u1", password: "nytt-hemligt-pwd" });
    const args = mockPrisma.user.update.mock.calls[0]![0];
    expect(args.data.passwordHash).toBeDefined();
    expect(args.data.password).toBeUndefined();
  });

  it("uppdaterar utan att röra passwordHash om password ej skickas", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u1", organizationId: "org-a" });
    mockPrisma.user.update.mockResolvedValue({});
    await makeCaller().update({ id: "u1", name: "Nytt namn" });
    const args = mockPrisma.user.update.mock.calls[0]![0];
    expect(args.data.passwordHash).toBeUndefined();
    expect(args.data.name).toBe("Nytt namn");
  });

  it("org-scopar ägarkollen (findFirst) innan update", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u1", organizationId: "org-a" });
    mockPrisma.user.update.mockResolvedValue({});
    await makeCaller().update({ id: "u1", name: "X" });
    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "u1", organizationId: "org-a" } }),
    );
  });

  it("NOT_FOUND när användaren tillhör annan org", async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    await expect(makeCaller().update({ id: "u1", name: "X" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});

describe("user.delete", () => {
  it("tar bort användare (org-scopad ägarkoll + hård delete)", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: "other-user", organizationId: "org-a" });
    mockPrisma.user.delete.mockResolvedValue({});
    await makeCaller("admin-1").delete({ id: "other-user" });
    expect(mockPrisma.user.delete).toHaveBeenCalledWith({ where: { id: "other-user" } });
  });

  it("vägrar ta bort sig själv", async () => {
    await expect(
      makeCaller("user-1").delete({ id: "user-1" }),
    ).rejects.toThrow(/inte ta bort dig själv/);
    expect(mockPrisma.user.delete).not.toHaveBeenCalled();
  });
});

// ─── admin-only-kontroll + key-management ────────────────────────────

describe("admin-only checks", () => {
  it("user.create kräver ADMIN", async () => {
    await expect(
      makeCallerWithRole("LAWYER").create({ email: "x@example.com", name: "X" }),
    ).rejects.toThrow(/administratörer/i);
  });

  it("user.deactivate kräver ADMIN", async () => {
    await expect(
      makeCallerWithRole("LAWYER").deactivate({ id: "other" }),
    ).rejects.toThrow(/administratörer/i);
  });

  it("user.delete kräver ADMIN", async () => {
    await expect(
      makeCallerWithRole("LAWYER").delete({ id: "other" }),
    ).rejects.toThrow(/administratörer/i);
  });

  it("user.update.role kräver ADMIN", async () => {
    await expect(
      makeCallerWithRole("LAWYER", "u1").update({ id: "u1", role: "ADMIN" }),
    ).rejects.toThrow(/administratörer/i);
  });

  it("non-admin kan ändra EGEN profil (namn) men inte annans", async () => {
    await expect(
      makeCallerWithRole("LAWYER", "u1").update({ id: "u2", name: "hack" }),
    ).rejects.toThrow(/bara ändra din egen profil/i);
  });
});

describe("user.addKey / removeKey", () => {
  it("addKey läser publicKeys + uppdaterar (tom array → 1 nyckel)", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u1", organizationId: "org-a", publicKeys: [] });
    mockPrisma.user.update.mockResolvedValue({});
    await makeCallerWithRole("LAWYER", "u1").addKey({
      fingerprint: "SHA256:abc", type: "ssh-ed25519", publicKey: "ssh-ed25519 AAAA",
      addedAt: "2026-05-21T00:00:00Z",
    });
    const call = mockPrisma.user.update.mock.calls[0]![0];
    expect(call.data.publicKeys).toHaveLength(1);
    expect(call.data.publicKeys[0].fingerprint).toBe("SHA256:abc");
  });

  it("addKey nekar dubblett-fingerprint", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: "u1", organizationId: "org-a",
      publicKeys: [{ fingerprint: "SHA256:abc", type: "ssh-ed25519", publicKey: "x", addedAt: "..." }],
    });
    await expect(
      makeCallerWithRole("LAWYER", "u1").addKey({
        fingerprint: "SHA256:abc", type: "ssh-ed25519", publicKey: "y", addedAt: "..."
      }),
    ).rejects.toThrow(/finns redan/i);
  });

  it("removeKey filtrerar bort efter fingerprint", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: "u1", organizationId: "org-a",
      publicKeys: [
        { fingerprint: "SHA256:a", type: "ssh-ed25519", publicKey: "x", addedAt: "..." },
        { fingerprint: "SHA256:b", type: "ssh-ed25519", publicKey: "y", addedAt: "..." },
      ],
    });
    mockPrisma.user.update.mockResolvedValue({});
    await makeCallerWithRole("LAWYER", "u1").removeKey({ fingerprint: "SHA256:a" });
    const call = mockPrisma.user.update.mock.calls[0]![0];
    expect(call.data.publicKeys).toHaveLength(1);
    expect(call.data.publicKeys[0].fingerprint).toBe("SHA256:b");
  });
});

describe("user.current", () => {
  it("returnerar ctx.user om saknas i tabellen (demo-läget)", async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    const me = await makeCallerWithRole("ADMIN", "demo-user").current();
    expect(me.id).toBe("demo-user");
    expect(me.publicKeys).toEqual([]);
  });

  it("returnerar databas-rad om finns", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: "u1", organizationId: "org-a", email: "u1@x", name: "U1", title: null, role: "LAWYER",
      hourlyRate: null, mileageRate: null, createdAt: new Date(),
      publicKeys: [{ fingerprint: "SHA256:x", type: "ssh-ed25519", publicKey: "k", addedAt: "..." }],
    });
    const me = await makeCallerWithRole("LAWYER", "u1").current();
    expect(me.publicKeys).toHaveLength(1);
  });
});
