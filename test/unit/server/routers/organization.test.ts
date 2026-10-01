import { TRPCError } from "@trpc/server";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { organizationRouter } from "@/lib/server/routers/organization";
import { TINY_PNG } from "../../../helpers/tiny-images";
import { dataStoreFromMockPrisma, reposFromMockDataStore } from "../helpers/mock-data-store";

// ─── Helpers ─────────────────────────────────────────────────────

const mockPrisma = {
  organization: {
    findFirst: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  office: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
  },
};

function makeCaller(orgId = "org-a", role: "ADMIN" | "LAWYER" | "ASSISTANT" = "ADMIN", queued = false) {
  const dataStore = dataStoreFromMockPrisma(mockPrisma);
  const ctx = {
    user: { id: "user-1", email: "a@b.com", name: "Test", role, organizationId: orgId },
    prisma: mockPrisma, dataStore,
    repos: reposFromMockDataStore(dataStore),
    ...(queued ? { queued: { mutationId: "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", at: Date.UTC(2026, 9, 1) } } : {}),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return organizationRouter.createCaller(ctx as any);
}

const MAIN_OFFICE = {
  id: "off-main",
  name: "Stockholm",
  address: "Storgatan 1, 111 23 Stockholm",
  phone: "08-123 456 78",
  email: "sthlm@byrå.se",
  isMain: true,
  organizationId: "org-a",
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

const BRANCH_OFFICE = {
  id: "off-branch",
  name: "Göteborg",
  address: "Avenyn 10, 411 36 Göteborg",
  phone: "031-987 65 43",
  email: "gbg@byrå.se",
  isMain: false,
  organizationId: "org-a",
  createdAt: new Date("2024-02-01"),
  updatedAt: new Date("2024-02-01"),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Register main office + branch office ───────────────────────

describe("organization.addOffice — registrera huvudkontor och filial", () => {
  it("registrerar ett huvudkontor (isMain: true)", async () => {
    mockPrisma.office.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.office.create.mockResolvedValue(MAIN_OFFICE);

    const result = await makeCaller("org-a").addOffice({
      name: "Stockholm",
      address: "Storgatan 1, 111 23 Stockholm",
      phone: "08-123 456 78",
      email: "sthlm@byrå.se",
      isMain: true,
    });

    expect(result.isMain).toBe(true);
    expect(result.name).toBe("Stockholm");
    expect(mockPrisma.office.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Stockholm",
          isMain: true,
          organizationId: "org-a",
        }),
      })
    );
  });

  it("degraderar tidigare huvudkontor när nytt huvudkontor skapas", async () => {
    mockPrisma.office.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.office.create.mockResolvedValue(MAIN_OFFICE);

    await makeCaller("org-a").addOffice({
      name: "Stockholm",
      address: "Storgatan 1",
      isMain: true,
    });

    // Existing mains should be demoted before the new main is created
    expect(mockPrisma.office.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org-a", isMain: true },
      data: { isMain: false },
    });
    expect(mockPrisma.office.create).toHaveBeenCalled();
  });

  it("setup-id (demo-generatorn) följer med till repot från admin direkt", async () => {
    mockPrisma.office.create.mockResolvedValue(MAIN_OFFICE);
    await makeCaller("org-a").addOffice({ id: "o-sthlm", name: "Stockholm" });
    expect(mockPrisma.office.create.mock.calls.at(-1)?.[0].data.id).toBe("o-sthlm");
  });

  /** Id:t bestäms av servern (#1362): härlett ur anropet, aldrig valt av klienten. */
  it("utan id härleds det ur anropet — samma id i klientens körning och serverns omkörning", async () => {
    mockPrisma.office.create.mockResolvedValue(BRANCH_OFFICE);
    await makeCaller("org-a", "ADMIN", true).addOffice({ name: "Göteborg" });
    const first = mockPrisma.office.create.mock.calls.at(-1)?.[0].data.id;
    await makeCaller("org-a", "ADMIN", true).addOffice({ name: "Göteborg" });
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(mockPrisma.office.create.mock.calls.at(-1)?.[0].data.id).toBe(first);
  });

  it("ett eget id: nekas i kön (även för admin) och för icke-admin direkt (FORBIDDEN)", async () => {
    await expect(makeCaller("org-a", "ADMIN", true).addOffice({ id: "o-x", name: "X" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(makeCaller("org-a", "LAWYER").addOffice({ id: "o-x", name: "X" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockPrisma.office.create).not.toHaveBeenCalled();
  });

  it("registrerar en filial (isMain: false) utan att påverka huvudkontor", async () => {
    mockPrisma.office.create.mockResolvedValue(BRANCH_OFFICE);

    const result = await makeCaller("org-a").addOffice({
      name: "Göteborg",
      address: "Avenyn 10, 411 36 Göteborg",
      phone: "031-987 65 43",
      email: "gbg@byrå.se",
      isMain: false,
    });

    expect(result.isMain).toBe(false);
    expect(result.name).toBe("Göteborg");
    // Since isMain is false, no demotion should happen
    expect(mockPrisma.office.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.office.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Göteborg",
          isMain: false,
          organizationId: "org-a",
        }),
      })
    );
  });

  it("defaultar isMain till false när det utelämnas", async () => {
    mockPrisma.office.create.mockResolvedValue(BRANCH_OFFICE);

    await makeCaller("org-a").addOffice({ name: "Malmö" });

    expect(mockPrisma.office.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.office.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "Malmö", isMain: false }),
      })
    );
  });

  it("tilldelar alltid anropande användarens organizationId", async () => {
    mockPrisma.office.create.mockResolvedValue({ ...BRANCH_OFFICE, organizationId: "org-x" });

    await makeCaller("org-x").addOffice({ name: "Uppsala" });

    expect(mockPrisma.office.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: "org-x" }),
      })
    );
  });

  it("avvisar tomt namn", async () => {
    await expect(makeCaller().addOffice({ name: "" })).rejects.toThrow();
    expect(mockPrisma.office.create).not.toHaveBeenCalled();
  });
});

