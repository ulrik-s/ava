/**
 * Hydratiserings-smoke: kör samma `buildSeed()` som demo-bygget använder
 * och validera att VARJE genererad fil parsar med sitt entitets-schema.
 *
 * Bevisar att alla obligatoriska fält (t.ex. organizationId) faktiskt
 * sätts i seed:n — annars kraschar appen vid laddning i browsern.
 *
 * Sedan #420 (ADR 0016) finns ingen MemFs/projektion-hydrering: demon bygger
 * en `DemoSource` direkt via `pathToSourceKey`. Den här smoke:n validerar
 * därför mot `ENTITY_REGISTRY` — den kanoniska sanningskällan för varje
 * entitets schema + gitPrefix — via samma path→entitet-mappning.
 */

import { describe, it, expect } from "vitest-compat";
import { pathToSourceKey } from "@/lib/client/demo/demo-source-keys";
import { ENTITY_NAME_BY_SOURCE_KEY } from "@/lib/server/data-store/in-memory/entity-source-keys";
import { ENTITY_REGISTRY } from "@/lib/shared/schemas";
import { buildSeed, seedToFiles } from "../../tooling/scripts/seed-data";

describe("seed-data hydration", () => {
  it("alla seed-genererade filer parsar med sina entitets-schemas", () => {
    const seed = buildSeed({
      orgId: "demo-firma-ab",
      currentUserId: "u-anna",
      emailDomain: "ava.demo",
      organizationName: "Demo Advokatbyrå AB",
    });
    const files = seedToFiles(seed);
    expect(files.length).toBeGreaterThan(100);

    const failures: Array<{ path: string; error: string }> = [];

    for (const { path, data } of files) {
      const sourceKey = pathToSourceKey(path);
      if (!sourceKey) continue; // paths utan entitet (meta.json, innehåll) hoppas
      const entity = ENTITY_NAME_BY_SOURCE_KEY[sourceKey];
      const entry = entity ? ENTITY_REGISTRY[entity] : undefined;
      if (!entry) continue;
      try {
        // Samma validering som tRPC-routrarnas input + DemoDataScope kör i
        // browsern: entitetens kanoniska zod-schema måste acceptera raden.
        entry.schema.parse(data);
      } catch (err) {
        failures.push({
          path,
          error: err instanceof Error ? err.message.slice(0, 300) : String(err),
        });
      }
    }

    if (failures.length > 0) {
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

    // Entiteter där schemat har required organizationId. (.ava/organizations/
    // — organisationen ÄR själv organisationen, ingen organizationId behövs.)
    const requiresOrgId = [
      "contacts/", "matters/", "matter-contacts/",
      "documents/", "time-entries/", "expenses/", "invoices/",
      ".ava/users/",
    ];

    for (const { path, data } of files) {
      const needsOrg = requiresOrgId.some((p) => path.startsWith(p));
      if (!needsOrg) continue;
      if (!pathToSourceKey(path)) continue;
      expect((data as { organizationId?: unknown }).organizationId, `${path} ska ha organizationId`).toBe("test-org");
    }
  });
});
