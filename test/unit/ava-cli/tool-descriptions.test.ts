/**
 * Verktygsbeskrivningarnas drift-vakt (#1008).
 *
 * Beskrivningarna bor i en egen fil så de går att granska som prosa. Priset för
 * det är att de kan hamna ur synk med `appRouter` — och det här testet är vad
 * som betalar priset. Det fäller åt BÅDA håll:
 *
 *   - en NY procedur utan beskrivning → röd (annars faller den tyst tillbaka
 *     till `"query foo.bar"`, precis det #1008 handlade om),
 *   - en beskrivning vars procedur försvunnit → röd (annars ackumuleras
 *     lögner om en yta som inte finns).
 */

import { describe, it, expect } from "vitest-compat";
import { listProcedures } from "../../../tooling/ava-cli/introspect";
import {
  describedPaths, isPaginated, MCP_DEFAULT_PAGE_SIZE, toolDescription, withPageSizeDefault,
} from "../../../tooling/ava-cli/tool-descriptions";

const PROCS = listProcedures();
const PATHS = new Set(PROCS.map((p) => p.path));

describe("beskrivningarna täcker hela appRouter-ytan", () => {
  it("varje procedur har en beskrivning", () => {
    const described = new Set(describedPaths());
    const missing = PROCS.map((p) => p.path).filter((p) => !described.has(p));
    expect(missing, `saknar beskrivning: ${missing.join(", ")}`).toEqual([]);
  });

  it("varje beskrivning hör till en procedur som finns", () => {
    const orphans = describedPaths().filter((p) => !PATHS.has(p));
    expect(orphans, `beskrivning utan procedur: ${orphans.join(", ")}`).toEqual([]);
  });

  it("ingen beskrivning är bara procedurnamnet", () => {
    // Fallbacken `"<typ> <path>"` är exakt den innehållslösa formen vi kom
    // ifrån — den får aldrig smyga tillbaka in via en tom sträng. Längdgolvet
    // är lågt med flit: "Byråns kontor." är en fullgod beskrivning av
    // `organization.listOffices`, och att kräva utfyllnad gör den sämre.
    for (const p of PROCS) {
      const d = toolDescription(p);
      expect(d, p.path).not.toBe(`${p.type} ${p.path}`);
      expect(d.length, `${p.path} har en misstänkt kort beskrivning`).toBeGreaterThan(12);
      expect(d, `${p.path} ska vara en mening`).toMatch(/\.$/);
    }
  });
});

describe("sidstorlek på MCP-ytan", () => {
  const paginated = PROCS.filter((p) => isPaginated(p.inputSchema));

  it("de paginerade procedurerna känns igen", () => {
    // Regressionsvakt för #1008:s rotorsak: `timeEntry.list` HADE paginering
    // hela tiden, men schemat föll till null på ett date-fält → osynligt.
    expect(paginated.map((p) => p.path)).toContain("timeEntry.list");
    expect(paginated.length).toBeGreaterThan(4);
  });

  it("beskrivningen berättar om sidstorleken", () => {
    for (const p of paginated) expect(toolDescription(p)).toMatch(/rader per sida/);
  });

  it("sidstorleken fylls i när modellen inte angett någon", () => {
    const p = paginated.find((x) => x.path === "timeEntry.list")!;
    expect(withPageSizeDefault(p.inputSchema, {})).toEqual({ pageSize: MCP_DEFAULT_PAGE_SIZE });
    expect(withPageSizeDefault(p.inputSchema, undefined)).toEqual({ pageSize: MCP_DEFAULT_PAGE_SIZE });
  });

  it("modellens egen sidstorlek vinner", () => {
    const p = paginated.find((x) => x.path === "timeEntry.list")!;
    expect(withPageSizeDefault(p.inputSchema, { pageSize: 100 })).toEqual({ pageSize: 100 });
  });

  it("opaginerade procedurer rörs inte", () => {
    const p = PROCS.find((x) => x.path === "invoice.list")!;
    expect(isPaginated(p.inputSchema)).toBe(false);
    expect(withPageSizeDefault(p.inputSchema, { matterId: "m-1" })).toEqual({ matterId: "m-1" });
  });
});

describe("introspektionen tappar inte scheman på date-fält (#1008)", () => {
  it("timeEntry.list annonserar sina filter och sin paginering", () => {
    // Före fixen: `z.date()` fällde HELA schemat till null via
    // `unrepresentable: "throw"`, och verktyget såg parameterlöst ut.
    const props = Object.keys((PROCS.find((p) => p.path === "timeEntry.list")!.inputSchema as { properties: object }).properties);
    expect(props).toEqual(expect.arrayContaining(["matterId", "userId", "from", "to", "page", "pageSize"]));
  });

  it("mutationer med datum annonserar sina fält", () => {
    for (const path of ["calendar.create", "task.create", "document.updateMetadata"]) {
      const schema = PROCS.find((p) => p.path === path)!.inputSchema as { properties?: object } | null;
      expect(Object.keys(schema?.properties ?? {}).length, `${path} ska ha fält`).toBeGreaterThan(0);
    }
  });
});