// ─── Full flow: main + branch ────────────────────────────────────

describe("organization — komplett flöde: registrera huvudkontor och filial", () => {
  it("registrerar först huvudkontor och sedan en filial", async () => {
    // Step 1: create main office (no existing offices → demotion affects 0 rows)
    mockPrisma.office.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.office.create.mockResolvedValueOnce(MAIN_OFFICE);

    const main = await makeCaller("org-a").addOffice({
      name: "Stockholm",
      address: "Storgatan 1, 111 23 Stockholm",
      isMain: true,
    });

    expect(main.isMain).toBe(true);
    expect(main.name).toBe("Stockholm");

    // Step 2: create branch office
    mockPrisma.office.create.mockResolvedValueOnce(BRANCH_OFFICE);

    const branch = await makeCaller("org-a").addOffice({
      name: "Göteborg",
      address: "Avenyn 10, 411 36 Göteborg",
      isMain: false,
    });

    expect(branch.isMain).toBe(false);
    expect(branch.name).toBe("Göteborg");

    // Step 3: listOffices should return both, main first
    mockPrisma.office.findMany.mockResolvedValue([MAIN_OFFICE, BRANCH_OFFICE]);
    const list = await makeCaller("org-a").listOffices();

    expect(list).toHaveLength(2);
    expect(list[0]!.isMain).toBe(true);
    expect(list[0]!.name).toBe("Stockholm");
    expect(list[1]!.isMain).toBe(false);
    expect(list[1]!.name).toBe("Göteborg");

    // Verify the query filters on org and orders by isMain desc, then name asc
    expect(mockPrisma.office.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-a" },
      orderBy: [{ isMain: "desc" }, { name: "asc" }],
    });
  });
});

// ─── updateOffice ────────────────────────────────────────────────

