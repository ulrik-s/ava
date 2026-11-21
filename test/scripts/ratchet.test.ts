/**
 * Ratchet-jämförelsen: nya avvikelser blir `added`, listade som inte längre
 * finns blir `gone`, båda sorterade och utan dubbletter.
 */
import { describe, expect, it } from "vitest-compat";
import { ratchetDiff } from "../../tooling/scripts/ratchet";

describe("ratchetDiff", () => {
  it("en funnen nyckel som inte är känd blir added", () => {
    expect(ratchetDiff(["a", "ny"], ["a"])).toEqual({ added: ["ny"], gone: [] });
  });

  it("en känd nyckel som inte längre finns blir gone", () => {
    expect(ratchetDiff(["a"], ["a", "borta"])).toEqual({ added: [], gone: ["borta"] });
  });

  it("added och gone är sorterade", () => {
    expect(ratchetDiff(["c", "a", "b"], ["z", "y"])).toEqual({ added: ["a", "b", "c"], gone: ["y", "z"] });
  });

  it("en nyckel som finns flera gånger räknas en gång", () => {
    expect(ratchetDiff(["x", "x", "x"], ["k", "k"])).toEqual({ added: ["x"], gone: ["k"] });
  });

  it("samma mängd i båda ger tomt utfall", () => {
    expect(ratchetDiff(new Set(["a", "b"]), ["b", "a"])).toEqual({ added: [], gone: [] });
  });
});
