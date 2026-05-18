/**
 * Tester för `PostgresExporter` — migrationsverktyget som tar en
 * Postgres-databas och exporterar all data till JSON-projektioner i
 * en lokal git working tree.
 *
 * Designprincip: stream-baserat — vi loopar tabeller och projicierar
 * en entitet i taget istället för att hämta allt i minnet.
 *
 * Tester använder mock-Prisma med fasta entitet-listor och
 * InMemoryFileSystem.
 */

import { describe, it, expect, vi } from "vitest";
import { PostgresExporter } from "@/server/local-first/postgres-exporter";
import { InMemoryFileSystem } from "@/server/local-first/in-memory-fs";
import { buildDefaultRegistry } from "@/server/local-first/projections/default-registry";

const sampleMatter = {
  id: "m1",
  matterNumber: "2026-0001",
  title: "Vårdnadstvist",
  status: "ACTIVE",
  organizationId: "org-1",
};

const sampleContact = {
  id: "c1",
  name: "Anna Klient",
  contactType: "PERSON",
  organizationId: "org-1",
};

const sampleUser = {
  id: "u1",
  email: "anna@firma.se",
  name: "Anna",
  role: "LAWYER",
  organizationId: "org-1",
};

interface ExporterPrismaMock {
  matter: { findMany: ReturnType<typeof vi.fn> };
  contact: { findMany: ReturnType<typeof vi.fn> };
  user: { findMany: ReturnType<typeof vi.fn> };
}

function makePrismaMock(opts: {
  matters?: unknown[];
  contacts?: unknown[];
  users?: unknown[];
}): ExporterPrismaMock {
  return {
    matter: { findMany: vi.fn().mockResolvedValue(opts.matters ?? []) },
    contact: { findMany: vi.fn().mockResolvedValue(opts.contacts ?? []) },
    user: { findMany: vi.fn().mockResolvedValue(opts.users ?? []) },
  };
}

describe("PostgresExporter", () => {
  it("exporterar matter till matters/active/<id>.json", async () => {
    const fs = new InMemoryFileSystem();
    const exporter = new PostgresExporter(      makePrismaMock({ matters: [sampleMatter] }) as never,
      fs,
      buildDefaultRegistry(),
    );
    const result = await exporter.exportOrganization("org-1");
    expect(result.entities.matter).toBe(1);
    expect(await fs.exists("matters/active/m1.json")).toBe(true);
  });

  it("filtrerar på organizationId — annan org:s data exporteras inte", async () => {
    const prisma = makePrismaMock({ matters: [sampleMatter] });
    const fs = new InMemoryFileSystem();
    const exporter = new PostgresExporter(prisma as never, fs, buildDefaultRegistry());
    await exporter.exportOrganization("org-1");
    const args = (prisma.matter.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.where.organizationId).toBe("org-1");
  });

  it("exporterar contacts och users i samma pass", async () => {
    const fs = new InMemoryFileSystem();
    const exporter = new PostgresExporter(
      makePrismaMock({
        matters: [sampleMatter],
        contacts: [sampleContact],
        users: [sampleUser],
      }) as never,
      fs,
      buildDefaultRegistry(),
    );
    const result = await exporter.exportOrganization("org-1");
    expect(result.entities.matter).toBe(1);
    expect(result.entities.contact).toBe(1);
    expect(result.entities.user).toBe(1);
    expect(await fs.exists("matters/active/m1.json")).toBe(true);
    expect(await fs.exists("contacts/c1.json")).toBe(true);
    expect(await fs.exists(".ava/users/anna@firma.se.json")).toBe(true);
  });

  it("returnerar totalCount = summa av alla entiteter", async () => {
    const fs = new InMemoryFileSystem();
    const exporter = new PostgresExporter(
      makePrismaMock({
        matters: [sampleMatter, { ...sampleMatter, id: "m2", matterNumber: "2026-0002" }],
        contacts: [sampleContact],
      }) as never,
      fs,
      buildDefaultRegistry(),
    );
    const result = await exporter.exportOrganization("org-1");
    expect(result.totalCount).toBe(3);
  });

  it("kraschar inte på okänd entitet i registry — hoppar över", async () => {
    const fs = new InMemoryFileSystem();
    // Använd tom registry (inga entiteter registrerade)
    const { ProjectionRegistry } = await import("@/server/local-first/projections/registry");
    const exporter = new PostgresExporter(      makePrismaMock({ matters: [sampleMatter] }) as never,
      fs,
      new ProjectionRegistry(),
    );
    const result = await exporter.exportOrganization("org-1");
    expect(result.totalCount).toBe(0);
  });

  it("samlar fel i `errors`-arrayen istället för att kasta", async () => {
    const fs = new InMemoryFileSystem();
    // En projektion-impl som alltid kastar — bevisa fel-fångst
    const { ProjectionRegistry } = await import("@/server/local-first/projections/registry");
    const reg = new ProjectionRegistry();
    reg.register({
      entity: "matter",
      projection: {
        pathFor: () => { throw new Error("oavsiktlig krasch"); },
        serialize: (x: unknown) => JSON.stringify(x),
        deserialize: (s: string) => JSON.parse(s),
      },
      ownsPath: (p) => p.startsWith("matters/"),
    });
    const exporter = new PostgresExporter(      makePrismaMock({ matters: [sampleMatter] }) as never,
      fs,
      reg,
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await exporter.exportOrganization("org-1");
    expect(result.entities.matter).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/oavsiktlig krasch/);
    spy.mockRestore();
  });
});
