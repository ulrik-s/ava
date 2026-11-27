/**
 * updateOrgSettings (#2176): byråinställningarna utan tRPC-kontext — vem som
 * får ändra vad och normaliseringen av listorna. Följden för befintliga
 * ärenden (#1640) täcks av routertesterna.
 */
import { TRPCError } from "@trpc/server";
import { describe, it, expect } from "vitest-compat";
import type { Principal } from "@/lib/server/auth/principal";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { updateOrgSettings } from "@/lib/server/organization/settings";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import type { UserRole } from "@/lib/shared/schemas/enums";
import { asId } from "@/lib/shared/schemas/ids";

function setup(role: UserRole) {
  const dataStore = new DemoDataStore({
    organizations: [{
      id: "org-1", name: "Byrå", matterTypes: ["Brottmål"], publicAssignmentMatterTypes: null,
      documentKinds: ["Egen"],
    }],
  }, async () => {});
  const user: Principal = {
    id: asId<"UserId">("u-1"), email: "a@x", name: "Anna", role, organizationId: asId<"OrganizationId">("org-1"),
  };
  return { user, dataStore, repos: buildInMemoryRepositories(dataStore) };
}

describe("updateOrgSettings", () => {
  it("en medlem får bara ändra dokumenttyperna", async () => {
    const ctx = setup("LAWYER");
    await expect(updateOrgSettings(ctx, { name: "Ny byrå" })).rejects.toThrow(TRPCError);
    await expect(updateOrgSettings(ctx, { name: "Ny byrå" })).rejects.toThrow(/name/);
    const saved = await updateOrgSettings(ctx, { name: "Byrå", documentKinds: [" Hyresnämnd ", "Hyresnämnd"] });
    expect(saved.documentKinds).toEqual(["Hyresnämnd"]);
  });

  it("admin: ärendetyperna normaliseras och markeringen begränsas till dem", async () => {
    const ctx = setup("ADMIN");
    const saved = await updateOrgSettings(ctx, {
      matterTypes: [" Familjerätt ", "", "Familjerätt", "Brottmål"],
      publicAssignmentMatterTypes: ["Brottmål", "Okänd"],
    });
    expect(saved.matterTypes).toEqual(["Familjerätt", "Brottmål"]);
    expect(saved.publicAssignmentMatterTypes).toEqual(["Brottmål"]);
  });

  it("anroparens ändring lämnas orörd", async () => {
    const ctx = setup("ADMIN");
    const patch = { matterTypes: [" A "] };
    await updateOrgSettings(ctx, patch);
    expect(patch.matterTypes).toEqual([" A "]);
  });
});
