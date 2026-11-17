/**
 * `applyPaymentMethodToExistingMatters` (#1640) mot en riktig in-memory-store:
 * bara markerade typer med ett annat betalningssätt byts, i fast ordning (id),
 * så att ett köat anrops anteckningar får samma id i klient och server.
 */
import { describe, expect, it } from "vitest-compat";
import { applyPaymentMethodToExistingMatters } from "@/lib/server/billing/matter-payment-method";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { prebakeJoins } from "@/lib/shared/demo-source";
import { asId } from "@/lib/shared/schemas/ids";
import { derivedId } from "@/lib/shared/sync/derived-id";

const ORG = asId<"OrganizationId">("org-a");
const PA = "Offentlig försvarare";

function repos() {
  const m = (id: string, matterType: string, paymentMethod: string) => ({ id, organizationId: ORG, matterNumber: id, title: id, matterType, paymentMethod });
  return buildInMemoryRepositories(new LocalStore(prebakeJoins({
    organizations: [{ id: ORG, name: "Byrån" }],
    matters: [m("m-c", PA, "PRIVATE"), m("m-a", PA, "PENDING"), m("m-b", "Bodelning", "PENDING"), m("m-d", PA, "OFFENTLIGT_UPPDRAG")],
  }), async () => {}));
}

describe("applyPaymentMethodToExistingMatters", () => {
  it("byter markerade ärenden i id-ordning; anteckningarnas id följer den ordningen i ett köat anrop", async () => {
    const r = repos();
    const queued = { mutationId: "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", at: Date.UTC(2026, 9, 1) };
    const ctx = { orgId: ORG, user: { id: "u-1" }, queued };
    const changed = await applyPaymentMethodToExistingMatters(r, ctx, { publicAssignmentMatterTypes: [PA] });
    expect(changed).toEqual(["m-a", "m-c"]);
    expect((await r.matters.getById(asId<"MatterId">("m-b")))?.paymentMethod).toBe("PENDING");
    const [a] = await r.serviceNotes.listByMatter(asId<"MatterId">("m-a"), ORG);
    const [c] = await r.serviceNotes.listByMatter(asId<"MatterId">("m-c"), ORG);
    expect(a?.id).toBe(derivedId(queued.mutationId, "serviceNote"));
    expect(c?.id).toBe(derivedId(queued.mutationId, "serviceNote:2"));
  });

  it("utan markering ändras inget", async () => {
    const r = repos();
    expect(await applyPaymentMethodToExistingMatters(r, { orgId: ORG, user: { id: "u-1" } }, { publicAssignmentMatterTypes: null })).toEqual([]);
  });
});
