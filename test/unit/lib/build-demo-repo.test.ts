/**
 * Tester för demo-repo-builder. Säkerställer att vi producerar
 * giltiga JSON-filer som AVA-projektionerna kan hydratisera.
 */

import { describe, it, expect } from "vitest";
import { buildDemoData } from "../../../scripts/build-demo-repo";
import { matterProjectionSchema } from "@/server/local-first/projections/matter";
import { contactProjectionSchema } from "@/server/local-first/projections/contact";
import { userProjectionSchema } from "@/server/local-first/projections/user";

describe("buildDemoData", () => {
  const data = buildDemoData();

  it("returnerar minst 3 matters, 5 contacts, 2 users", () => {
    expect(data.matters.length).toBeGreaterThanOrEqual(3);
    expect(data.contacts.length).toBeGreaterThanOrEqual(5);
    expect(data.users.length).toBeGreaterThanOrEqual(2);
  });

  it("alla matters validerar mot matterProjectionSchema", () => {
    for (const m of data.matters) {
      expect(() => matterProjectionSchema.parse(m.data)).not.toThrow();
    }
  });

  it("alla contacts validerar mot contactProjectionSchema", () => {
    for (const c of data.contacts) {
      expect(() => contactProjectionSchema.parse(c.data)).not.toThrow();
    }
  });

  it("alla users validerar mot userProjectionSchema", () => {
    for (const u of data.users) {
      expect(() => userProjectionSchema.parse(u.data)).not.toThrow();
    }
  });

  it("alla paths följer projektion-konventionen", () => {
    for (const m of data.matters) expect(m.path).toMatch(/^matters\/active\/.+\.json$/);
    for (const c of data.contacts) expect(c.path).toMatch(/^contacts\/.+\.json$/);
    for (const u of data.users) expect(u.path).toMatch(/^\.ava\/users\/.+\.json$/);
  });

  it("matter-nummer är unika", () => {
    const numbers = data.matters.map((m) => (m.data as { matterNumber: string }).matterNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("contact-id:n är unika", () => {
    const ids = data.contacts.map((c) => (c.data as { id: string }).id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
