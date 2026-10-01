/**
 * Test för userRouter — list/getById/create/update/delete med org-scoping.
 * Migrerad till repository-sömmen (ADR 0020): projektionen (säkra fält) sker i
 * routern, repot läser hela raden via findFirst/findMany.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { userRouter } from "@/lib/server/routers/user";
import { arraySink, setLogSink, type LogRecord } from "@/lib/shared/observability/logger";
import { dataStoreFromMockPrisma, reposFromMockDataStore } from "../helpers/mock-data-store";

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
  const dataStore = dataStoreFromMockPrisma(mockPrisma);
  const ctx = {
    user: { id: userId, email: "a@b.com", name: "Test", role, organizationId: orgId },
    prisma: mockPrisma, dataStore,
    repos: reposFromMockDataStore(dataStore),
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

beforeEach(() => {
  vi.clearAllMocks();
  // Ingen annan användare har adressen (#1408) — testerna nedan sätter dubbletter själva.
  mockPrisma.user.findMany.mockResolvedValue([]);
});

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
    // Repot läser hela raden; routern (pickList) släpper passwordHash.
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "u1", email: "u1@x", name: "A", role: "LAWYER", passwordHash: "secret" },
    ]);
    const res = await makeCaller().list();
    const u = res.users[0] as Record<string, unknown>;
    expect(u.passwordHash).toBeUndefined();
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

  it("returnerar juristens timpriser per kategori; saknas de → tom karta (#1206)", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u1", name: "A", hourlyRates: { ARBETE: 300000 } });
    expect((await makeCaller().getById({ id: "u1" })).hourlyRates).toEqual({ ARBETE: 300000 });
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u1", name: "A" });
    expect((await makeCaller().getById({ id: "u1" })).hourlyRates).toEqual({});
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

  it("lagrar timpriser per kategori när angivna; annars sätts inget (ärver byråns, #1206)", async () => {
    mockPrisma.user.create.mockResolvedValue({});
    await makeCaller().create({ email: "x@y.se", name: "Y", hourlyRates: { ARBETE: 300000, TIDSSPILLAN: 150000 } });
    expect(mockPrisma.user.create.mock.calls[0]![0].data.hourlyRates).toEqual({ ARBETE: 300000, TIDSSPILLAN: 150000 });
    await makeCaller().create({ email: "z@y.se", name: "Z" });
    expect(mockPrisma.user.create.mock.calls[1]![0].data.hourlyRates).toBeUndefined();
    await expect(makeCaller().create({ email: "q@y.se", name: "Q", hourlyRates: { ARBETE: -1 } })).rejects.toThrow();
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

  it("ersätter hela timpris-kartan (#1206)", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u1", organizationId: "org-a" });
    mockPrisma.user.update.mockResolvedValue({});
    await makeCaller().update({ id: "u1", hourlyRates: { TIDSSPILLAN_OVRIG_TID: 97500 } });
    expect(mockPrisma.user.update.mock.calls[0]![0].data.hourlyRates).toEqual({ TIDSSPILLAN_OVRIG_TID: 97500 });
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

describe("user.current", () => {
  it("returnerar ctx.user om saknas i tabellen (demo-läget)", async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    const me = await makeCallerWithRole("ADMIN", "demo-user").current();
    expect(me.id).toBe("demo-user");
    expect(me.hourlyRates).toEqual({});
  });

  it("returnerar databas-rad om finns", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: "u1", organizationId: "org-a", email: "u1@x", name: "U1", title: null, role: "LAWYER",
      hourlyRates: { ARBETE: 250000 }, mileageRate: null, createdAt: new Date(),
    });
    const me = await makeCallerWithRole("LAWYER", "u1").current();
    expect(me.id).toBe("u1");
    expect(me.hourlyRates).toEqual({ ARBETE: 250000 });
  });
});

/**
 * E-posten är inloggningens identitet (#1371): OIDC matchar på den, så den som
 * byter den pekar om kontot. Bara admin byter den, och bytet loggas.
 */
