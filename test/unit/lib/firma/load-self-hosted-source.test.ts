/**
 * `loadSelfHostedSource` — orkestrerar self-hosted-laddningen: klona repo:t
 * in i working copy:n (om ej redan klonad), hydrera DemoSource från den.
 */

import { describe, it, expect, vi } from "vitest";
import { makeFakeFsa } from "../../../helpers/fake-fsa";
import { makeFsaWriteBack } from "@/lib/client/firma/fsa-write-back";
import { loadSelfHostedSource } from "@/lib/client/firma/load-self-hosted-source";

describe("loadSelfHostedSource", () => {
  it("klonar när working copy saknar .git, hydrerar sedan", async () => {
    const fsa = makeFakeFsa();
    // Fake-clone: skriver entiteter + en .git-markör via write-back-pipelinen.
    const clone = vi.fn(async () => {
      const wb = makeFsaWriteBack({ handle: fsa.root });
      await wb({ entity: "matter", kind: "create", row: { id: "m1", organizationId: "o1", title: "T" } });
      // markera som klonad
      const { FsaIsoGitAdapter } = await import("@/lib/client/fsa/fs-adapter");
      await new FsaIsoGitAdapter(fsa.root).writeFile("/.git/HEAD", "ref: refs/heads/main\n");
    });

    const src = await loadSelfHostedSource({
      handle: fsa.root, repo: "http://localhost:8080/git/firma.git", clone,
    });

    expect(clone).toHaveBeenCalledOnce();
    expect(src.matters).toHaveLength(1);
  });

  it("versionsgrind: vägrar en working copy nyare än koden (ADR 0004)", async () => {
    const fsa = makeFakeFsa();
    const { FsaIsoGitAdapter } = await import("@/lib/client/fsa/fs-adapter");
    const fs = new FsaIsoGitAdapter(fsa.root);
    await fs.writeFile("/.git/HEAD", "ref: refs/heads/main\n");
    await fs.writeFile("/.ava/meta.json", JSON.stringify({ schemaVersion: 9999 }));

    await expect(loadSelfHostedSource({
      handle: fsa.root, repo: "http://localhost:8080/git/firma.git", clone: vi.fn(),
    })).rejects.toThrow(/nyare AVA-version/);
  });

  it("versionsgrind: working copy utan meta.json laddar (baslinje v1)", async () => {
    const fsa = makeFakeFsa();
    const wb = makeFsaWriteBack({ handle: fsa.root });
    await wb({ entity: "matter", kind: "create", row: { id: "m1", organizationId: "o1", title: "T" } });
    const { FsaIsoGitAdapter } = await import("@/lib/client/fsa/fs-adapter");
    await new FsaIsoGitAdapter(fsa.root).writeFile("/.git/HEAD", "ref: refs/heads/main\n");

    const src = await loadSelfHostedSource({
      handle: fsa.root, repo: "http://localhost:8080/git/firma.git", clone: vi.fn(),
    });
    expect(src.matters).toHaveLength(1);
  });

  it("provisionerar current-user om den saknas", async () => {
    const fsa = makeFakeFsa();
    const { FsaIsoGitAdapter } = await import("@/lib/client/fsa/fs-adapter");
    await new FsaIsoGitAdapter(fsa.root).writeFile("/.git/HEAD", "ref: refs/heads/main\n");

    const src = await loadSelfHostedSource({
      handle: fsa.root,
      repo: "http://localhost:8080/git/firma.git",
      clone: vi.fn(),
      currentUser: { id: "current-user", email: "me@firma.se", name: "Me", organizationId: "o1" },
    });

    const userRow = (src.users ?? []).find((u) => (u as { id: string }).id === "current-user") as {
      role?: string; active?: boolean;
    } | undefined;
    expect(userRow).toBeTruthy();
    // ADMIN-default så /users + /settings inte gate:as bort i UI:t på fräsch clone.
    expect(userRow?.role).toBe("ADMIN");
    expect(userRow?.active).toBe(true);
    // Persisterad till working copy
    expect(fsa.readFile("/.ava/users/me@firma.se.json")).not.toBeNull();
  });

  it("provisionerar current-organization om den saknas (krävs av /settings)", async () => {
    const fsa = makeFakeFsa();
    const { FsaIsoGitAdapter } = await import("@/lib/client/fsa/fs-adapter");
    await new FsaIsoGitAdapter(fsa.root).writeFile("/.git/HEAD", "ref: refs/heads/main\n");

    const src = await loadSelfHostedSource({
      handle: fsa.root,
      repo: "http://localhost:8080/git/firma.git",
      clone: vi.fn(),
      currentUser: { id: "current-user", email: "me@firma.se", name: "Me", organizationId: "org-42" },
    });

    expect((src.organizations ?? []).some((o) => (o as { id: string }).id === "org-42")).toBe(true);
    expect(fsa.readFile("/.ava/organizations/org-42.json")).not.toBeNull();
  });

  it("hoppar över clone när .git redan finns, hydrerar befintlig working copy", async () => {
    const fsa = makeFakeFsa();
    const wb = makeFsaWriteBack({ handle: fsa.root });
    await wb({ entity: "contact", kind: "create", row: { id: "c1", organizationId: "o1", name: "Anna" } });
    const { FsaIsoGitAdapter } = await import("@/lib/client/fsa/fs-adapter");
    await new FsaIsoGitAdapter(fsa.root).writeFile("/.git/HEAD", "ref: refs/heads/main\n");

    const clone = vi.fn(async () => { /* should not be called */ });
    const src = await loadSelfHostedSource({
      handle: fsa.root, repo: "http://localhost:8080/git/firma.git", clone,
    });

    expect(clone).not.toHaveBeenCalled();
    expect(src.contacts).toHaveLength(1);
  });
});
