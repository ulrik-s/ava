import { describe, it, expect } from "vitest-compat";
import { lookup, template, templateValue } from "@/lib/server/rules/template";

describe("lookup", () => {
  const data = {
    event: { id: "e1", payload: { matterId: "m1", invoices: [{ amount: 5000 }, { amount: 7000 }] } },
  };

  it("läser nested path med dotter", () => {
    expect(lookup(data, "event.payload.matterId")).toBe("m1");
  });

  it("läser array-index numeriskt", () => {
    expect(lookup(data, "event.payload.invoices.0.amount")).toBe(5000);
  });

  it("returnerar undefined för path som inte finns", () => {
    expect(lookup(data, "event.foo.bar")).toBeUndefined();
  });

  it("returnerar undefined vid null-mellan-led", () => {
    expect(lookup({ a: null }, "a.b.c")).toBeUndefined();
  });
});

describe("template", () => {
  const ctx = { event: { ts: "2026-05-18", payload: { name: "Anna" } } };

  it("substituerar enkel variabel i sträng", () => {
    expect(template("Hej {{event.payload.name}}!", ctx)).toBe("Hej Anna!");
  });

  it("unwrappar single-token templates till primitivt värde", () => {
    expect(template("{{event.payload.name}}", ctx)).toBe("Anna");
  });

  it("returnerar tom sträng för saknad variabel i fler-token-mall", () => {
    expect(template("foo {{event.payload.missing}} bar", ctx)).toBe("foo  bar");
  });

  it("kör 'upper'-filter", () => {
    expect(template("{{event.payload.name | upper}}", ctx)).toBe("ANNA");
  });

  it("kör 'date'-filter på ISO-sträng", () => {
    expect(template("{{event.ts | date}}", { event: { ts: "2026-05-18T10:00:00Z" } })).toBe("2026-05-18");
  });
});

describe("templateValue", () => {
  const ctx = { event: { payload: { id: "e1", arr: [1, 2] } } };

  it("substituerar i nestade objekt", () => {
    const out = templateValue({ a: "{{event.payload.id}}", b: 42 }, ctx);
    expect(out).toEqual({ a: "e1", b: 42 });
  });

  it("substituerar i array av strängar", () => {
    expect(templateValue(["{{event.payload.id}}", "static"], ctx)).toEqual(["e1", "static"]);
  });

  it("lämnar nummer/boolean/null orörda", () => {
    expect(templateValue({ a: 1, b: true, c: null }, ctx)).toEqual({ a: 1, b: true, c: null });
  });
});