describe("user.update — e-post ändras bara av admin (#1371)", () => {
  const STORED = { id: "u1", organizationId: "org-a", email: "anna@firma.se", name: "Anna", role: "LAWYER" };

  function adminWithEvents() {
    const dataStore = dataStoreFromMockPrisma(mockPrisma);
    const ctx = {
      user: { id: "admin-1", email: "admin@firma.se", name: "Admin", role: "ADMIN", organizationId: "org-a" },
      prisma: mockPrisma, dataStore, repos: reposFromMockDataStore(dataStore),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { caller: userRouter.createCaller(ctx as any), events: dataStore.events };
  }

  it.each(["LAWYER", "ASSISTANT"] as const)("%s: byte av sin egen e-post nekas (FORBIDDEN) och inget skrivs", async (role) => {
    mockPrisma.user.findFirst.mockResolvedValue(STORED);
    await expect(makeCallerWithRole(role, "u1").update({ id: "u1", email: "kapad@annan.se" }))
      .rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringMatching(/inloggningen/) });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("LAWYER: samma adress i annat skiftläge räknas som oförändrad — profilen sparas", async () => {
    mockPrisma.user.findFirst.mockResolvedValue(STORED);
    mockPrisma.user.update.mockResolvedValue({ ...STORED, name: "Anna Ny" });
    await makeCallerWithRole("LAWYER", "u1").update({ id: "u1", name: "Anna Ny", email: "Anna@Firma.se" });
    expect(mockPrisma.user.update).toHaveBeenCalled();
  });

  it("ADMIN: byter en kollegas e-post — skrivs, loggas (bara id:n) och blir en händelse", async () => {
    const records: LogRecord[] = [];
    const restore = setLogSink(arraySink(records));
    try {
      mockPrisma.user.findFirst.mockResolvedValue(STORED);
      mockPrisma.user.update.mockResolvedValue({ ...STORED, email: "anna.ny@firma.se" });
      const { caller, events } = adminWithEvents();
      await caller.update({ id: "u1", email: "anna.ny@firma.se" });
      expect(mockPrisma.user.update.mock.calls[0]![0].data.email).toBe("anna.ny@firma.se");
      expect(records).toContainEqual(expect.objectContaining({ event: "user.email_changed", userId: "admin-1", orgId: "org-a", ids: ["u1"] }));
      expect(JSON.stringify(records)).not.toContain("anna.ny@firma.se");
      expect(events.emit).toHaveBeenCalledWith(expect.objectContaining({
        type: "user.action", payload: { action: "user.email_changed", targetUserId: "u1" },
      }));
    } finally {
      setLogSink(restore);
    }
  });

  it("ADMIN: oförändrad e-post loggas inte som byte", async () => {
    const records: LogRecord[] = [];
    const restore = setLogSink(arraySink(records));
    try {
      mockPrisma.user.findFirst.mockResolvedValue(STORED);
      mockPrisma.user.update.mockResolvedValue(STORED);
      await adminWithEvents().caller.update({ id: "u1", name: "Anna", email: "anna@firma.se" });
      expect(records.some((r) => r.event === "user.email_changed")).toBe(false);
    } finally {
      setLogSink(restore);
    }
  });
});

// #1408: e-postadressen är inloggningen — ett konto per adress, i alla byråer.
describe("e-postadressen är unik över alla byråer (#1408)", () => {
  const TAKEN = { id: "other", organizationId: "org-b", email: "anna@firma.se", name: "Anna i byrå B", role: "LAWYER" };

  it("create: adressen finns redan (i en annan byrå, annat skiftläge) → CONFLICT och inget skapas", async () => {
    mockPrisma.user.findMany.mockResolvedValue([TAKEN]);
    await expect(makeCaller().create({ email: "Anna@Firma.se", name: "Anna" }))
      .rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/används redan av ett annat konto/) });
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it("create: en omkörning av samma köade anrop (samma id) är ingen dubblett", async () => {
    mockPrisma.user.findMany.mockResolvedValue([{ ...TAKEN, id: "u-new" }]);
    mockPrisma.user.create.mockResolvedValue({ id: "u-new" });
    await makeCaller().create({ id: "u-new", email: "anna@firma.se", name: "Anna" });
    expect(mockPrisma.user.create).toHaveBeenCalled();
  });

  it("update: admin byter till en adress som ett annat konto har → CONFLICT och inget skrivs", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u1", organizationId: "org-a", email: "bo@firma.se", name: "Bo", role: "LAWYER" });
    mockPrisma.user.findMany.mockResolvedValue([TAKEN]);
    await expect(makeCaller("admin-1").update({ id: "u1", email: "anna@firma.se" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});
