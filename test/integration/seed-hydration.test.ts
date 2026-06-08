/**
 * Hydratiserings-smoke: kör samma `buildSeed()` som demo-bygget använder
 * och validera att VARJE genererad fil parsar med sin projektion-schema.
 *
 * Bevisar att alla obligatoriska fält (t.ex. organizationId) faktiskt
 * sätts i seed:n — annars kraschar appen vid laddning i browsern (Zod-fel
 * → ingen data syns för användaren).
 *
 * Bakgrund: matter-contacts m.fl. saknade organizationId i seed-output:n
 * trots att schemat krävde det → demon visade tomma sektioner på GH Pages.
 * Det testet hade fångat det innan deploy.
 */

import { describe, it, expect } from "vitest-compat";
import { buildSeed, seedToFiles } from "../../tooling/scripts/seed-data";
import { buildDefaultRegistry } from "@/lib/server/local-first/projections/default-registry";

describe("seed-data hydration", () => {
  it("alla seed-genererade filer parsar med sina projektion-schemas", () => {
    const seed = buildSeed({
      orgId: "demo-firma-ab",
      currentUserId: "u-anna",
      emailDomain: "ava.demo",
      organizationName: "Demo Advokatbyrå AB",
    });
    const files = seedToFiles(seed);
    expect(files.length).toBeGreaterThan(100);

    const registry = buildDefaultRegistry();
    const failures: Array<{ path: string; error: string }> = [];

    for (const { path, data } of files) {
      const entry = registry.matchPath(path);
      if (!entry) continue; // ignorera paths utan projektion (sällsynt)
      try {
        // Schemat hydratiserar via projection.deserialize (samma path som
        // ProjectionHydrator kör i browsern vid clone). Append-projektioner
        // (JSONL) har deserializeLine — vi täcker bara JSON-projektioner här.
        const proj = entry.projection as { deserialize?: (s: string) => unknown };
        if (typeof proj.deserialize !== "function") continue;
        proj.deserialize(JSON.stringify(data));
      } catch (err) {
        failures.push({
          path,
          error: err instanceof Error ? err.message.slice(0, 300) : String(err),
        });
      }
    }

    if (failures.length > 0) {
      // Lista UNIKA path-prefix för snabb diagnostisk
      const prefixes = new Set(failures.map((f) => f.path.split("/")[0]));
      const summary = failures.slice(0, 3).map((f) => `  ${f.path}\n    ${f.error.slice(0, 200)}`).join("\n");
      throw new Error(
        `${failures.length} seed-fil(er) misslyckades med hydration (prefix: ${[...prefixes].join(", ")}):\n${summary}` +
        (failures.length > 3 ? `\n  …och ${failures.length - 3} till` : ""),
      );
    }
  });

  it("alla entitetstyper med organizationId-fält har det satt", () => {
    const seed = buildSeed({ orgId: "test-org" });
    const files = seedToFiles(seed);
    const registry = buildDefaultRegistry();

    // Lista entiteter där projektion-schemat har required organizationId
    const requiresOrgId = [
      "contacts/", "matters/", "matter-contacts/",
      "documents/", "time-entries/", "expenses/", "invoices/",
      ".ava/users/",
      // .ava/organizations/ — organisationen ÄR själv organisationen,
      // ingen organizationId nödvändig
    ];

    for (const { path, data } of files) {
      const needsOrg = requiresOrgId.some((p) => path.startsWith(p));
      if (!needsOrg) continue;
      const entry = registry.matchPath(path);
      if (!entry) continue;
      expect((data as { organizationId?: unknown }).organizationId, `${path} ska ha organizationId`).toBe("test-org");
    }
  });
});