describe("organization.updateOffice", () => {
  it("uppdaterar ett kontor i anropande organisation", async () => {
    mockPrisma.office.findFirst.mockResolvedValue(BRANCH_OFFICE);
    mockPrisma.office.update.mockResolvedValue({ ...BRANCH_OFFICE, phone: "031-000 00 00" });

    const result = await makeCaller("org-a").updateOffice({
      id: "off-branch",
      phone: "031-000 00 00",
    });

    expect(result.phone).toBe("031-000 00 00");
    expect(mockPrisma.office.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "off-branch" } })
    );
  });

  it("degraderar tidigare huvudkontor när en filial befordras", async () => {
    mockPrisma.office.findFirst.mockResolvedValue(BRANCH_OFFICE);
    mockPrisma.office.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.office.update.mockResolvedValue({ ...BRANCH_OFFICE, isMain: true });

    await makeCaller("org-a").updateOffice({ id: "off-branch", isMain: true });

    expect(mockPrisma.office.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org-a", isMain: true },
      data: { isMain: false },
    });
  });

  it("kastar NOT_FOUND när kontor tillhör annan organisation", async () => {
    mockPrisma.office.findFirst.mockResolvedValue(null);

    await expect(
      makeCaller("org-a").updateOffice({ id: "off-branch", name: "Hijacked" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockPrisma.office.update).not.toHaveBeenCalled();
  });

  it("kastar NOT_FOUND när kontor inte existerar", async () => {
    mockPrisma.office.findFirst.mockResolvedValue(null);

    await expect(
      makeCaller("org-a").updateOffice({ id: "off-ghost", name: "X" })
    ).rejects.toBeInstanceOf(TRPCError);
  });
});

// ─── deleteOffice ────────────────────────────────────────────────

describe("organization.deleteOffice", () => {
  it("tar bort ett kontor i anropande organisation", async () => {
    mockPrisma.office.findFirst.mockResolvedValue(BRANCH_OFFICE);
    mockPrisma.office.delete.mockResolvedValue(BRANCH_OFFICE);

    await makeCaller("org-a").deleteOffice({ id: "off-branch" });

    expect(mockPrisma.office.delete).toHaveBeenCalledWith({ where: { id: "off-branch" } });
  });

  it("kastar NOT_FOUND vid borttagning från annan organisation", async () => {
    mockPrisma.office.findFirst.mockResolvedValue(null);

    await expect(makeCaller("org-a").deleteOffice({ id: "off-branch" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mockPrisma.office.delete).not.toHaveBeenCalled();
  });
});

// ─── getSettings / updateSettings ────────────────────────────────

describe("organization.getSettings", () => {
  it("returnerar org-inställningar för anropande användares org", async () => {
    mockPrisma.organization.findFirst.mockResolvedValue({
      id: "org-a",
      name: "Advokat AB",
      orgNumber: "556123-4567",
      address: "Storgatan 1",
      phone: "08-123 456 78",
      email: "info@byrå.se",
      bankgiro: "123-4567",
      website: "https://www.byra.se",
    });

    const result = await makeCaller("org-a").getSettings();

    expect(result.name).toBe("Advokat AB");
    expect(result.bankgiro).toBe("123-4567");
    // Webbplats, logga och sidfotsmärke (#1218) — saknade bilder blir null.
    expect(result.website).toBe("https://www.byra.se");
    expect(result.logo).toBeNull();
    expect(result.footerSeal).toBeNull();
    expect(result.hourlyRates).toEqual({}); // inga byråpriser satta (#1206)
    expect(mockPrisma.organization.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "org-a" } })
    );
  });
});

describe("organization.getSettings — timpriser", () => {
  it("returnerar byråns timpris per kategori (öre/h, #1206)", async () => {
    mockPrisma.organization.findFirst.mockResolvedValue({ id: "org-a", name: "Advokat AB", hourlyRates: { ARBETE: 250000, TIDSSPILLAN: 150000 } });
    const result = await makeCaller("org-a").getSettings();
    expect(result.hourlyRates).toEqual({ ARBETE: 250000, TIDSSPILLAN: 150000 });
  });
});

