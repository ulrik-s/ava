/**
 * Tester för Credentials-providerns authorize-callback.
 * Mockar prisma.user.findUnique och bcryptjs.compare.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const findUniqueMock = vi.fn();
const compareMock = vi.fn();

vi.mock("@/server/db", () => ({
  prisma: {
    user: { findUnique: (...a: unknown[]) => findUniqueMock(...a) },
  },
}));

vi.mock("bcryptjs", () => ({
  compare: (...a: unknown[]) => compareMock(...a),
}));

const resolveAzureUserMock = vi.fn();
vi.mock("@/lib/azure-provisioning", () => ({
  resolveAzureUser: (...a: unknown[]) => resolveAzureUserMock(...a),
}));

import { authOptions } from "@/lib/auth";

type AuthorizeFn = (
  creds: Record<string, string> | undefined,
) => Promise<unknown>;

function getAuthorize(): AuthorizeFn {
  // CredentialsProvider is the last provider (azure may or may not be configured)
  const providers = authOptions.providers as Array<{
    id?: string;
    name?: string;
    authorize?: AuthorizeFn;
    options?: { authorize?: AuthorizeFn };
  }>;
  const creds = providers.find((p) => p.name === "Credentials" || p.id === "credentials");
  // next-auth lägger användarens authorize i options.authorize; topp-fältet är defaulten
  const fn = creds?.options?.authorize ?? creds?.authorize;
  if (!fn) throw new Error("CredentialsProvider not found");
  return fn;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("auth – credentials authorize", () => {
  const baseUser = {
    id: "u1",
    email: "anna@example.com",
    name: "Anna",
    role: "LAWYER",
    organizationId: "org1",
    passwordHash: "hash",
  };

  it("returnerar null när email saknas", async () => {
    const authorize = getAuthorize();
    const result = await authorize({ password: "x" });
    expect(result).toBeNull();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("returnerar null när password saknas", async () => {
    const authorize = getAuthorize();
    const result = await authorize({ email: "a@b" });
    expect(result).toBeNull();
  });

  it("returnerar null när credentials är undefined", async () => {
    const authorize = getAuthorize();
    const result = await authorize(undefined);
    expect(result).toBeNull();
  });

  it("returnerar null när användaren inte finns", async () => {
    findUniqueMock.mockResolvedValue(null);
    const authorize = getAuthorize();
    const result = await authorize({ email: "nope@x", password: "p" });
    expect(result).toBeNull();
    expect(findUniqueMock).toHaveBeenCalledWith({ where: { email: "nope@x" } });
    expect(compareMock).not.toHaveBeenCalled();
  });

  it("returnerar null när användaren saknar passwordHash", async () => {
    findUniqueMock.mockResolvedValue({ ...baseUser, passwordHash: null });
    const authorize = getAuthorize();
    const result = await authorize({ email: "a@b", password: "p" });
    expect(result).toBeNull();
    expect(compareMock).not.toHaveBeenCalled();
  });

  it("returnerar null när bcrypt.compare ger false", async () => {
    findUniqueMock.mockResolvedValue(baseUser);
    compareMock.mockResolvedValue(false);
    const authorize = getAuthorize();
    const result = await authorize({ email: "anna@example.com", password: "wrong" });
    expect(result).toBeNull();
    expect(compareMock).toHaveBeenCalledWith("wrong", "hash");
  });

  it("returnerar user-objekt vid lyckad inloggning", async () => {
    findUniqueMock.mockResolvedValue(baseUser);
    compareMock.mockResolvedValue(true);
    const authorize = getAuthorize();
    const result = await authorize({ email: "anna@example.com", password: "secret" });
    expect(result).toEqual({
      id: "u1",
      email: "anna@example.com",
      name: "Anna",
      role: "LAWYER",
      organizationId: "org1",
    });
  });

  it("läcker inte passwordHash i returvärdet", async () => {
    findUniqueMock.mockResolvedValue(baseUser);
    compareMock.mockResolvedValue(true);
    const authorize = getAuthorize();
    const result = (await authorize({ email: "a@b", password: "p" })) as Record<string, unknown>;
    expect(result).not.toHaveProperty("passwordHash");
  });
});

describe("auth – jwt callback", () => {
  it("kopierar user-fält till token vid första inloggning", async () => {
    const cb = authOptions.callbacks!.jwt!;
    const token = await cb({
      token: { sub: "u1" } as never,
      user: { id: "u1", role: "ADMIN", organizationId: "org1" } as never,
    } as never);
    expect((token as Record<string, unknown>).id).toBe("u1");
    expect((token as Record<string, unknown>).role).toBe("ADMIN");
    expect((token as Record<string, unknown>).organizationId).toBe("org1");
  });

  it("returnerar token oförändrad när user saknas (refresh)", async () => {
    const cb = authOptions.callbacks!.jwt!;
    const token = await cb({
      token: { id: "u1", role: "LAWYER", organizationId: "org1" } as never,
    } as never);
    expect((token as Record<string, unknown>).id).toBe("u1");
  });
});

describe("auth – session callback", () => {
  it("kopierar token-fält till session.user", async () => {
    const cb = authOptions.callbacks!.session!;
    const result = await cb({
      session: { user: {}, expires: "2099-01-01" } as never,
      token: {
        id: "u1",
        email: "a@b",
        name: "Anna",
        role: "LAWYER",
        organizationId: "org1",
      } as never,
    } as never);
    expect(result.user).toEqual({
      id: "u1",
      email: "a@b",
      name: "Anna",
      role: "LAWYER",
      organizationId: "org1",
    });
  });
});

describe("auth – signIn callback (Azure AD)", () => {
  function call(args: { account?: unknown; profile?: unknown; user?: unknown }) {
    const cb = authOptions.callbacks!.signIn!;
    return cb({
      account: args.account ?? null,
      profile: args.profile,
      user: args.user ?? {},
    } as never);
  }

  it("släpper igenom credentials-flödet utan att röra Azure", async () => {
    const result = await call({ account: { provider: "credentials" } });
    expect(result).toBe(true);
    expect(resolveAzureUserMock).not.toHaveBeenCalled();
  });

  it("släpper igenom när account saknas", async () => {
    const result = await call({});
    expect(result).toBe(true);
  });

  it("returnerar MissingClaims när oid saknas", async () => {
    const result = await call({
      account: { provider: "azure-ad" },
      profile: { tid: "t1" },
    });
    expect(result).toBe("/login?error=MissingClaims");
  });

  it("returnerar MissingClaims när tid saknas", async () => {
    const result = await call({
      account: { provider: "azure-ad" },
      profile: { oid: "o1" },
    });
    expect(result).toBe("/login?error=MissingClaims");
  });

  it("returnerar MissingEmail när varken email eller preferred_username finns", async () => {
    const result = await call({
      account: { provider: "azure-ad" },
      profile: { oid: "o1", tid: "t1", name: "Test" },
    });
    expect(result).toBe("/login?error=MissingEmail");
  });

  it("använder preferred_username som email-fallback och berikar user-objektet", async () => {
    resolveAzureUserMock.mockResolvedValue({
      ok: true, userId: "u1", organizationId: "org1", role: "LAWYER",
    });
    const user: Record<string, unknown> = {};
    const result = await call({
      account: { provider: "azure-ad" },
      profile: { oid: "o1", tid: "t1", preferred_username: "anna@upn.se", name: "Anna" },
      user,
    });
    expect(result).toBe(true);
    expect(resolveAzureUserMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      email: "anna@upn.se",
      name: "Anna",
    }));
    expect(user.id).toBe("u1");
    expect(user.role).toBe("LAWYER");
    expect(user.organizationId).toBe("org1");
    expect(user.email).toBe("anna@upn.se");
  });

  it("faller tillbaka till email som name när name saknas", async () => {
    resolveAzureUserMock.mockResolvedValue({
      ok: true, userId: "u1", organizationId: "org1", role: "LAWYER",
    });
    await call({
      account: { provider: "azure-ad" },
      profile: { oid: "o1", tid: "t1", email: "a@b" },
      user: {},
    });
    expect(resolveAzureUserMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      name: "a@b",
    }));
  });

  it("returnerar WrongTenant-redirect när resolveAzureUser nekar tenant", async () => {
    resolveAzureUserMock.mockResolvedValue({ ok: false, reason: "WRONG_TENANT" });
    const result = await call({
      account: { provider: "azure-ad" },
      profile: { oid: "o1", tid: "evil", email: "a@b" },
    });
    expect(result).toBe("/login?error=WrongTenant");
  });

  it("returnerar NotInvited-redirect", async () => {
    resolveAzureUserMock.mockResolvedValue({ ok: false, reason: "NOT_INVITED" });
    const result = await call({
      account: { provider: "azure-ad" },
      profile: { oid: "o1", tid: "t1", email: "a@b" },
    });
    expect(result).toBe("/login?error=NotInvited");
  });

  it("returnerar MissingEmail-redirect från azure-resolve", async () => {
    resolveAzureUserMock.mockResolvedValue({ ok: false, reason: "MISSING_EMAIL" });
    const result = await call({
      account: { provider: "azure-ad" },
      profile: { oid: "o1", tid: "t1", email: "a@b" },
    });
    expect(result).toBe("/login?error=MissingEmail");
  });
});
