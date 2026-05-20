/**
 * Tester för `makeFsaWriteBack` — översätter MutationEvent till
 * filskrivningar i FSA-mounted folder.
 */

import { describe, it, expect, vi } from "vitest";
import { makeFsaWriteBack } from "@/lib/firma/fsa-write-back";

interface MockFs {
  writeFile: ReturnType<typeof vi.fn>;
  unlink: ReturnType<typeof vi.fn>;
}

vi.mock("@/lib/fsa/fs-adapter", () => ({
  FsaIsoGitAdapter: vi.fn().mockImplementation(function (
    this: MockFs,
  ): MockFs {
    this.writeFile = vi.fn().mockResolvedValue(undefined);
    this.unlink = vi.fn().mockResolvedValue(undefined);
    return this;
  }),
}));

import { FsaIsoGitAdapter } from "@/lib/fsa/fs-adapter";

describe("makeFsaWriteBack", () => {
  const handle = {} as FileSystemDirectoryHandle;

  it("matter create → matters/active/<id>.json", async () => {
    const onCounted = vi.fn();
    const writeBack = makeFsaWriteBack({ handle, onCounted });
    const instance = (FsaIsoGitAdapter as unknown as { mock: { instances: MockFs[] } }).mock.instances.at(-1)!;
    await writeBack({
      entity: "matter",
      kind: "create",
      row: { id: "m1", title: "Avtal", organizationId: "o1" },
    });
    expect(instance.writeFile).toHaveBeenCalled();
    const [path, body] = instance.writeFile.mock.calls.at(-1)!;
    expect(path).toBe("/matters/active/m1.json");
    expect(body as string).toContain('"id": "m1"');
    expect(onCounted).toHaveBeenCalledWith(1);
  });

  it("contact update → contacts/<id>.json", async () => {
    const writeBack = makeFsaWriteBack({ handle });
    const instance = (FsaIsoGitAdapter as unknown as { mock: { instances: MockFs[] } }).mock.instances.at(-1)!;
    await writeBack({
      entity: "contact", kind: "update",
      row: { id: "c1", name: "Anna", organizationId: "o1" },
    });
    expect(instance.writeFile.mock.calls.at(-1)![0]).toBe("/contacts/c1.json");
  });

  it("matterContact create → matter-contacts/<id>.json", async () => {
    const writeBack = makeFsaWriteBack({ handle });
    const instance = (FsaIsoGitAdapter as unknown as { mock: { instances: MockFs[] } }).mock.instances.at(-1)!;
    await writeBack({
      entity: "matterContact", kind: "create",
      row: { id: "mc1", matterId: "m1", contactId: "c1", organizationId: "o1" },
    });
    expect(instance.writeFile.mock.calls.at(-1)![0]).toBe("/matter-contacts/mc1.json");
  });

  it("delete → unlink", async () => {
    const writeBack = makeFsaWriteBack({ handle });
    const instance = (FsaIsoGitAdapter as unknown as { mock: { instances: MockFs[] } }).mock.instances.at(-1)!;
    await writeBack({
      entity: "contact", kind: "delete",
      row: { id: "c1", name: "Anna" },
    });
    expect(instance.unlink).toHaveBeenCalledWith("/contacts/c1.json");
    expect(instance.writeFile).not.toHaveBeenCalled();
  });

  it("user → .ava/users/<email>.json (om email finns)", async () => {
    const writeBack = makeFsaWriteBack({ handle });
    const instance = (FsaIsoGitAdapter as unknown as { mock: { instances: MockFs[] } }).mock.instances.at(-1)!;
    await writeBack({
      entity: "user", kind: "create",
      row: { id: "u1", email: "anna@firma.se", name: "Anna" },
    });
    expect(instance.writeFile.mock.calls.at(-1)![0]).toBe("/.ava/users/anna@firma.se.json");
  });

  it("okänd entitet ignoreras tyst", async () => {
    const writeBack = makeFsaWriteBack({ handle });
    const instance = (FsaIsoGitAdapter as unknown as { mock: { instances: MockFs[] } }).mock.instances.at(-1)!;
    instance.writeFile.mockClear();
    await writeBack({
      entity: "okand", kind: "create",
      row: { id: "x1" },
    });
    expect(instance.writeFile).not.toHaveBeenCalled();
  });
});