describe("organization.updateSettings", () => {
  it("ersätter hela kartan med byråns timpriser (öre/h) — en borttagen kategori försvinner", async () => {
    mockPrisma.organization.findFirst.mockResolvedValue({ id: "org-a" });
    mockPrisma.organization.update.mockResolvedValue({ id: "org-a" });
    await makeCaller("org-a").updateSettings({ hourlyRates: { ARBETE: 250000, TIDSSPILLAN: 150000 } });
    expect(mockPrisma.organization.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ hourlyRates: { ARBETE: 250000, TIDSSPILLAN: 150000 } }) }),
    );
    await makeCaller("org-a").updateSettings({ hourlyRates: { ARBETE: 250000 } });
    expect(mockPrisma.organization.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ hourlyRates: { ARBETE: 250000 } }) }),
    );
  });

  it("sparar webbplats, logga och sidfotsmärke; null tar bort en bild (#1218)", async () => {
    mockPrisma.organization.findFirst.mockResolvedValue({ id: "org-a" });
    mockPrisma.organization.update.mockResolvedValue({ id: "org-a" });
    await makeCaller("org-a").updateSettings({ website: "https://www.byra.se", logo: TINY_PNG, footerSeal: null });
    expect(mockPrisma.organization.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ website: "https://www.byra.se", logo: TINY_PNG, footerSeal: null }) }),
    );
  });

  it("avvisar en bild som inte är PNG/JPEG-data-URL", async () => {
    await expect(makeCaller("org-a").updateSettings({ logo: "data:image/svg+xml;base64,PHN2Zz4=" as never })).rejects.toThrow();
  });

  it("avvisar en okänd kategori och ett negativt pris", async () => {
    await expect(makeCaller("org-a").updateSettings({ hourlyRates: { ADVOKATBEREDSKAP: 1 } as never })).rejects.toThrow();
    await expect(makeCaller("org-a").updateSettings({ hourlyRates: { ARBETE: -1 } })).rejects.toThrow();
  });

  it("uppdaterar bankgiro och övriga fält", async () => {
    // Repo.update läser nuvarande raden (version-bump) före skrivning.
    mockPrisma.organization.findFirst.mockResolvedValue({ id: "org-a" });
    mockPrisma.organization.update.mockResolvedValue({
      id: "org-a",
      name: "Advokat AB",
      bankgiro: "999-8888",
    });

    await makeCaller("org-a").updateSettings({ bankgiro: "999-8888" });

    // objectContaining: repo lägger version/updatedAt utöver bankgiro.
    expect(mockPrisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "org-a" }, data: expect.objectContaining({ bankgiro: "999-8888" }) }),
    );
  });

  /**
   * Standardåtgärder (#956) — byråkonfiguration som ska vara identisk för alla.
   * Listan sparas som en enhet och normaliseras server-side, så en dubblett eller
   * en post med bara blanksteg inte hamnar i byråns lista.
   */
  it("normaliserar standardåtgärderna: trimmar, slänger tomma, dedupar på id", async () => {
    mockPrisma.organization.findFirst.mockResolvedValue({ id: "org-a" });
    mockPrisma.organization.update.mockResolvedValue({ id: "org-a", name: "Advokat AB" });

    const atgard = (over: Record<string, unknown>) => ({
      id: "x", description: "Åtgärd", minutes: 30, kind: "ARBETE" as const,
      stage: "ANY" as const, paymentMethods: [], billable: true, active: true, ...over,
    });
    await makeCaller("org-a").updateSettings({
      standardAtgarder: [
        atgard({ id: "inledande", description: "  Inledande åtgärder  ", minutes: 30 }),
        atgard({ id: "tom", description: "   " }),
        atgard({ id: "inledande", description: "Inledande åtgärder", minutes: 45 }),
      ],
    });

    const data = mockPrisma.organization.update.mock.calls[0]![0].data as {
      standardAtgarder: Array<{ id: string; description: string; minutes: number }>;
    };
    expect(data.standardAtgarder).toHaveLength(1);
    expect(data.standardAtgarder[0]).toMatchObject({ id: "inledande", description: "Inledande åtgärder", minutes: 45 });
  });

  it("avvisar en standardåtgärd med ogiltig tid (0 eller negativ)", async () => {
    mockPrisma.organization.findFirst.mockResolvedValue({ id: "org-a" });
    await expect(makeCaller("org-a").updateSettings({
      standardAtgarder: [{
        id: "noll", description: "Åtgärd utan tid", minutes: 0, kind: "ARBETE",
        stage: "ANY", paymentMethods: [], billable: true, active: true,
      }],
    })).rejects.toThrow();
    expect(mockPrisma.organization.update).not.toHaveBeenCalled();
  });
});

/**
 * Behörighet (#1370): byråns uppgifter, kontor och uppläggning av byråer är
 * admin-only. En medlem får bara ändra dokument-etiketterna, och får skicka
 * hela formuläret så länge övriga fält är oförändrade.
 */
