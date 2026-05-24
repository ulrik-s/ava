/**
 * Tester för `generate-sqlite-schema`-funktionen — bevisar att den
 * korrekt transformerar en Postgres-schemafil till SQLite.
 */

import { describe, it, expect } from "vitest";
import { generate } from "../../../tooling/scripts/generate-sqlite-schema";

const PG_SCHEMA = `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Organization {
  id   String @id @default(cuid())
  name String
}
`;

describe("generate-sqlite-schema.generate", () => {
  it("byter provider till sqlite", () => {
    const out = generate(PG_SCHEMA);
    expect(out).toContain('provider = "sqlite"');
    expect(out).not.toContain('provider = "postgresql"');
  });

  it("behåller url = env(DATABASE_URL)", () => {
    const out = generate(PG_SCHEMA);
    expect(out).toContain('url      = env("DATABASE_URL")');
  });

  it("behåller alla modeller och fält", () => {
    const out = generate(PG_SCHEMA);
    expect(out).toContain("model Organization");
    expect(out).toContain("id   String @id @default(cuid())");
  });

  it("lägger till en VARNINGS-header (auto-generated)", () => {
    const out = generate(PG_SCHEMA);
    expect(out).toMatch(/^\/\/.*AUTO-GENERATED/i);
  });

  it("behåller generator-block oförändrat", () => {
    const out = generate(PG_SCHEMA);
    expect(out).toContain('provider = "prisma-client-js"');
  });
});
