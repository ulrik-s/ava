import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveAzureUser, type AzureProfile } from "@/client/lib/azure-provisioning";

// ─── Helpers ─────────────────────────────────────────────────────

const mockPrisma = {
  organization: {
    findUnique: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
};

function profile(overrides: Partial<AzureProfile> = {}): AzureProfile {
  return {
    oid: "oid-anna-123",
    tid: "tenant-byra",
    email: "anna@byra.se",
    name: "Anna Advokat",
    ...overrides,
  };
}

const ORG = { id: "org-a" };
const USER_INVITED = {
  id: "user-anna",
  organizationId: "org-a",
  role: "LAWYER",
  email: "anna@byra.se",
  azureOid: null,
};
const USER_LINKED = { ...USER_INVITED, azureOid: "oid-anna-123" };

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Happy path: återkommande login via oid ─────────────────────

describe("resolveAzureUser — återkommande inloggning (matchar på azureOid)", () => {
  it("returnerar ok och uppdaterar lastLoginAt", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(ORG);
    mockPrisma.user.findUnique.mockResolvedValue(USER_LINKED);
    mockPrisma.user.update.mockResolvedValue(USER_LINKED);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await resolveAzureUser(mockPrisma as any, profile());

    expect(result).toEqual({
      ok: true,
      userId: "user-anna",
      organizationId: "org-a",
      role: "LAWYER",
    });
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-anna" },
      data: { lastLoginAt: expect.any(Date) },
    });
    // Primär oid-sökning användes, fallback på e-post ska inte ha triggats.
    expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
  });
});

// ─── First-time link: användare inbjuden men ej länkad ──────────

describe("resolveAzureUser — första login efter inbjudan (matchar på e-post)", () => {
  it("länkar azureOid på matchande inbjuden användare", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(ORG);
    mockPrisma.user.findUnique.mockResolvedValue(null); // ingen oid-match än
    mockPrisma.user.findFirst.mockResolvedValue(USER_INVITED);
    mockPrisma.user.update.mockResolvedValue({ ...USER_INVITED, azureOid: "oid-anna-123" });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await resolveAzureUser(mockPrisma as any, profile());

    expect(result).toEqual({
      ok: true,
      userId: "user-anna",
      organizationId: "org-a",
      role: "LAWYER",
    });
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-anna" },
      data: { azureOid: "oid-anna-123", lastLoginAt: expect.any(Date) },
    });
  });

  it("är skiftlägesokänslig för e-post", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(ORG);
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.findFirst.mockResolvedValue(USER_INVITED);
    mockPrisma.user.update.mockResolvedValue(USER_INVITED);

    await resolveAzureUser(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockPrisma as any,
      profile({ email: "Anna@Byra.SE" }),
    );

    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        email: { equals: "anna@byra.se", mode: "insensitive" },
        organizationId: "org-a",
      }),
      select: expect.any(Object),
    });
  });
});

// ─── Säkerhet: fel tenant ────────────────────────────────────────

describe("resolveAzureUser — säkerhetskontroller", () => {
  it("nekar inloggning när tenant-id inte matchar någon organisation", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(null);

    const result = await resolveAzureUser(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockPrisma as any,
      profile({ tid: "fientlig-tenant" }),
    );

    expect(result).toEqual({ ok: false, reason: "WRONG_TENANT" });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("nekar inloggning om e-post saknas i token", async () => {
    const result = await resolveAzureUser(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockPrisma as any,
      profile({ email: "" }),
    );

    expect(result).toEqual({ ok: false, reason: "MISSING_EMAIL" });
    expect(mockPrisma.organization.findUnique).not.toHaveBeenCalled();
  });

  it("nekar inloggning när användaren inte är inbjuden (ingen e-postmatch)", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(ORG);
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.findFirst.mockResolvedValue(null);

    const result = await resolveAzureUser(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockPrisma as any,
      profile({ email: "hacker@byra.se" }),
    );

    expect(result).toEqual({ ok: false, reason: "NOT_INVITED" });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("nekar inloggning om oid-matchande användare tillhör annan org", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(ORG);
    mockPrisma.user.findUnique.mockResolvedValue({
      ...USER_LINKED,
      organizationId: "org-b", // matchar inte tenantens org
    });

    const result = await resolveAzureUser(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockPrisma as any,
      profile(),
    );

    expect(result).toEqual({ ok: false, reason: "NOT_INVITED" });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("nekar när e-post matchar men azureOid redan tillhör annan identitet", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(ORG);
    mockPrisma.user.findUnique.mockResolvedValue(null); // inkommande oid har ingen match
    mockPrisma.user.findFirst.mockResolvedValue({
      ...USER_INVITED,
      azureOid: "nagon-annans-oid", // redan kopplad till annan Microsoft-användare
    });

    const result = await resolveAzureUser(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockPrisma as any,
      profile(),
    );

    expect(result).toEqual({ ok: false, reason: "NOT_INVITED" });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});

// ─── Filterlogik: tenant → org-bindning ─────────────────────────

describe("resolveAzureUser — filter och queries", () => {
  it("slår upp organisation på exakt tenant-id", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(ORG);
    mockPrisma.user.findUnique.mockResolvedValue(USER_LINKED);
    mockPrisma.user.update.mockResolvedValue(USER_LINKED);

    await resolveAzureUser(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockPrisma as any,
      profile({ tid: "tenant-byra" }),
    );

    expect(mockPrisma.organization.findUnique).toHaveBeenCalledWith({
      where: { azureTenantId: "tenant-byra" },
      select: { id: true },
    });
  });

  it("slår upp användare på azureOid först", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(ORG);
    mockPrisma.user.findUnique.mockResolvedValue(USER_LINKED);
    mockPrisma.user.update.mockResolvedValue(USER_LINKED);

    await resolveAzureUser(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockPrisma as any,
      profile(),
    );

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { azureOid: "oid-anna-123" },
      select: expect.any(Object),
    });
  });
});
