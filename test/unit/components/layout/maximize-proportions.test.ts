/**
 * Proportionerna består genom en maximering (#1291).
 *
 * dockview kommer ihåg de dolda gruppernas storlekar i PIXLAR. Byter fönstret
 * storlek medan en grupp är maximerad (tiling-fönsterhanterare) återställs de
 * gamla pixlarna och layouten blir skev. Vakten sparar gruppernas andelar när
 * maximeringen börjar och skalar om dem till den aktuella ytan vid återställning.
 */
import { describe, expect, it } from "vitest-compat";
import { keepProportionsAcrossMaximize, type MaximizeProportionsApi } from "@/components/layout/maximize-proportions";

/** Två kolumner (hälften var); höger kolumn delad 1:3. */
const GRID = {
  root: { type: "branch", data: [
    { type: "leaf", data: { id: "g1", views: ["a"] }, size: 600 },
    { type: "branch", data: [{ type: "leaf", data: { id: "g2", views: ["b"] }, size: 200 }, { type: "leaf", data: { id: "g3", views: ["c"] }, size: 600 }], size: 600 },
  ], size: 800 },
  width: 1200, height: 800, orientation: "HORIZONTAL",
};

/** Attrapp: ytans storlek och layouten går att ändra; setSize spelas in. */
interface FakeApi extends Omit<MaximizeProportionsApi, "width" | "height"> {
  width: number;
  height: number;
  grid: unknown;
  sizes: Array<[string, { width: number; height: number }]>;
  disposed: boolean;
  groups: Set<string>;
  fire: (isMaximized: boolean) => void;
}

function fakeApi(): FakeApi {
  let listener: ((e: { isMaximized: boolean }) => void) | null = null;
  const f: FakeApi = {
    width: 1200, height: 800,
    sizes: [] as Array<[string, { width: number; height: number }]>,
    disposed: false,
    groups: new Set(["g1", "g2", "g3"]),
    grid: GRID,
    toJSON: () => ({ grid: f.grid }),
    getGroup: (id: string) => (f.groups.has(id) ? { api: { setSize: (s: { width: number; height: number }) => { f.sizes.push([id, s]); } } } : undefined),
    onDidMaximizedGroupChange: (l: (e: { isMaximized: boolean }) => void) => {
      listener = l;
      return { dispose: () => { f.disposed = true; listener = null; } };
    },
    fire: (isMaximized: boolean) => { listener?.({ isMaximized }); },
  };
  return f;
}

describe("keepProportionsAcrossMaximize (#1291)", () => {
  it("fönstret bytte storlek under maximeringen → grupperna skalas om till samma andelar", () => {
    const api = fakeApi();
    keepProportionsAcrossMaximize(api);
    api.fire(true);
    api.width = 900; api.height = 600;
    api.fire(false);
    expect(Object.fromEntries(api.sizes)).toEqual({
      g1: { width: 450, height: 600 },
      g2: { width: 450, height: 150 },
      g3: { width: 450, height: 450 },
    });
  });

  it("samma storlek → ingenting ändras (dockviews egen återställning stämmer)", () => {
    const api = fakeApi();
    keepProportionsAcrossMaximize(api);
    api.fire(true);
    api.fire(false);
    expect(api.sizes).toEqual([]);
  });

  it("storlekarna avrundas till hela pixlar", () => {
    const api = fakeApi();
    keepProportionsAcrossMaximize(api);
    api.fire(true);
    api.width = 1001; api.height = 777;
    api.fire(false);
    expect(Object.fromEntries(api.sizes).g2).toEqual({ width: 501, height: 194 });
  });

  it("en grupp som inte längre finns hoppas över", () => {
    const api = fakeApi();
    keepProportionsAcrossMaximize(api);
    api.fire(true);
    api.groups.delete("g2");
    api.width = 600;
    api.fire(false);
    expect(api.sizes.map(([id]) => id)).toEqual(["g1", "g3"]);
  });

  it("återställning utan att maximeringen setts (t.ex. vakten startade sent) → ingenting", () => {
    const api = fakeApi();
    keepProportionsAcrossMaximize(api);
    api.width = 600;
    api.fire(false);
    expect(api.sizes).toEqual([]);
  });

  it("varje maximering får en ny ögonblicksbild; en gammal används inte igen", () => {
    const api = fakeApi();
    keepProportionsAcrossMaximize(api);
    api.fire(true);
    api.fire(false); // samma storlek
    api.width = 600;
    api.fire(false); // ingen ny maximering → inget att skala
    expect(api.sizes).toEqual([]);
  });

  it("en layout som inte går att läsa → ingen ögonblicksbild, ingen skalning", () => {
    const api = fakeApi();
    api.grid = { trasig: true };
    keepProportionsAcrossMaximize(api);
    api.fire(true);
    api.width = 600;
    api.fire(false);
    expect(api.sizes).toEqual([]);
  });

  it("dispose slutar lyssna", () => {
    const api = fakeApi();
    keepProportionsAcrossMaximize(api).dispose();
    expect(api.disposed).toBe(true);
  });
});
