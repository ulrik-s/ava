/**
 * Svarskontrakten på MCP-lagret (#1012).
 *
 * Kontrakten bor i ett sidoregister (`tool-outputs.ts`), inte som `.output()`
 * på procedurerna — tRPC:s `.output()` ersätter klient-typen och ett löst
 * schema smalnar då av hela UI:t. Priset för sidoregistret är drift-risk, och
 * det här testet betalar det: varje kontrakt måste peka på en procedur som
 * finns, och varje kontrakt måste vara ett objekt (MCP:s krav på
 * `outputSchema`-toppnivån).
 */

import { describe, it, expect } from "vitest-compat";
import { listProcedures } from "../../../tooling/ava-cli/introspect";
import { outputDescribedPaths, toolOutputJsonSchema } from "../../../tooling/ava-cli/tool-outputs";

const PATHS = new Set(listProcedures().map((p) => p.path));

describe("svarskontraktens register", () => {
  it("varje kontrakt hör till en procedur som finns", () => {
    const orphans = outputDescribedPaths().filter((p) => !PATHS.has(p));
    expect(orphans, `kontrakt utan procedur: ${orphans.join(", ")}`).toEqual([]);
  });

  it("läse-ytan är täckt", () => {
    // Scope-beslutet i #1012: listor + getById + user.current med OBJEKT-svar.
    // Krymper listan har någon tagit bort ett kontrakt — det ska synas här.
    expect([...outputDescribedPaths()].sort()).toEqual([
      "contacts.list", "matter.getById", "matter.list", "timeEntry.list", "user.current", "user.list",
    ]);
  });

  it("varje kontrakt är ett objekt på toppnivån (MCP-kravet)", () => {
    for (const path of outputDescribedPaths()) {
      expect(toolOutputJsonSchema(path)?.type, path).toBe("object");
    }
  });

  it("procedurer utan kontrakt → null, inte ett tomt schema", () => {
    expect(toolOutputJsonSchema("billingRun.list")).toBeNull();
    expect(toolOutputJsonSchema("finns.inte")).toBeNull();
  });

  it("datumfält annonseras som ISO-sträng — formen structuredContent bär", () => {
    const schema = toolOutputJsonSchema("timeEntry.list") as {
      properties: { entries: { items: { properties: { date: unknown } } } };
    };
    // dateish = union(Date, string): date-grenen får string/date-time av
    // override:n, sträng-grenen är redan string.
    expect(JSON.stringify(schema.properties.entries.items.properties.date)).toContain('"date-time"');
  });

  it("kontrakten är lösa — extra fält är tillåtna", () => {
    // Ett strippande kontrakt vore en lögn: structuredContent bär HELA svaret.
    const schema = toolOutputJsonSchema("matter.getById") as { additionalProperties?: unknown };
    expect(schema.additionalProperties).not.toBe(false);
  });
});
