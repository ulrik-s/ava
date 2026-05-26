/**
 * Smoke-tests för ENTITY_REGISTRY — varje entry måste ha schema, gitPath
 * och sourceKey som matchar hydrate-working-copy + fsa-write-back-konventionen.
 * Validerar också att schemana är funktionsdugliga på minimala exempel.
 */

import { describe, it, expect } from "vitest";
import {
  ENTITY_REGISTRY,
  ENTITY_NAMES,
  calendarEventSchema,
  contactSchema,
  invoiceSchema,
  matterSchema,
  organizationSchema,
  paymentSchema,
  paymentPlanSchema,
  taskSchema,
  userSchema,
} from "@/lib/shared/schemas";

describe("ENTITY_REGISTRY", () => {
  it("har minst 21 entiteter (inkl. calendarEvent + task)", () => {
    expect(ENTITY_NAMES.length).toBeGreaterThanOrEqual(21);
    expect(ENTITY_NAMES).toContain("calendarEvent");
    expect(ENTITY_NAMES).toContain("task");
  });

  it("calendar + task: gitPath flat (inte per-user-mapp)", () => {
    expect(ENTITY_REGISTRY.calendarEvent.gitPath("e-1", { userId: "u-1" })).toBe("calendar/e-1.json");
    expect(ENTITY_REGISTRY.task.gitPath("t-1", { userId: "u-1" })).toBe("tasks/t-1.json");
  });

  it("varje entry har schema + gitPath + gitPrefix + sourceKey", () => {
    for (const name of ENTITY_NAMES) {
      const entry = ENTITY_REGISTRY[name];
      expect(entry.schema).toBeDefined();
      expect(typeof entry.gitPath).toBe("function");
      expect(entry.gitPrefix).toBeTruthy();
      expect(entry.sourceKey).toBeTruthy();
    }
  });

  it("gitPath:s första argument används i resultatet (för rader utan email-style key)", () => {
    expect(ENTITY_REGISTRY.matter.gitPath("m-1", {})).toBe("matters/active/m-1.json");
    expect(ENTITY_REGISTRY.contact.gitPath("c-1", {})).toBe("contacts/c-1.json");
    expect(ENTITY_REGISTRY.invoice.gitPath("i-1", {})).toBe("invoices/i-1.json");
  });

  it("user-pathen använder email om satt, annars id", () => {
    expect(ENTITY_REGISTRY.user.gitPath("u-1", { email: "anna@firma.se" })).toBe(".ava/users/anna@firma.se.json");
    expect(ENTITY_REGISTRY.user.gitPath("u-1", {})).toBe(".ava/users/u-1.json");
  });

  it("organisation + offices i registry:t", () => {
    expect(ENTITY_REGISTRY.organization.gitPath("o-1", {})).toBe(".ava/organizations/o-1.json");
    expect(ENTITY_REGISTRY.office.gitPath("off-1", {})).toBe("offices/off-1.json");
  });
});

