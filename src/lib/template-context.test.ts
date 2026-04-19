import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  formatDate,
  formatDateShort,
  formatAmount,
  formatHours,
  renderTemplate,
  buildTemplateContext,
  type TemplateContext,
} from "./template-context";

// ─── formatDate ──────────────────────────────────────────────────

describe("formatDate", () => {
  it("formats a Date object to Swedish long format", () => {
    expect(formatDate(new Date("2026-04-16T00:00:00.000Z"))).toMatch(/april 2026/);
  });

  it("formats an ISO date string", () => {
    expect(formatDate("2024-01-05")).toMatch(/januari 2024/);
  });

  it("returns empty string for null", () => {
    expect(formatDate(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(formatDate(undefined)).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(formatDate("")).toBe("");
  });

  it("includes the day number", () => {
    const result = formatDate(new Date("2024-03-07"));
    expect(result).toMatch(/7/);
    expect(result).toMatch(/mars/);
    expect(result).toMatch(/2024/);
  });
});

// ─── formatDateShort ─────────────────────────────────────────────

describe("formatDateShort", () => {
  it("formats a date to YYYY-MM-DD style", () => {
    const result = formatDateShort(new Date("2026-04-16T12:00:00.000Z"));
    expect(result).toMatch(/2026/);
    expect(result).toMatch(/04|4/); // month
  });

  it("returns empty string for null", () => {
    expect(formatDateShort(null)).toBe("");
  });
});

// ─── formatAmount ────────────────────────────────────────────────

describe("formatAmount", () => {
  it("converts öre to kr with two decimal places", () => {
    const result = formatAmount(10000);
    expect(result).toContain("100,00");
    expect(result).toContain("kr");
  });

  it("formats zero correctly", () => {
    const result = formatAmount(0);
    expect(result).toContain("0,00");
    expect(result).toContain("kr");
  });

  it("returns 0,00 kr for null", () => {
    const result = formatAmount(null);
    expect(result).toContain("0,00");
    expect(result).toContain("kr");
  });

  it("formats large amounts with thousands separator (non-breaking space)", () => {
    const result = formatAmount(1250000); // 12 500,00 kr
    expect(result).toContain("12");
    expect(result).toContain("500,00");
    expect(result).toContain("kr");
  });

  it("handles decimal öre amounts", () => {
    // 150 öre = 1,50 kr
    const result = formatAmount(150);
    expect(result).toContain("1,50");
    expect(result).toContain("kr");
  });

  it("handles a typical hourly fee (2 500 kr = 250 000 öre)", () => {
    const result = formatAmount(250000);
    expect(result).toContain("2");
    expect(result).toContain("500,00");
  });
});

// ─── formatHours ─────────────────────────────────────────────────

describe("formatHours", () => {
  it("returns '0 tim' for 0 minutes", () => {
    expect(formatHours(0)).toBe("0 tim");
  });

  it("returns '0 tim' for null", () => {
    expect(formatHours(null)).toBe("0 tim");
  });

  it("formats exact hours without decimal", () => {
    expect(formatHours(60)).toBe("1 tim");
    expect(formatHours(120)).toBe("2 tim");
    expect(formatHours(480)).toBe("8 tim");
  });

  it("formats fractional hours with Swedish comma", () => {
    expect(formatHours(30)).toBe("0,5 tim");
    expect(formatHours(90)).toBe("1,5 tim");
    expect(formatHours(45)).toBe("0,8 tim");
  });

  it("does not use period as decimal separator", () => {
    expect(formatHours(90)).not.toContain(".");
  });
});

// ─── renderTemplate ──────────────────────────────────────────────

const baseContext: TemplateContext = {
  matter: {
    id: "m1",
    matterNumber: "2024-0001",
    title: "Testärende",
    description: "En beskrivning",
    status: "ACTIVE",
    matterType: "Familjerätt",
    createdAt: new Date("2024-01-01"),
  },
  organization: {
    name: "Advokat AB",
    address: "Storgatan 1",
    phone: "08-000 00 00",
    email: "info@advokat.se",
    orgNumber: "556123-4567",
    bankgiro: null,
    logoBase64: null,
    hasLogo: false,
    offices: [],
    mainOffice: null,
  },
  contacts: [
    {
      name: "Anna Klientsson",
      role: "KLIENT",
      roleLabel: "Klient",
      email: "anna@example.com",
      phone: "070-000 00 01",
      address: "Hemgatan 5",
      personalNumber: "19800101-1234",
      orgNumber: null,
      notes: null,
    },
  ],
  klient: {
    name: "Anna Klientsson",
    role: "KLIENT",
    roleLabel: "Klient",
    email: "anna@example.com",
    phone: "070-000 00 01",
    address: "Hemgatan 5",
    personalNumber: "19800101-1234",
    orgNumber: null,
    notes: null,
  },
  motpart: null,
  recipient: null,
  recipients: [],
  timeEntries: [
    {
      date: new Date("2024-03-01"),
      description: "Konsultation",
      minutes: 60,
      hours: "1,0 tim",
      amount: 250000,
      userName: "Erik Advokat",
      billable: true,
    },
    {
      date: new Date("2024-03-05"),
      description: "Avtalsgenomgång",
      minutes: 90,
      hours: "1,5 tim",
      amount: 375000,
      userName: "Erik Advokat",
      billable: false, // not billable — should not be in total
    },
  ],
  expenses: [
    { date: new Date("2024-03-02"), description: "Resekostnad", amount: 15000, userName: "Erik Advokat", billable: true },
  ],
  totalTimeMinutes: 150,
  totalTimeAmount: 250000,
  totalExpenseAmount: 15000,
  today: "2026-04-16",
  generatedBy: { name: "Erik Advokat", email: "erik@advokat.se", title: "Advokat" },
};

describe("renderTemplate", () => {
  it("returns a complete HTML document", () => {
    const html = renderTemplate("<p>Hej</p>", baseContext);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<html lang="sv">');
    expect(html).toContain("</html>");
  });

  it("interpolates simple variables", () => {
    const html = renderTemplate("<p>{{matter.matterNumber}}</p>", baseContext);
    expect(html).toContain("2024-0001");
  });

  it("interpolates organisation name", () => {
    const html = renderTemplate("<p>{{organization.name}}</p>", baseContext);
    expect(html).toContain("Advokat AB");
  });

  it("interpolates klient name", () => {
    const html = renderTemplate("<p>{{klient.name}}</p>", baseContext);
    expect(html).toContain("Anna Klientsson");
  });

  it("renders {{#each}} loops over contacts", () => {
    const html = renderTemplate(
      "{{#each contacts}}<li>{{name}} ({{roleLabel}})</li>{{/each}}",
      baseContext
    );
    expect(html).toContain("Anna Klientsson");
    expect(html).toContain("Klient");
  });

  it("renders {{#if}} conditional blocks", () => {
    const withDesc = renderTemplate(
      "{{#if matter.description}}<span>{{matter.description}}</span>{{/if}}",
      baseContext
    );
    expect(withDesc).toContain("En beskrivning");

    const noDesc = renderTemplate(
      "{{#if matter.description}}<span>{{matter.description}}</span>{{/if}}",
      { ...baseContext, matter: { ...baseContext.matter, description: null } }
    );
    expect(noDesc).not.toContain("<span>");
  });

  it("applies formatDate helper", () => {
    const html = renderTemplate(
      "<p>{{formatDate matter.createdAt}}</p>",
      baseContext
    );
    expect(html).toContain("januari");
    expect(html).toContain("2024");
  });

  it("applies formatAmount helper", () => {
    const html = renderTemplate(
      "<p>{{formatAmount totalTimeAmount}}</p>",
      baseContext
    );
    expect(html).toContain("2");
    expect(html).toContain("500,00");
    expect(html).toContain("kr");
  });

  it("applies formatHours helper", () => {
    const html = renderTemplate(
      "<p>{{formatHours totalTimeMinutes}}</p>",
      baseContext
    );
    expect(html).toContain("2,5 tim");
  });

  it("escapes HTML in user-supplied content by default", () => {
    const xssContext = {
      ...baseContext,
      matter: { ...baseContext.matter, title: '<script>alert("xss")</script>' },
    };
    const html = renderTemplate("<p>{{matter.title}}</p>", xssContext);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders today's date as a string", () => {
    const html = renderTemplate("<p>{{today}}</p>", baseContext);
    expect(html).toContain("2026-04-16");
  });

  it("handles missing optional field gracefully", () => {
    const html = renderTemplate("<p>{{matter.matterType}}</p>", {
      ...baseContext,
      matter: { ...baseContext.matter, matterType: null },
    });
    // Handlebars renders null as empty string — no crash
    expect(html).toContain("<p>");
  });

  // ─── recipient-variabeln (mottagar-specifik render) ────────────

  it("renderar inget när recipient är null (standardfallet)", () => {
    const html = renderTemplate(
      "{{#if recipient}}<p>Till: {{recipient.name}}</p>{{/if}}",
      baseContext,
    );
    expect(html).not.toContain("Till:");
  });

  it("interpolerar recipient när den är satt", () => {
    const recipient = {
      name: "Bo Motpart",
      role: "MOTPART",
      roleLabel: "Motpart",
      email: "bo@example.com",
      phone: null,
      address: "Motvägen 3, 113 44 Stockholm",
      personalNumber: null,
      orgNumber: null,
      notes: null,
    };
    const html = renderTemplate(
      "<p>Till: {{recipient.name}}<br>{{recipient.address}}</p>",
      { ...baseContext, recipient },
    );
    expect(html).toContain("Till: Bo Motpart");
    expect(html).toContain("Motvägen 3, 113 44 Stockholm");
  });

  it("renderar recipient.roleLabel för rollvisning", () => {
    const recipient = {
      name: "Bo",
      role: "MOTPART",
      roleLabel: "Motpart",
      email: null,
      phone: null,
      address: null,
      personalNumber: null,
      orgNumber: null,
      notes: null,
    };
    const html = renderTemplate(
      "<p>({{recipient.roleLabel}})</p>",
      { ...baseContext, recipient },
    );
    expect(html).toContain("(Motpart)");
  });

  it("renderar {{#each recipients}} över flera mottagare", () => {
    const recipients = [
      {
        name: "Anna",
        role: "KLIENT",
        roleLabel: "Klient",
        email: null, phone: null, address: null, personalNumber: null, orgNumber: null, notes: null,
      },
      {
        name: "Bo",
        role: "MOTPART",
        roleLabel: "Motpart",
        email: null, phone: null, address: null, personalNumber: null, orgNumber: null, notes: null,
      },
    ];
    const html = renderTemplate(
      "{{#each recipients}}<li>{{name}}</li>{{/each}}",
      { ...baseContext, recipients },
    );
    expect(html).toContain("<li>Anna</li>");
    expect(html).toContain("<li>Bo</li>");
  });
});

// ─── buildTemplateContext ────────────────────────────────────────

describe("buildTemplateContext", () => {
  const mockOrg = {
    id: "org1",
    name: "Mock Byrå",
    address: "Mockgatan 1",
    phone: "08-111 11 11",
    email: "mock@byrå.se",
    orgNumber: "123456-7890",
    bankgiro: null,
    logoPath: null,
    offices: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockMatter = {
    id: "matter1",
    matterNumber: "2024-0042",
    title: "Mockärende",
    description: "En testbeskrivning",
    status: "ACTIVE" as const,
    matterType: "Avtalsrätt",
    organizationId: "org1",
    createdAt: new Date("2024-06-01"),
    updatedAt: new Date("2024-06-01"),
    organization: mockOrg,
    contacts: [
      {
        id: "mc1",
        matterId: "matter1",
        contactId: "c1",
        role: "KLIENT" as const,
        notes: null,
        createdAt: new Date(),
        contact: {
          id: "c1",
          name: "Test Person",
          contactType: "PERSON" as const,
          personalNumber: "19900101-0001",
          orgNumber: null,
          email: "test@example.com",
          phone: "070-111 11 11",
          address: "Testgatan 1",
          notes: null,
          organizationId: "org1",
          parentId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
    ],
    timeEntries: [
      {
        id: "te1",
        userId: "u1",
        matterId: "matter1",
        date: new Date("2024-06-10"),
        minutes: 120,
        description: "Kundmöte",
        hourlyRate: 300000, // 3 000 kr/h in öre
        billable: true,
        invoiceId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: { id: "u1", name: "Mock Advokat", email: "mock@byrå.se", title: "Advokat", role: "LAWYER" as const, hourlyRate: 300000, mileageRate: null, organizationId: "org1", passwordHash: null, createdAt: new Date(), updatedAt: new Date() },
      },
      {
        id: "te2",
        userId: "u1",
        matterId: "matter1",
        date: new Date("2024-06-11"),
        minutes: 30,
        description: "Mejlkorrespondens",
        hourlyRate: 300000,
        billable: false, // not billable
        invoiceId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: { id: "u1", name: "Mock Advokat", email: "mock@byrå.se", title: "Advokat", role: "LAWYER" as const, hourlyRate: 300000, mileageRate: null, organizationId: "org1", passwordHash: null, createdAt: new Date(), updatedAt: new Date() },
      },
    ],
    expenses: [
      {
        id: "exp1",
        userId: "u1",
        matterId: "matter1",
        date: new Date("2024-06-12"),
        amount: 50000, // 500 kr in öre
        description: "Porto",
        billable: true,
        invoiceId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: { id: "u1", name: "Mock Advokat", email: "mock@byrå.se", title: "Advokat", role: "LAWYER" as const, hourlyRate: 300000, mileageRate: null, organizationId: "org1", passwordHash: null, createdAt: new Date(), updatedAt: new Date() },
      },
    ],
  };

  const mockUser = {
    id: "u1",
    name: "Mock Advokat",
    email: "mock@byrå.se",
    title: "Advokat",
    role: "LAWYER" as const,
    hourlyRate: 300000,
    mileageRate: null,
    organizationId: "org1",
    passwordHash: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Build a minimal mock Prisma client
  const mockPrisma = {
    matter: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(mockMatter),
    },
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(mockUser),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.matter.findUniqueOrThrow.mockResolvedValue(mockMatter);
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue(mockUser);
  });

  it("returns matter data correctly", async () => {
    const ctx = await buildTemplateContext("matter1", "u1", mockPrisma as never);
    expect(ctx.matter.matterNumber).toBe("2024-0042");
    expect(ctx.matter.title).toBe("Mockärende");
    expect(ctx.matter.status).toBe("ACTIVE");
  });

  it("returns organisation data", async () => {
    const ctx = await buildTemplateContext("matter1", "u1", mockPrisma as never);
    expect(ctx.organization.name).toBe("Mock Byrå");
    expect(ctx.organization.phone).toBe("08-111 11 11");
  });

  it("maps contacts with Swedish role labels", async () => {
    const ctx = await buildTemplateContext("matter1", "u1", mockPrisma as never);
    expect(ctx.contacts).toHaveLength(1);
    expect(ctx.contacts[0].name).toBe("Test Person");
    expect(ctx.contacts[0].role).toBe("KLIENT");
    expect(ctx.contacts[0].roleLabel).toBe("Klient");
  });

  it("sets klient to the first KLIENT contact", async () => {
    const ctx = await buildTemplateContext("matter1", "u1", mockPrisma as never);
    expect(ctx.klient).not.toBeNull();
    expect(ctx.klient?.name).toBe("Test Person");
  });

  it("sets motpart to null when no MOTPART exists", async () => {
    const ctx = await buildTemplateContext("matter1", "u1", mockPrisma as never);
    expect(ctx.motpart).toBeNull();
  });

  it("defaultar recipient till null och recipients till tom lista", async () => {
    // Recipient-fälten fylls av mallgenererings-API:t per-dokument;
    // buildTemplateContext ska alltid leverera tom/null-default.
    const ctx = await buildTemplateContext("matter1", "u1", mockPrisma as never);
    expect(ctx.recipient).toBeNull();
    expect(ctx.recipients).toEqual([]);
  });

  it("calculates time entry amount from minutes × hourlyRate", async () => {
    const ctx = await buildTemplateContext("matter1", "u1", mockPrisma as never);
    // 120 minutes = 2 h × 300 000 öre/h = 600 000 öre
    expect(ctx.timeEntries[0].amount).toBe(600000);
  });

  it("only sums billable time entries in totalTimeAmount", async () => {
    const ctx = await buildTemplateContext("matter1", "u1", mockPrisma as never);
    // Only te1 (120 min billable) → 600 000 öre
    // te2 (30 min, not billable) → excluded
    expect(ctx.totalTimeAmount).toBe(600000);
  });

  it("includes both billable and non-billable entries in totalTimeMinutes", async () => {
    const ctx = await buildTemplateContext("matter1", "u1", mockPrisma as never);
    expect(ctx.totalTimeMinutes).toBe(150); // 120 + 30
  });

  it("sums billable expenses in totalExpenseAmount", async () => {
    const ctx = await buildTemplateContext("matter1", "u1", mockPrisma as never);
    expect(ctx.totalExpenseAmount).toBe(50000);
  });

  it("formats hours string with Swedish comma", async () => {
    const ctx = await buildTemplateContext("matter1", "u1", mockPrisma as never);
    // 120 min = "2,0 tim"
    expect(ctx.timeEntries[0].hours).toContain(",");
    expect(ctx.timeEntries[0].hours).toContain("tim");
  });

  it("sets generatedBy from the user record", async () => {
    const ctx = await buildTemplateContext("matter1", "u1", mockPrisma as never);
    expect(ctx.generatedBy.name).toBe("Mock Advokat");
    expect(ctx.generatedBy.title).toBe("Advokat");
  });

  it("sets hasLogo to false when org has no logoPath", async () => {
    const ctx = await buildTemplateContext("matter1", "u1", mockPrisma as never);
    expect(ctx.organization.hasLogo).toBe(false);
    expect(ctx.organization.logoBase64).toBeNull();
  });

  it("sets hasLogo to false if logoPath file does not exist", async () => {
    mockPrisma.matter.findUniqueOrThrow.mockResolvedValue({
      ...mockMatter,
      organization: { ...mockOrg, logoPath: "/nonexistent/path/logo.png" },
    });
    const ctx = await buildTemplateContext("matter1", "u1", mockPrisma as never);
    expect(ctx.organization.hasLogo).toBe(false);
  });

  it("includes today as a string", async () => {
    const ctx = await buildTemplateContext("matter1", "u1", mockPrisma as never);
    expect(typeof ctx.today).toBe("string");
    expect(ctx.today).toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
