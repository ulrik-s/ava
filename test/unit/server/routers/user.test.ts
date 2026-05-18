/**
 * Test för userRouter — list/getById/create/update/delete med org-scoping.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { userRouter } from "@/server/routers/user";
import { dataStoreFromMockPrisma } from "../helpers/mock-data-store";

const mockPrisma = {
  user: {
    findMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
};

function makeCaller(userId = "user-1", orgId = "org-a") {
  const ctx = {
    user: { id: userId, email: "a@b.com", name: "Test", role: "ADMIN", organizationId: orgId },
    prisma: mockPrisma, dataStore: dataStoreFromMockPrisma(mockPrisma as unknown as Record<string, unknown>),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return userRouter.createCaller(ctx as any);
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

  it("returnerar bara säkra fält (inte passwordHash)", async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);
    await makeCaller().list();
    const args = mockPrisma.user.findMany.mock.calls[0][0];
    expect(args.select.passwordHash).toBeUndefined();
    expect(args.select.email).toBe(true);
    expect(args.select.name).toBe(true);
  });
});

describe("user.getById", () => {
  it("hämtar med org-scope", async () => {
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue({ id: "u1", name: "A" });
    await makeCaller().getById({ id: "u1" });
    expect(mockPrisma.user.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u1", organizationId: "org-a" },
      }),
    );
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
    const args = mockPrisma.user.create.mock.calls[0][0];
    expect(args.data.passwordHash).toBeDefined();
    expect(args.data.passwordHash).not.toBe("hemligt-lösenord"); // bcrypt
    expect(args.data.email).toBe("ny@test.se");
    expect(args.data.organizationId).toBe("org-a");
  });

  it("tillåter användare utan lösenord (Microsoft-only)", async () => {
    mockPrisma.user.create.mockResolvedValue({ id: "new" });
    await makeCaller().create({ email: "x@y.se", name: "Y" });
    const args = mockPrisma.user.create.mock.calls[0][0];
    expect(args.data.passwordHash).toBeNull();
  });

  it("default-role är LAWYER", async () => {
    mockPrisma.user.create.mockResolvedValue({});
    await makeCaller().create({ email: "x@y.se", name: "Y" });
    const args = mockPrisma.user.create.mock.calls[0][0];
    expect(args.data.role).toBe("LAWYER");
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
    mockPrisma.user.update.mockResolvedValue({ id: "u1" });
    await makeCaller().update({ id: "u1", password: "nytt-hemligt-pwd" });
    const args = mockPrisma.user.update.mock.calls[0][0];
    expect(args.data.passwordHash).toBeDefined();
    expect(args.data.password).toBeUndefined();
  });

  it("uppdaterar utan att röra passwordHash om password ej skickas", async () => {
    mockPrisma.user.update.mockResolvedValue({});
    await makeCaller().update({ id: "u1", name: "Nytt namn" });
    const args = mockPrisma.user.update.mock.calls[0][0];
    expect(args.data.passwordHash).toBeUndefined();
    expect(args.data.name).toBe("Nytt namn");
  });

  it("scopar where på organizationId", async () => {
    mockPrisma.user.update.mockResolvedValue({});
    await makeCaller().update({ id: "u1", name: "X" });
    const args = mockPrisma.user.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: "u1", organizationId: "org-a" });
  });
});

describe("user.delete", () => {
  it("tar bort användare", async () => {
    mockPrisma.user.delete.mockResolvedValue({});
    await makeCaller("admin-1").delete({ id: "other-user" });
    expect(mockPrisma.user.delete).toHaveBeenCalledWith({
      where: { id: "other-user", organizationId: "org-a" },
    });
  });

  it("vägrar ta bort sig själv", async () => {
    await expect(
      makeCaller("user-1").delete({ id: "user-1" }),
    ).rejects.toThrow(/inte ta bort dig själv/);
    expect(mockPrisma.user.delete).not.toHaveBeenCalled();
  });
});
