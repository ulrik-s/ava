import { describe, it, expect } from "vitest-compat";
import { composeJobs } from "@/lib/server/local-first/compose-jobs";
import type { PeerJob } from "@/lib/server/local-first/peer-loop";

function fakeJob(message: string, order: string[]): PeerJob {
  return { message, act: async () => { order.push(message); } };
}

describe("composeJobs", () => {
  it("tom lista → null", () => {
    expect(composeJobs([])).toBeNull();
    expect(composeJobs([null, undefined])).toBeNull();
  });

  it("ett jobb → returneras oförändrat", () => {
    const order: string[] = [];
    const j = fakeJob("a", order);
    expect(composeJobs([j])).toBe(j);
    expect(composeJobs([null, j, undefined])).toBe(j);
  });

  it("flera jobb → kör act:er i ordning + slår ihop message", async () => {
    const order: string[] = [];
    const composed = composeJobs([fakeJob("rules", order), fakeJob("fortnox", order)]);
    expect(composed).not.toBeNull();
    expect(composed!.message).toBe("rules; fortnox");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await composed!.act({} as any);
    expect(order).toEqual(["rules", "fortnox"]);
  });

  it("filtrerar bort null/undefined men behåller ordning", async () => {
    const order: string[] = [];
    const composed = composeJobs([null, fakeJob("rules", order), undefined, fakeJob("fortnox", order)]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await composed!.act({} as any);
    expect(order).toEqual(["rules", "fortnox"]);
  });
});
