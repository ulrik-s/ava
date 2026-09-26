import { describe, expect, it } from "vitest-compat";
import { shouldClassifyOnClient } from "@/lib/client/jobs/classify-policy";

/** #1220: servern äger klassificeringen när den har en jobbkö OCH bytes:en. */
describe("shouldClassifyOnClient", () => {
  it("server-jobbkö + bytes på servern → klienten avstår", () => {
    expect(shouldClassifyOnClient(true, true)).toBe(false);
  });
  it("demo (ingen jobbkö) eller bytes bara lokalt → klienten klassificerar", () => {
    expect(shouldClassifyOnClient(false, true)).toBe(true);
    expect(shouldClassifyOnClient(true, false)).toBe(true);
    expect(shouldClassifyOnClient(false, false)).toBe(true);
  });
});
