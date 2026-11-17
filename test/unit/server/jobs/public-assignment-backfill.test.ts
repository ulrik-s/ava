/**
 * Engångsuppdateringen av byråns lista över offentligt uppdrag (#1640) mot en
 * riktig in-memory-store: de fyra typerna läggs till och markeras en gång,
 * byråns egen stavning behålls, och inga ärenden eller anteckningar rörs.
 */
import { describe, expect, it, vi } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import {
  backfillPublicAssignmentTypes, DEFAULT_PUBLIC_ASSIGNMENT_TYPES, withDefaultPublicAssignmentTypes,
} from "@/lib/server/jobs/public-assignment-backfill";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { prebakeJoins } from "@/lib/shared/demo-source";
import { asId } from "@/lib/shared/schemas/ids";

const ORG = asId<"OrganizationId">("org-a");
const ALL = ["Offentlig försvarare", "Målsägandebiträde", "Förvaltarskap", "Särskild företrädare"];

function setup(org: Record<string, unknown>) {
  const source = prebakeJoins({
    organizations: [{ id: ORG, name: "Byrån", ...org }],
    matters: [{ id: "m1", organizationId: ORG, matterNumber: "2026-1", title: "T", matterType: "Offentlig försvarare", paymentMethod: "PENDING" }],
  });
  return buildInMemoryRepositories(new LocalStore(source, async () => {}));
}

describe("withDefaultPublicAssignmentTypes", () => {
  it("lägger till saknade typer sist och markerar alla fyra", () => {
    expect(withDefaultPublicAssignmentTypes(["Bodelning"])).toEqual({
      matterTypes: ["Bodelning", ...ALL], publicAssignmentMatterTypes: ALL,
    });
    expect(DEFAULT_PUBLIC_ASSIGNMENT_TYPES).toEqual(ALL);
  });

  it("en befintlig typ med annat skiftläge återanvänds med byråns stavning", () => {
    expect(withDefaultPublicAssignmentTypes(["offentlig FÖRSVARARE", "Förvaltarskap"])).toEqual({
      matterTypes: ["offentlig FÖRSVARARE", "Förvaltarskap", "Målsägandebiträde", "Särskild företrädare"],
      publicAssignmentMatterTypes: ["offentlig FÖRSVARARE", "Målsägandebiträde", "Förvaltarskap", "Särskild företrädare"],
    });
  });
});

describe("backfillPublicAssignmentTypes", () => {
  it("byrå utan fältet: typerna läggs till och markeras; andra körningen ändrar inget", async () => {
    const repos = setup({ matterTypes: ["Bodelning", "målsägandebiträde"] });
    expect(await backfillPublicAssignmentTypes(repos, [ORG], () => {})).toEqual({ organizations: 1, failed: 0 });
    const org = await repos.organizations.getById(ORG);
    expect(org?.matterTypes).toEqual(["Bodelning", "målsägandebiträde", "Offentlig försvarare", "Förvaltarskap", "Särskild företrädare"]);
    expect(org?.publicAssignmentMatterTypes).toEqual(["Offentlig försvarare", "målsägandebiträde", "Förvaltarskap", "Särskild företrädare"]);

    expect(await backfillPublicAssignmentTypes(repos, [ORG], () => {})).toEqual({ organizations: 0, failed: 0 });
    expect(await repos.organizations.getById(ORG)).toEqual(org);
  });

  it("ändrar inga ärenden och skriver inga anteckningar", async () => {
    const repos = setup({ matterTypes: [] });
    await backfillPublicAssignmentTypes(repos, [ORG], () => {});
    expect((await repos.matters.getById(asId<"MatterId">("m1")))?.paymentMethod).toBe("PENDING");
    expect(await repos.serviceNotes.listByMatter(asId<"MatterId">("m1"), ORG)).toEqual([]);
  });

  it.each([
    ["tom lista", []],
    ["en lista", ["Bodelning"]],
  ])("fältet satt (%s): ingenting ändras, inget läggs tillbaka", async (_label, marked) => {
    const repos = setup({ matterTypes: ["Bodelning"], publicAssignmentMatterTypes: marked });
    expect(await backfillPublicAssignmentTypes(repos, [ORG], () => {})).toEqual({ organizations: 0, failed: 0 });
    expect(await repos.organizations.getById(ORG)).toMatchObject({ matterTypes: ["Bodelning"], publicAssignmentMatterTypes: marked });
  });

  it("okänd byrå hoppas över", async () => {
    const repos = setup({});
    expect(await backfillPublicAssignmentTypes(repos, [asId<"OrganizationId">("saknas")], () => {})).toEqual({ organizations: 0, failed: 0 });
  });

  it("ett fel på en byrå räknas och loggas; resten körs, och inget kastas", async () => {
    const repos = setup({ matterTypes: [] });
    const onError = vi.fn();
    const organizations = {
      getById: vi.fn().mockRejectedValueOnce(new Error("db nere"))
        .mockImplementation((id: typeof ORG) => repos.organizations.getById(id)),
      update: (id: typeof ORG, patch: Parameters<typeof repos.organizations.update>[1]) => repos.organizations.update(id, patch),
    };
    const result = await backfillPublicAssignmentTypes({ organizations }, [asId<"OrganizationId">("org-x"), ORG], onError);
    expect(result).toEqual({ organizations: 1, failed: 1 });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("byrå org-x: Error: db nere"));
    expect((await repos.organizations.getById(ORG))?.publicAssignmentMatterTypes).toEqual(ALL);
  });
});
