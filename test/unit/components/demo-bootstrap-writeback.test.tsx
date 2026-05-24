/**
 * Test för writeBack-callback:en i demo-bootstrap.
 *
 * Bugg vi fixade: writeBack använde cached `fsaRef.current` som var
 * null när användaren först valt FSA-mapp via /settings (efter
 * bootstrap mounted). Resultat: ingen JSON-fil skrevs trots att
 * uppladdning kördes.
 *
 * Det här testet kapslar den nya beteenden: writeBack läser handle:n
 * fresh från IndexedDB om refen är null. Vi kan inte importera den
 * exakta closure:n från demo-bootstrap, så testet replicerar
 * logiken (samma kod) och verifierar mot fake-FSA + fake-handle-store.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeFakeFsa } from "../../helpers/fake-fsa";

// Mock:a handle-store så vi kan styra vad loadHandle returnerar.
const handleState: { current: FileSystemDirectoryHandle | null; isSupported: boolean } = {
  current: null,
  isSupported: true,
};
vi.mock("@/client/lib/fsa/handle-store", () => ({
  isFsaSupported: () => handleState.isSupported,
  loadHandle: vi.fn(async () => handleState.current),
  ensureReadWrite: vi.fn(async () => true),
}));

// Replicera writeBack:s closure-logik. Detta måste hållas i sync med
// src/components/demo-bootstrap.tsx — vid förändring uppdatera båda.
type MutationEventLike = { entity: string; kind: "create" | "update" | "delete"; row: Record<string, unknown>; previous?: Record<string, unknown> };
async function buildWriteBack(): Promise<(event: MutationEventLike) => Promise<void>> {
  const fsaRef: { current: FileSystemDirectoryHandle | null } = { current: null };
  return async (event) => {
    let h = fsaRef.current;
    if (!h) {
      const { loadHandle, ensureReadWrite, isFsaSupported } = await import("@/client/lib/fsa/handle-store");
      if (!isFsaSupported()) return;
      const loaded = await loadHandle("repo-root");
      if (!loaded) return;
      if (!(await ensureReadWrite(loaded).catch(() => false))) return;
      h = loaded;
      fsaRef.current = loaded;
    }
    const { makeFsaWriteBack } = await import("@/client/lib/firma/fsa-write-back");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await makeFsaWriteBack({ handle: h })(event as any);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("ava:data-changed"));
    }
  };
}

beforeEach(() => {
  handleState.current = null;
  handleState.isSupported = true;
  vi.clearAllMocks();
});

describe("demo-bootstrap writeBack — fresh handle-fallback", () => {
  it("skriver inget om FSA inte stöds", async () => {
    handleState.isSupported = false;
    handleState.current = null;
    const writeBack = await buildWriteBack();
    // Skall inte kasta även utan handle
    await expect(writeBack({
      entity: "document", kind: "create", row: { id: "d-1" },
    })).resolves.toBeUndefined();
  });

  it("skriver inget om handle saknas i IndexedDB (loadHandle returns null)", async () => {
    handleState.isSupported = true;
    handleState.current = null;
    const writeBack = await buildWriteBack();
    await expect(writeBack({
      entity: "document", kind: "create", row: { id: "d-1" },
    })).resolves.toBeUndefined();
  });

  it("skriver via fresh handle när fsaRef är null men IndexedDB har en", async () => {
    const fsa = makeFakeFsa();
    handleState.current = fsa.root;
    const writeBack = await buildWriteBack();

    await writeBack({
      entity: "document", kind: "create",
      row: { id: "d-1", fileName: "test.pdf" },
    });

    const written = fsa.readFile("documents/d-1.json");
    expect(written).not.toBeNull();
    const parsed = JSON.parse(new TextDecoder().decode(written!));
    expect(parsed.id).toBe("d-1");
  });

  it("ava:data-changed-event dispatch:as efter lyckad skrivning", async () => {
    const fsa = makeFakeFsa();
    handleState.current = fsa.root;
    const writeBack = await buildWriteBack();
    let events = 0;
    const handler = () => { events++; };
    window.addEventListener("ava:data-changed", handler);
    try {
      await writeBack({
        entity: "matter", kind: "create",
        row: { id: "m-1", title: "Test" },
      });
      expect(events).toBe(1);
    } finally {
      window.removeEventListener("ava:data-changed", handler);
    }
  });

  it("andra skrivningen använder cached handle (anropar inte loadHandle igen)", async () => {
    const fsa = makeFakeFsa();
    handleState.current = fsa.root;
    const { loadHandle } = await import("@/client/lib/fsa/handle-store");
    const writeBack = await buildWriteBack();

    await writeBack({ entity: "matter", kind: "create", row: { id: "m-1" } });
    await writeBack({ entity: "matter", kind: "create", row: { id: "m-2" } });

    // loadHandle ska bara ha kallats EN gång (första skrivningen)
    expect(vi.mocked(loadHandle).mock.calls.length).toBeLessThanOrEqual(1);
  });
});