describe("organization — behörighet för icke-admin (#1370)", () => {
  const CURRENT = {
    id: "org-a", name: "Advokat AB", address: "Storgatan 1", website: "https://byra.se",
    bankgiro: "123-4567", hourlyRates: { ARBETE: 250000, TIDSSPILLAN: 150000 },
  };

  it.each(["LAWYER", "ASSISTANT"] as const)("%s: addOffice, updateOffice och deleteOffice nekas (FORBIDDEN) utan skrivning", async (role) => {
    const caller = makeCaller("org-a", role);
    mockPrisma.office.findFirst.mockResolvedValue(MAIN_OFFICE);
    await expect(caller.addOffice({ name: "Filial", isMain: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.updateOffice({ id: "off-main" as never, name: "Kapat" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.deleteOffice({ id: "off-main" as never })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockPrisma.office.create).not.toHaveBeenCalled();
    expect(mockPrisma.office.update).not.toHaveBeenCalled();
    expect(mockPrisma.office.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.office.delete).not.toHaveBeenCalled();
  });

  it("LAWYER: create (uppläggning av en byrå) nekas", async () => {
    await expect(makeCaller("org-a", "LAWYER").create({ id: "00000000-0000-7000-8000-000000000001" as never, name: "Ny byrå" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockPrisma.organization.create).not.toHaveBeenCalled();
  });

  it("ADMIN: create lägger upp byrån", async () => {
    mockPrisma.organization.create.mockResolvedValue({ id: "org-new", name: "Ny byrå" });
    await makeCaller("org-a", "ADMIN").create({ id: "00000000-0000-7000-8000-000000000001" as never, name: "Ny byrå" });
    expect(mockPrisma.organization.create).toHaveBeenCalled();
  });

  it.each([
    ["byrånamnet", { name: "Kapad AB" }],
    ["adressen", { address: "Annan väg 2" }],
    ["telefon", { phone: "070-000 00 00" }],
    ["e-post", { email: "kapad@example.se" }],
    ["webbplatsen", { website: "https://kapad.se" }],
    ["logotypen", { logo: TINY_PNG }],
    ["sidfotsmärket", { footerSeal: TINY_PNG }],
    ["bankgirot", { bankgiro: "999-9999" }],
    ["organisationsnumret", { orgNumber: "556999-9999" }],
    ["timpriserna", { hourlyRates: { ARBETE: 1 } }],
    ["aconto-gränsen", { accontoThresholdOre: 1 }],
    ["standardåtgärderna", { standardAtgarder: [] as never[] }],
  ])("LAWYER: ändring av %s nekas (FORBIDDEN) och inget skrivs", async (_label, patch) => {
    mockPrisma.organization.findFirst.mockResolvedValue({ ...CURRENT, standardAtgarder: [{ id: "x" }] });
    await expect(makeCaller("org-a", "LAWYER").updateSettings(patch)).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringMatching(/Endast administratörer/) });
    expect(mockPrisma.organization.update).not.toHaveBeenCalled();
  });

  it("LAWYER: dokument-etiketter sparas, även när formulärets övriga fält skickas oförändrade", async () => {
    mockPrisma.organization.findFirst.mockResolvedValue(CURRENT);
    mockPrisma.organization.update.mockResolvedValue(CURRENT);
    await makeCaller("org-a", "LAWYER").updateSettings({
      documentTags: ["Avtal"], name: "Advokat AB", address: "Storgatan 1", website: "https://byra.se", bankgiro: "123-4567",
      // Samma karta i annan nyckelordning är oförändrad.
      hourlyRates: { TIDSSPILLAN: 150000, ARBETE: 250000 },
      // Tomt fält och saknat räknas lika.
      phone: "",
    });
    expect(mockPrisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ documentTags: ["Avtal"] }) }),
    );
  });

  it("LAWYER: tom timpriskarta mot en byrå utan timpriser räknas som oförändrad", async () => {
    mockPrisma.organization.findFirst.mockResolvedValue({ id: "org-a", name: "Advokat AB" });
    mockPrisma.organization.update.mockResolvedValue({ id: "org-a" });
    await makeCaller("org-a", "LAWYER").updateSettings({ hourlyRates: {}, documentTags: [] });
    expect(mockPrisma.organization.update).toHaveBeenCalled();
  });
});
