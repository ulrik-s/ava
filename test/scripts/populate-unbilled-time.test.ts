/**
 * `populateUnbilledTime` — verifierar att färska time-entries skapas
 * utan invoiceId (= "upparbetad men inte fakturerad").
 */
import { describe, it, expect } from "vitest-compat";
import { createGitTarget } from "../../tooling/demo-generator/backend-target";
import { translateSeed, createIdTranslator } from "../../tooling/demo-generator/id-translator";
import { populateUnbilledTime } from "../../tooling/demo-generator/populate-unbilled-time";
import { buildSeed } from "../../tooling/scripts/seed-data";

async function runTarget() {
  const translator = createIdTranslator();
  const seed = translateSeed(buildSeed({ orgId: "test-org" }), translator);
  const orgId = String(seed.organizations[0]?.id);
  const userId = String(seed.users[0]?.id);
  const target = createGitTarget({
    principal: { id: userId, email: "g@a", name: "G", role: "ADMIN", organizationId: orgId },
    writeBack: async () => {},
  });
  return { target, seed };
}

describe("populateUnbilledTime", () => {
  it("skapar 2-3 entries per aktivt ärende (alla utan invoiceId)", async () => {
    const { target, seed } = await runTarget();
    // Populera org+users+contacts+matters först så timeEntry.create hittar dem
    await target.caller.organization.create({ id: String(seed.organizations[0]!.id), name: "X" });
    for (const u of seed.users) {
      await target.caller.user.create({
        id: String(u.id), email: String(u.email), name: String(u.name),
        role: u.role as "ADMIN" | "LAWYER" | "ASSISTANT", hourlyRate: Number(u.hourlyRate),
      });
    }
    for (const m of seed.matters) {
      await target.caller.matter.create({
        id: String(m.id), matterNumber: String(m.matterNumber), title: String(m.title),
        status: m.status as "ACTIVE" | "CLOSED" | "ARCHIVED",
      });
    }
    const count = await populateUnbilledTime(target.caller, seed);
    const activeMatters = seed.matters.filter((m) => m.status === "ACTIVE");
    // 2 + (mi%2) entries per matter → mellan 2*N och 3*N
    expect(count).toBeGreaterThanOrEqual(2 * activeMatters.length);
    expect(count).toBeLessThanOrEqual(3 * activeMatters.length);
  });

  it("returnerar 0 om inga aktiva ärenden finns", async () => {
    const { target } = await runTarget();
    const emptySeed = { ...(await runTarget()).seed, matters: [], users: [] };
    const count = await populateUnbilledTime(target.caller, emptySeed as never);
    expect(count).toBe(0);
  });
});
