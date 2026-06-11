import { describe, it, expect, vi } from "vitest-compat";
import { runRules, makeRulesJob, type RulesJobCaller } from "@/lib/server/local-first/rules-job";

function makeCaller(result: { planned?: number } = {}) {
  const scan = vi.fn(async () => result);
  const caller: RulesJobCaller = { paymentPlan: { scanDueReminders: scan } };
  return { caller, scan };
}

describe("runRules", () => {
  it("kör scanDueReminders med {}", async () => {
    const { caller, scan } = makeCaller({ planned: 0 });
    await runRules(caller);
    expect(scan).toHaveBeenCalledWith({});
  });

  it("loggar när påminnelser skapades", async () => {
    const { caller } = makeCaller({ planned: 3 });
    const log = vi.fn();
    await runRules(caller, { log });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("3"));
  });

  it("loggar inte vid noll planerade", async () => {
    const { caller } = makeCaller({ planned: 0 });
    const log = vi.fn();
    await runRules(caller, { log });
    expect(log).not.toHaveBeenCalled();
  });
});

describe("makeRulesJob", () => {
  it("returnerar ett PeerJob vars act kör reglerna", async () => {
    const { caller, scan } = makeCaller({ planned: 1 });
    const job = makeRulesJob();
    expect(job.message).toMatch(/regler/i);
    await job.act(caller as unknown as Parameters<typeof job.act>[0]);
    expect(scan).toHaveBeenCalledTimes(1);
  });
});