describe("schemas — minimal valid input", () => {
  const now = "2026-05-24T10:00:00Z";

  it("organizationSchema accepterar minimal rad", () => {
    expect(organizationSchema.parse({ id: "o-1", name: "Byrå", createdAt: now, updatedAt: now }).name).toBe("Byrå");
  });

  it("userSchema defaultar role=LAWYER och active=true", () => {
    const u = userSchema.parse({
      id: "u-1", organizationId: "o-1",
      email: "anna@firma.se", name: "Anna",
      createdAt: now, updatedAt: now,
    });
    expect(u.role).toBe("LAWYER");
    expect(u.active).toBe(true);
    expect(u.publicKeys).toEqual([]);
  });

  it("contactSchema defaultar contactType=PERSON", () => {
    const c = contactSchema.parse({
      id: "c-1", organizationId: "o-1", name: "Anna",
      createdAt: now, updatedAt: now,
    });
    expect(c.contactType).toBe("PERSON");
  });

  it("matterSchema defaultar status=ACTIVE och paymentMethod=PENDING", () => {
    const m = matterSchema.parse({
      id: "m-1", organizationId: "o-1",
      matterNumber: "2026-0001", title: "Test",
      createdAt: now, updatedAt: now,
    });
    expect(m.status).toBe("ACTIVE");
    expect(m.paymentMethod).toBe("PENDING");
  });

  it("invoiceSchema defaultar status=DRAFT och invoiceType=STANDARD", () => {
    const i = invoiceSchema.parse({
      id: "i-1", matterId: "m-1", amount: 100000,
      invoiceDate: "2026-05-24", createdAt: now, updatedAt: now,
    });
    expect(i.status).toBe("DRAFT");
    expect(i.invoiceType).toBe("STANDARD");
  });

  it("paymentSchema kräver invoiceId + amount + paidAt + recordedById", () => {
    expect(() => paymentSchema.parse({ id: "p-1" })).toThrow();
    const p = paymentSchema.parse({
      id: "p-1", invoiceId: "i-1", amount: 50000,
      paidAt: "2026-05-24", recordedById: "u-1", createdAt: now,
    });
    expect(p.amount).toBe(50000);
  });

  it("paymentPlanSchema validerar dayOfMonth-range (1-28)", () => {
    expect(() => paymentPlanSchema.parse({
      id: "pp-1", invoiceId: "i-1", monthlyAmount: 10000, dayOfMonth: 31,
      startDate: "2026-05-24", createdAt: now, updatedAt: now,
    })).toThrow();
    const ok = paymentPlanSchema.parse({
      id: "pp-1", invoiceId: "i-1", monthlyAmount: 10000, dayOfMonth: 15,
      startDate: "2026-05-24", createdAt: now, updatedAt: now,
    });
    expect(ok.dayOfMonth).toBe(15);
  });

  it("date-fält accepterar både ISO-sträng och Date", () => {
    const a = invoiceSchema.parse({
      id: "i-1", matterId: "m-1", amount: 1, invoiceDate: "2026-05-24",
      createdAt: now, updatedAt: now,
    });
    const b = invoiceSchema.parse({
      id: "i-1", matterId: "m-1", amount: 1, invoiceDate: new Date(now),
      createdAt: new Date(now), updatedAt: new Date(now),
    });
    expect(a.invoiceDate).toBeInstanceOf(Date);
    expect(b.invoiceDate).toBeInstanceOf(Date);
  });

  it("calendarEventSchema defaultar kind=appointment + visibility=normal + mirrorToOutlook=false", () => {
    const now = "2026-05-24T10:00:00Z";
    const e = calendarEventSchema.parse({
      id: "e-1", userId: "u-1", organizationId: "org-1",
      title: "Möte med klient",
      startAt: now,
      createdAt: now, updatedAt: now,
    });
    expect(e.kind).toBe("appointment");
    expect(e.visibility).toBe("normal");
    expect(e.mirrorToOutlook).toBe(false);
    expect(e.allDay).toBe(false);
  });

  it("calendarEventSchema kräver title min(1)", () => {
    const now = "2026-05-24T10:00:00Z";
    expect(() => calendarEventSchema.parse({
      id: "e-1", userId: "u-1", organizationId: "org-1",
      title: "",
      startAt: now, createdAt: now, updatedAt: now,
    })).toThrow();
  });

  it("taskSchema defaultar status=TODO + priority=MEDIUM", () => {
    const now = "2026-05-24T10:00:00Z";
    const t = taskSchema.parse({
      id: "t-1", userId: "u-1", organizationId: "org-1",
      title: "Ring klienten",
      createdAt: now, updatedAt: now,
    });
    expect(t.status).toBe("TODO");
    expect(t.priority).toBe("MEDIUM");
  });

  it("passthrough — okända fält behålls (för legacy-tolerance)", () => {
    const m = matterSchema.parse({
      id: "m-1", organizationId: "o-1",
      matterNumber: "2026-0001", title: "X",
      createdAt: now, updatedAt: now,
      legacyField: "kept as-is",
    });
    expect((m as { legacyField?: string }).legacyField).toBe("kept as-is");
  });
});
