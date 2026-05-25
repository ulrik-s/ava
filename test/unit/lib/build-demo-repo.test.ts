/**
 * Tester för konsoliderad demo-seed.
 *
 * `build-demo-repo.ts` kör nu `buildSeed()` (samma som docker-firma-seedet)
 * med demo-specifika opts. Vi testar pipeline:n: buildSeed → seedToFiles
 * och verifierar att resultatet:
 *   - innehåller alla viktiga entity-typer
 *   - använder den demo-org-id:n vi skickat in
 *   - skriver users med "u-anna" som ADMIN (legacy-id för gh-pages-demon)
 */

import { describe, it, expect } from "vitest";
import { buildSeed, seedToFiles } from "../../../tooling/scripts/seed-data";

const DEMO_ARGS = {
  orgId: "demo-firma-ab",
  currentUserId: "u-anna",
  emailDomain: "ava.demo",
  organizationName: "Demo Advokatbyrå AB",
} as const;

describe("konsoliderad demo-seed", () => {
  const seed = buildSeed(DEMO_ARGS);
  const files = seedToFiles(seed);

  function byPrefix(prefix: string): typeof files {
    return files.filter((f) => f.path.startsWith(prefix) && f.path.endsWith(".json"));
  }

  it("rik datamängd: 5 users, ≥10 matters, ≥10 contacts, ≥10 documents", () => {
    expect(byPrefix(".ava/users/")).toHaveLength(5);
    expect(byPrefix("matters/active/").length).toBeGreaterThanOrEqual(10);
    expect(byPrefix("contacts/").length).toBeGreaterThanOrEqual(10);
    expect(byPrefix("documents/").length).toBeGreaterThanOrEqual(10);
  });

  it("avbetalningsplaner + payments-rader finns", () => {
    expect(byPrefix("payment-plans/").length).toBeGreaterThanOrEqual(3);
    expect(byPrefix("payments/").length).toBeGreaterThan(0);
  });

  it("kalender-events och tasks finns över flera användare", () => {
    expect(byPrefix("calendar/").length).toBeGreaterThanOrEqual(15);
    expect(byPrefix("tasks/").length).toBeGreaterThan(0);
  });

  it("alla entiteter får demo-orgId", () => {
    const withOrg = files
      .map((f) => f.data as { organizationId?: string })
      .filter((d) => d.organizationId !== undefined);
    expect(withOrg.length).toBeGreaterThan(0);
    for (const d of withOrg) {
      expect(d.organizationId).toBe("demo-firma-ab");
    }
  });

  it("admin-användaren har id u-anna + role=ADMIN (legacy-id för gh-pages)", () => {
    const userFile = files.find((f) => f.path === ".ava/users/user@ava.demo.json");
    expect(userFile).toBeDefined();
    const u = userFile!.data as { id: string; role: string; email: string };
    expect(u.id).toBe("u-anna");
    expect(u.role).toBe("ADMIN");
    expect(u.email).toBe("user@ava.demo");
  });

  it("e-mail-domän följer emailDomain-opten på alla users", () => {
    const userFiles = byPrefix(".ava/users/");
    for (const f of userFiles) {
      const u = f.data as { email: string };
      expect(u.email).toMatch(/@ava\.demo$/);
    }
  });

  it("organization heter Demo Advokatbyrå AB", () => {
    const orgFile = files.find((f) => f.path === ".ava/organizations/demo-firma-ab.json");
    expect(orgFile).toBeDefined();
    expect((orgFile!.data as { name: string }).name).toBe("Demo Advokatbyrå AB");
  });

  it("inga referenser till legacy 'current-user' i demo-builden", () => {
    // Alla createdById/checkedById/recordedById ska peka på u-anna istället
    const serialized = JSON.stringify(files);
    expect(serialized).not.toContain("current-user");
  });
});
