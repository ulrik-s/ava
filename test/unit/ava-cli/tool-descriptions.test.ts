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
    const p = PROCS.find((x) => x.path === "billingRun.list")!;
    expect(isPaginated(p.inputSchema)).toBe(false);
    expect(withPageSizeDefault(p.inputSchema, { matterId: "m-1" })).toEqual({ matterId: "m-1" });
  });

  it("de tidigare opaginerade listorna sidas nu (#1011)", () => {
    for (const path of ["invoice.list", "paymentPlan.list", "task.list"]) {
      expect(isPaginated(PROCS.find((x) => x.path === path)!.inputSchema), path).toBe(true);
    }
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

/**
 * Datumfältens JSON-form (#1010). `z.coerce.date()` i routrarna + override:n i
 * `introspect.ts` ger `{ type: "string", format: "date-time" }` — det en
 * JSON-klient faktiskt kan skicka. Vakten sist är den generella: ett HELT
 * otypat fält (`{}`) är alltid ett hål i annonseringen, oavsett orsak.
 */
describe("datumfält är typade i annonserade scheman (#1010)", () => {
  it("calendar.create.startAt är en date-time-sträng", () => {
    const s = PROCS.find((p) => p.path === "calendar.create")!.inputSchema as { properties: Record<string, unknown> };
    expect(s.properties.startAt).toEqual({ type: "string", format: "date-time" });
  });

  it("timeEntry.list.from/to är date-time-strängar", () => {
    const s = PROCS.find((p) => p.path === "timeEntry.list")!.inputSchema as { properties: Record<string, unknown> };
    expect(s.properties.from).toEqual({ type: "string", format: "date-time" });
    expect(s.properties.to).toEqual({ type: "string", format: "date-time" });
  });

  it("inget fält i något annonserat schema är helt otypat", () => {
    const untyped: string[] = [];
    const walk = (path: string, node: unknown): void => {
      if (node === null || typeof node !== "object") return;
      const s = node as Record<string, unknown>;
      const props = s.properties as Record<string, unknown> | undefined;
      if (props) {
        for (const [key, value] of Object.entries(props)) {
          const rest = Object.keys(value as object).filter((k) => k !== "description" && k !== "default");
          if (rest.length === 0) untyped.push(`${path}.${key}`);
          walk(`${path}.${key}`, value);
        }
      }
      for (const branch of ["items", "anyOf", "allOf", "oneOf"]) {
        const v = s[branch];
        if (Array.isArray(v)) v.forEach((x, i) => walk(`${path}[${i}]`, x));
        else if (v) walk(path, v);
      }
    };
    for (const p of PROCS) walk(p.path, p.inputSchema);
    expect(untyped, `otypade fält: ${untyped.join(", ")}`).toEqual([]);
  });
});
