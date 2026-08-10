/**
 * `ensureFolderPath` (#985) — mappstrukturen för demons dokument.
 *
 * Tre olika pass filar dokument: den kronologiska simuleringen, faktura-
 * dokumenten och kostnadsräkningarna. De kör efter varandra och delar inte
 * state, så helpern måste fråga SERVERN vad som redan finns. Utan det steget
 * skapade kostnadsräkningspasset en andra "Domstol"-mapp i sex av demons
 * ärenden — samma namn, samma nivå, två mappar.
 */

import { describe, it, expect } from "vitest-compat";
import { ensureFolderPath, type FolderCache } from "../../tooling/demo-generator/folder-filing";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

interface Folder { id: string; name: string; parentId: string | null }

/** Minimal server-stub: håller mappar per ärende, som de riktiga procedurerna. */
function serverStub(initial: Record<string, Folder[]> = {}) {
  const store = new Map<string, Folder[]>(Object.entries(initial));
  const created: Array<{ matterId: string; name: string; parentId: string | null }> = [];
  let seq = 0;
  const caller = {
    document: {
      tree: async ({ matterId }: Any) => ({ folders: store.get(matterId) ?? [], documents: [] }),
      createFolder: async ({ matterId, name, parentId }: Any) => {
        created.push({ matterId, name, parentId });
        const folder: Folder = { id: `srv-${seq++}`, name, parentId: parentId ?? null };
        store.set(matterId, [...(store.get(matterId) ?? []), folder]);
        return folder;
      },
    },
  };
  return { caller, created, store };
}

describe("ensureFolderPath", () => {
  it("skapar sökvägen uppifrån och ned och returnerar den innersta mappen", async () => {
    const { caller, created } = serverStub();
    const cache: FolderCache = new Map();
    const id = await ensureFolderPath(caller, "m1", ["Domstol", "Domar"], cache);
    expect(created.map((c) => c.name)).toEqual(["Domstol", "Domar"]);
    expect(created[0]!.parentId).toBeNull();
    expect(created[1]!.parentId).toBe("srv-0");
    expect(id).toBe("srv-1");
  });

  it("återanvänder en mapp som ETT ANNAT PASS redan skapat — inga dubbletter", async () => {
    // Simuleringen har lagt "Domstol" på ärendet; kostnadsräkningspasset kommer
    // efteråt med en TOM cache. Det var precis här dubbletterna uppstod.
    const { caller, created } = serverStub({
      m1: [{ id: "sim-1", name: "Domstol", parentId: null }],
    });
    const freshCache: FolderCache = new Map();
    const id = await ensureFolderPath(caller, "m1", ["Domstol", "Kostnadsräkningar"], freshCache);

    expect(created.map((c) => c.name), "bara barnet skapas").toEqual(["Kostnadsräkningar"]);
    expect(created[0]!.parentId, "barnet hänger under den befintliga mappen").toBe("sim-1");
    expect(id).toBe("srv-0");
  });

  it("läser serverns mappar EN gång per ärende, inte per dokument", async () => {
    const { caller } = serverStub();
    let reads = 0;
    const counting = { document: { ...caller.document, tree: async (a: Any) => { reads++; return caller.document.tree(a); } } };
    const cache: FolderCache = new Map();
    for (let i = 0; i < 5; i++) await ensureFolderPath(counting, "m1", ["Klient"], cache);
    expect(reads).toBe(1);
  });

  it("olika ärenden får egna mappar trots samma namn", async () => {
    const { caller, created } = serverStub();
    const cache: FolderCache = new Map();
    const a = await ensureFolderPath(caller, "m1", ["Klient"], cache);
    const b = await ensureFolderPath(caller, "m2", ["Klient"], cache);
    expect(created).toHaveLength(2);
    expect(a).not.toBe(b);
  });

  it("tom sökväg → roten, ingen mapp skapas och ingen läsning görs", async () => {
    const { caller, created } = serverStub();
    expect(await ensureFolderPath(caller, "m1", [], new Map())).toBeNull();
    expect(created).toHaveLength(0);
  });
});
