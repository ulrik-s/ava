/**
 * Korrelations-id:t (#1080).
 *
 * Id:t är det som gör en användarrapport sökbar: "det small klockan tio" →
 * id:t i felrutan → alla loggposter för just det anropet. Det ska därför gå
 * att läsa upp i telefon utan att bli fel, och det får inte gå att sätta
 * godtyckligt utifrån.
 */

import { describe, it, expect } from "vitest-compat";
import { newRequestId, REQUEST_ID_HEADER, requestIdFrom } from "@/lib/shared/observability/request-id";

const headers = (value?: string): { get(n: string): string | null } => ({
  get: (n) => (n === REQUEST_ID_HEADER && value !== undefined ? value : null),
});

describe("newRequestId", () => {
  it("har fast längd", () => {
    expect(newRequestId()).toHaveLength(12);
  });

  // 0/O och 1/I/L förväxlas när någon läser upp id:t över telefon — och det
  // är precis då id:t används.
  it("innehåller inga tecken som förväxlas i tal", () => {
    const ids = Array.from({ length: 200 }, newRequestId).join("");
    expect(ids).not.toMatch(/[01OIL]/);
  });

  it("är inte förutsägbart", () => {
    const ids = new Set(Array.from({ length: 500 }, newRequestId));
    expect(ids.size).toBe(500);
  });

  it("fördelar sig över hela alfabetet — ingen modulo-bias", () => {
    const seen = new Set(Array.from({ length: 500 }, newRequestId).join(""));
    expect(seen.size).toBeGreaterThan(25); // alfabetet har 31 tecken
  });
});

describe("requestIdFrom", () => {
  it("behåller klientens id när det har vår form", () => {
    expect(requestIdFrom(headers("ABCDEFGH2345"))).toBe("ABCDEFGH2345");
  });

  it("genererar när headern saknas", () => {
    expect(requestIdFrom(headers())).toHaveLength(12);
  });

  // Ett id utifrån är indata. Utan formkontrollen kan vem som helst sätta ett
  // id som krockar med en annan användares — eller smuggla in tecken som
  // bryter loggraden när den läses som JSON.
  it.each([
    ["fel längd", "ABC"],
    ["förbjudna tecken", "ABCDEFGH234O"],
    ["gemener", "abcdefgh2345"],
    ["citattecken", 'ABCDEFGH23"5'],
    ["radbrytning", "ABCDEFGH23\n5"],
    ["tomt", ""],
  ])("avvisar %s och genererar i stället", (_label, given) => {
    const id = requestIdFrom(headers(given));
    expect(id).not.toBe(given);
    expect(id).toHaveLength(12);
  });
});
