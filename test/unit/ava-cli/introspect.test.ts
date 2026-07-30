/**
 * Introspektion av appRouter → CLI/MCP-yta. Verifierar att kända procedurer
 * dyker upp med rätt typ + att JSON-schema-serialiseringen är fail-soft.
 */

import { describe, it, expect } from "vitest-compat";
import { listProcedures, procedureTypeMap } from "../../../tooling/ava-cli/introspect";

describe("listProcedures", () => {
  it("hittar kända procedurer med rätt typ", () => {
    const procs = listProcedures();
    const byPath = new Map(procs.map((p) => [p.path, p]));
    expect(byPath.get("invoice.list")?.type).toBe("query");
    expect(byPath.get("invoice.createRadgivning")?.type).toBe("mutation");
    expect(byPath.get("contacts.getById")?.type).toBe("query");
  });

  it("är sorterad på path och icke-tom", () => {
    const procs = listProcedures();
    expect(procs.length).toBeGreaterThan(20);
    const paths = procs.map((p) => p.path);
    expect([...paths].sort((a, b) => a.localeCompare(b))).toEqual(paths);
  });

  it("serialiserar input-schema utan att kasta (fail-soft)", () => {
    const withInput = listProcedures().find((p) => p.path === "contacts.getById");
    // getById tar { id }; schemat serialiseras till ett objekt-JSON-schema.
    expect(withInput).toBeDefined();
    expect(() => JSON.stringify(withInput?.inputSchema)).not.toThrow();
  });
});

describe("procedureTypeMap", () => {
  it("mappar path → typ", () => {
    const map = procedureTypeMap(listProcedures());
    expect(map.get("invoice.list")).toBe("query");
    expect(map.get("invoice.createRadgivning")).toBe("mutation");
  });
});
