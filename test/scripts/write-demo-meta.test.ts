/**
 * `buildDemoMeta` är seed → meta.json-transformen som tar bort behovet av
 * hårdkodade demo-identifierare i web-appen. Testen lockar fast schemat och
 * de defensiva validerings-kasten.
 */
import { describe, it, expect } from "vitest-compat";
import { buildDemoMeta } from "../../tooling/scripts/write-demo-meta";
import { createIdTranslator } from "../../tooling/demo-generator/id-translator";
import { isUuid } from "../../src/lib/shared/uuid";
import { CURRENT_SCHEMA_VERSION } from "../../src/lib/shared/schema-version";

const FIXED_NOW = new Date("2026-05-31T10:00:00.000Z");

function seed(overrides?: { orgId?: string; orgName?: string; users?: Array<Record<string, unknown>> }) {
  return {
    organizations: [{ id: overrides?.orgId ?? "demo-firma-ab", name: overrides?.orgName ?? "Demo Advokatbyrå AB" }],
    users: overrides?.users ?? [
      { id: "u-anna", name: "Anna Advokat", email: "anna@ava.demo", role: "ADMIN", title: "Senior partner" },
      { id: "u-bjorn", name: "Björn Bauer", email: "bjorn@ava.demo", role: "LAWYER", title: "Advokat" },
    ],
  };
}

describe("buildDemoMeta", () => {
  it("översätter org-id till UUID via translator", () => {
    const t = createIdTranslator();
    const meta = buildDemoMeta(seed(), t, FIXED_NOW);
    expect(isUuid(meta.organizationId)).toBe(true);
    expect(meta.organizationId).toBe(t.toUuid("demo-firma-ab"));
    expect(meta.organizationName).toBe("Demo Advokatbyrå AB");
  });

  it("user.id är UUID (deterministiskt från seed-id)", () => {
    const t = createIdTranslator();
    const meta = buildDemoMeta(seed(), t, FIXED_NOW);
    expect(isUuid(meta.users[0]!.id)).toBe(true);
    expect(meta.users[0]!.id).toBe(t.toUuid("u-anna"));
    expect(meta.users[0]!.name).toBe("Anna Advokat");
  });

  it("inkluderar deterministisk buildAt (ISO 8601)", () => {
    expect(buildDemoMeta(seed(), createIdTranslator(), FIXED_NOW).buildAt)
      .toBe("2026-05-31T10:00:00.000Z");
  });

  it("kastar om organization saknas", () => {
    expect(() => buildDemoMeta({ organizations: [], users: [] }, createIdTranslator(), FIXED_NOW))
      .toThrow(/Seed saknar organization/);
  });

  it("kastar om organization saknar id eller name", () => {
    expect(() => buildDemoMeta({ organizations: [{ id: "" }], users: [] }, createIdTranslator(), FIXED_NOW))
      .toThrow(/saknar id eller name/);
  });

  it("kastar om en user saknar obligatoriskt fält", () => {
    const bad = seed({ users: [{ id: "u-anna", email: "x", role: "ADMIN" }] }); // saknar name
    expect(() => buildDemoMeta(bad, createIdTranslator(), FIXED_NOW)).toThrow(/saknar id\/name\/role/);
  });

  it("title är optional", () => {
    const noTitle = seed({ users: [{ id: "u-x", name: "X", email: "x@ava", role: "ADMIN" }] });
    expect(buildDemoMeta(noTitle, createIdTranslator(), FIXED_NOW).users[0]!.title).toBeUndefined();
  });

  it("stämplar schemaVersion = CURRENT_SCHEMA_VERSION (ADR 0004)", () => {
    expect(buildDemoMeta(seed(), createIdTranslator(), FIXED_NOW).schemaVersion)
      .toBe(CURRENT_SCHEMA_VERSION);
  });
});
