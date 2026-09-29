/**
 * `derivedId` (#1276) — id:n som ett köat anrop skapar ska bli SAMMA när
 * servern kör om anropet: härledda ur anropets id (fröet) och radens roll.
 */
import { describe, expect, it } from "vitest-compat";
import { derivedId } from "@/lib/shared/sync/derived-id";
import { isUuid, uuidv7 } from "@/lib/shared/uuid";

const SEED = "01928f3a-1b2c-7d4e-8f00-112233445566";

describe("derivedId", () => {
  it("samma frö och roll → samma id (klient och server skapar samma rad)", () => {
    expect(derivedId(SEED, "payment")).toBe(derivedId(SEED, "payment"));
  });

  it("olika roller → olika id", () => {
    expect(derivedId(SEED, "payment")).not.toBe(derivedId(SEED, "serviceNote"));
  });

  it("olika frön → olika id", () => {
    expect(derivedId(uuidv7(), "payment")).not.toBe(derivedId(uuidv7(), "payment"));
  });

  it("ett giltigt UUIDv7 med fröets tidsstämpel (B-tree-lokalitet)", () => {
    const id = derivedId(SEED, "writeOff");
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe("7");
    expect("89ab").toContain(id[19] ?? "");
    expect(id.slice(0, 13)).toBe(SEED.slice(0, 13));
  });

  it("ett frö som inte är ett uuid → tidsstämpeln nollas, id:t är fortfarande giltigt", () => {
    const id = derivedId("inte-ett-uuid", "x");
    expect(isUuid(id)).toBe(true);
    expect(id.slice(0, 13)).toBe("00000000-0000");
  });

  it("tusen roller ger tusen olika id (ingen kollision i ett stort anrop)", () => {
    const ids = new Set(Array.from({ length: 1000 }, (_, i) => derivedId(SEED, `row:${i}`)));
    expect(ids.size).toBe(1000);
  });
});
