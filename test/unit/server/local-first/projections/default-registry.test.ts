/**
 * Tester för `buildDefaultRegistry` — bekräftar att alla entiteter är
 * registrerade och att path-routing fungerar i bägge riktningar.
 */

import { describe, it, expect } from "vitest";
import { buildDefaultRegistry } from "@/lib/server/local-first/projections/default-registry";

describe("buildDefaultRegistry", () => {
  const registry = buildDefaultRegistry();

  it("har matter, contact och user registrerade", () => {
    expect(registry.entities().sort()).toEqual([
      "contact", "document", "expense", "invoice", "matter",
      "matterContact", "timeEntry", "user",
    ]);
  });

  it("matchPath på matter-fil ger matter-projection", () => {
    expect(registry.matchPath("matters/active/abc.json")?.entity).toBe("matter");
    expect(registry.matchPath("matters/archive/2025/x.json")?.entity).toBe("matter");
  });

  it("matchPath på contact-fil ger contact", () => {
    expect(registry.matchPath("contacts/c1.json")?.entity).toBe("contact");
  });

  it("matchPath på user-fil ger user", () => {
    expect(registry.matchPath(".ava/users/anna@x.se.json")?.entity).toBe("user");
  });

  it("matchPath returnerar null för okänd path-prefix", () => {
    expect(registry.matchPath("dokument/random.txt")).toBeNull();
    expect(registry.matchPath("events/2026/05/18.jsonl")).toBeNull();
  });
});
