/**
 * Demo-generatorn (slice: organization → users → contacts via tRPC-API:t).
 *
 * Bevisar "drive the API" (ADR-beslut): populate kör create-mutationerna mot
 * en backend-target (här git/in-memory) med klient-genererade id:n (ADR 0003),
 * och Node-git-writeBack:en skriver ren JSON i rätt git-layout.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { createGitTarget, createPostgresTarget } from "../../tooling/demo-generator/backend-target";
import { makeNodeGitWriteBack } from "../../tooling/demo-generator/node-git-writeback";
import { populate } from "../../tooling/demo-generator/populate";
import type { SeedDataset } from "../../tooling/scripts/seed-data";

const now = new Date("2026-01-01T00:00:00Z");
const tinySeed = {
  organizations: [{ id: "org-test", name: "Testbyrå AB", orgNumber: "556111-0001", createdAt: now, updatedAt: now }],
  users: [{ id: "u-test", email: "anna@test.se", name: "Anna Advokat", role: "ADMIN", hourlyRate: 250_000, organizationId: "org-test", createdAt: now, updatedAt: now }],
  contacts: [{ id: "c-test", name: "Klient AB", contactType: "COMPANY", organizationId: "org-test", createdAt: now, updatedAt: now }],
  matters: [{ id: "m-test", matterNumber: "2024-0007", title: "Testärende", description: "Demo", status: "CLOSED", matterType: "Tvist", paymentMethod: "PRIVAT", paymentMethodDecidedAt: now, isTaxeArende: false, organizationId: "org-test", createdAt: now, updatedAt: now }],
  matterContacts: [{ id: "mc-test", matterId: "m-test", contactId: "c-test", role: "KLIENT", organizationId: "org-test", createdAt: now }],
  timeEntries: [{ id: "te-test", userId: "u-test", matterId: "m-test", date: now, minutes: 60, description: "Möte", billable: true, hourlyRate: 250_000, invoiceId: null, createdAt: now }],
  expenses: [{ id: "ex-test", userId: "u-test", matterId: "m-test", date: now, amount: 1000, description: "Tåg", vatRate: 600, vatIncluded: true, billable: true, invoiceId: null, createdAt: now }],
  calendarEvents: [{ id: "cal-test", userId: "u-test", organizationId: "org-test", kind: "appointment", title: "Möte", description: null, location: "Kontor", startAt: now, endAt: null, allDay: false, matterId: "m-test", visibility: "normal", mirrorToOutlook: false, createdAt: now, updatedAt: now }],
  tasks: [{ id: "task-test", userId: "u-test", organizationId: "org-test", title: "Skriv inlaga", status: "TODO", priority: "MEDIUM", dueAt: now, completedAt: null, matterId: "m-test", createdAt: now, updatedAt: now }],
  documentTemplates: [{ id: "tpl-test", organizationId: "org-test", name: "Mall", description: "x", category: "Allmänt", content: "<h1>Mall</h1>", createdById: "u-test", createdAt: now, updatedAt: now }],
  conflictChecks: [{ id: "cc-test", searchTerm: "Klient", searchType: "name", results: [], checkedById: "u-test", createdAt: now }],
} as unknown as SeedDataset;

const ADMIN = { id: "gen", email: "gen@ava.local", name: "Generator", role: "ADMIN", organizationId: "org-test" };

describe("demo-generator — populate (org/users/contacts via tRPC)", () => {
  it("skapar entiteterna via create-mutationerna med klient-genererade id:n", async () => {
    const captured: Array<{ entity: string; id: string }> = [];
    const target = createGitTarget({
      principal: ADMIN,
      writeBack: async (e) => { if (e.kind !== "delete") captured.push({ entity: e.entity, id: String(e.row.id) }); },
    });
    const res = await populate(target.caller, tinySeed);
    expect(res).toEqual({
      organizations: 1, users: 1, contacts: 1, matters: 1, matterContacts: 1,
      timeEntries: 1, expenses: 1, calendarEvents: 1, tasks: 1, documentTemplates: 1, conflictChecks: 1,
    });
    expect(captured.find((c) => c.entity === "organization")?.id).toBe("org-test");
    expect(captured.find((c) => c.entity === "user")?.id).toBe("u-test");
    expect(captured.find((c) => c.entity === "contact")?.id).toBe("c-test");
    expect(captured.find((c) => c.entity === "matter")?.id).toBe("m-test");
    expect(captured.find((c) => c.entity === "matterContact")?.id).toBe("mc-test");
    expect(captured.find((c) => c.entity === "timeEntry")?.id).toBe("te-test");
    expect(captured.find((c) => c.entity === "expense")?.id).toBe("ex-test");
    expect(captured.find((c) => c.entity === "calendarEvent")?.id).toBe("cal-test");
    expect(captured.find((c) => c.entity === "task")?.id).toBe("task-test");
    expect(captured.find((c) => c.entity === "documentTemplate")?.id).toBe("tpl-test");
    expect(captured.find((c) => c.entity === "conflictCheck")).toBeDefined(); // id auto-genereras
  });

  it("bevarar kurerade fixture-värden (matterNumber, status) genom API:t", async () => {
    const target = createGitTarget({ principal: ADMIN, writeBack: async () => {} });
    await populate(target.caller, tinySeed);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = await (target.caller as any).matter.getById({ id: "m-test" });
    expect(m.matterNumber).toBe("2024-0007"); // ej auto-genererat
    expect(m.status).toBe("CLOSED"); // ej tvingat ACTIVE
    expect(m.paymentMethod).toBe("PRIVAT");
    expect(new Date(m.createdAt).getTime()).toBe(now.getTime()); // historiskt datum bevarat
  });

  it("läsbar via samma caller (org-scopad list ser kontakten)", async () => {
    const target = createGitTarget({ principal: ADMIN, writeBack: async () => {} });
    await populate(target.caller, tinySeed);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list = await (target.caller as any).contacts.list({ page: 1, pageSize: 10 });
    expect(list.contacts.map((c: { id: string }) => c.id)).toContain("c-test");
  });
});

describe("makeNodeGitWriteBack — git-fillayout (speglar fsa-write-back)", () => {
  it("skriver event.row rakt av till registryns gitPath (inkl denormaliserade fält)", async () => {
    const dir = mkdtempSync(join(os.tmpdir(), "ava-gen-"));
    try {
      const wb = makeNodeGitWriteBack(dir);
      // Denormaliserat fält (fileSize) ligger utanför schemat men UI:t läser
      // det → måste bevaras precis som appens self-hosted writeBack gör.
      await wb({ entity: "document", kind: "create", row: { id: "doc1", matterId: "m1", fileName: "X.pdf", mimeType: "application/pdf", sizeBytes: 100, fileSize: 100, storagePath: "documents/content/doc1.pdf", uploadedById: "u1", organizationId: "org-test", createdAt: now, updatedAt: now } });
      const p = join(dir, "documents/doc1.json");
      expect(existsSync(p)).toBe(true);
      const data = JSON.parse(readFileSync(p, "utf8"));
      expect(data.id).toBe("doc1");
      expect(data.fileSize).toBe(100); // denormaliserat fält bevarat (ej strippat)
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("createPostgresTarget — stub", () => {
  it("kastar tydligt fel (ADR 0001 Fas 3)", () => {
    expect(() => createPostgresTarget()).toThrow(/Postgres/i);
  });
});
