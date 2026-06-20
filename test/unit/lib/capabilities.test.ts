/**
 * `capabilitiesForTier` (ADR 0027 / #639) — server-beroende förmågor är AV i
 * demon, PÅ i self-hosted.
 */

import { describe, it, expect } from "vitest-compat";
import { capabilitiesForTier, DEMO_CAPABILITIES, SELF_HOSTED_CAPABILITIES } from "@/lib/shared/capabilities";

describe("capabilitiesForTier (ADR 0027)", () => {
  it("demo → alla server-beroende förmågor av", () => {
    expect(capabilitiesForTier("demo")).toEqual(DEMO_CAPABILITIES);
    expect(Object.values(DEMO_CAPABILITIES).every((v) => v === false)).toBe(true);
  });

  it("self-hosted → alla förmågor på", () => {
    expect(capabilitiesForTier("self-hosted")).toEqual(SELF_HOSTED_CAPABILITIES);
    expect(Object.values(SELF_HOSTED_CAPABILITIES).every((v) => v === true)).toBe(true);
  });

  it("llm-flaggan styr den enda demo-dolda affordansen i slice 1", () => {
    expect(capabilitiesForTier("demo").llm).toBe(false);
    expect(capabilitiesForTier("self-hosted").llm).toBe(true);
  });
});
