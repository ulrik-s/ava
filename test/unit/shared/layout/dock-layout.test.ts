import { describe, expect, it } from "vitest-compat";
import {
  groupShares, withoutMaximized,
  LAYOUT_VERSION, layoutPrefKey, panelOrder, parseStoredLayout, reconcileLayout, screenClassFor, type SerializedLayout,
} from "@/lib/shared/layout/dock-layout";

const leaf = (id: string, views: string[], activeView?: string) => ({ type: "leaf" as const, data: { id, views, ...(activeView ? { activeView } : {}) }, size: 100 });

/** Två kolumner; höger kolumn delad i två grupper. */
const LAYOUT: SerializedLayout = {
  grid: {
    root: { type: "branch", data: [leaf("g1", ["time", "expenses"], "expenses"), { type: "branch", data: [leaf("g2", ["watch"]), leaf("g3", ["docs", "old"])] }] },
    width: 1200, height: 800, orientation: "HORIZONTAL",
  },
  panels: { time: { id: "time" }, expenses: { id: "expenses" }, watch: { id: "watch" }, docs: { id: "docs" }, old: { id: "old" } },
  activeGroup: "g1",
};

describe("skärmklass", () => {
  it("telefon ≤ 767, laptop ≤ 1799 (13\" Air ≈ 1470), annars stor skärm", () => {
    expect(screenClassFor(390)).toBe("phone");
    expect(screenClassFor(767)).toBe("phone");
    expect(screenClassFor(768)).toBe("laptop");
    expect(screenClassFor(1470)).toBe("laptop");
    expect(screenClassFor(1800)).toBe("large");
  });

  it("nyckel per sidtyp och skärmklass", () => {
    expect(layoutPrefKey("matter", "laptop")).toBe("layout.matter.laptop");
  });
});

describe("sparad layout", () => {
  it("läses bara med rätt version och form", () => {
    expect(parseStoredLayout({ version: LAYOUT_VERSION, layout: LAYOUT })).toEqual(LAYOUT);
    expect(parseStoredLayout({ version: 999, layout: LAYOUT })).toBeNull();
    expect(parseStoredLayout({ version: LAYOUT_VERSION, layout: { grid: {} } })).toBeNull();
    expect(parseStoredLayout(null)).toBeNull();
  });

  it("panelordningen följer layouten: vänster→höger, uppifrån, flikordning", () => {
    expect(panelOrder(LAYOUT)).toEqual(["time", "expenses", "watch", "docs", "old"]);
  });
});

describe("anpassa sparad layout till dagens paneler", () => {
  it("borttagna paneler rensas, nya rapporteras som saknade", () => {
    const r = reconcileLayout(LAYOUT, ["time", "expenses", "watch", "docs", "billing"]);
    expect(r?.missing).toEqual(["billing"]);
    expect(r && panelOrder(r.layout)).toEqual(["time", "expenses", "watch", "docs"]);
    expect(r && Object.keys(r.layout.panels)).not.toContain("old");
  });

  it("en grupp som blir tom försvinner, aktiv flik flyttas om den togs bort", () => {
    const r = reconcileLayout(LAYOUT, ["time", "docs"]);
    expect(r && panelOrder(r.layout)).toEqual(["time", "docs"]);
    const g1 = r?.layout.grid.root.type === "branch" ? r.layout.grid.root.data[0] : undefined;
    expect(g1?.type === "leaf" && g1.data.activeView).toBe("time");
  });

  it("inget kvar → null (använd standardlayouten)", () => {
    expect(reconcileLayout(LAYOUT, ["billing"])).toBeNull();
  });
});

describe("withoutMaximized (#1263)", () => {
  it("tar bort grid.maximizedNode så maximeringen aldrig sparas", () => {
    const layout = { grid: { root: { type: "leaf" }, width: 1, height: 1, orientation: "HORIZONTAL", maximizedNode: { location: [0] } }, panels: {} };
    const out = withoutMaximized(layout);
    expect("maximizedNode" in out.grid).toBe(false);
    expect(out.grid.width).toBe(1);
    expect("maximizedNode" in layout.grid).toBe(true); // originalet orört
  });
  it("lämnar en layout utan maximering orörd (samma objekt)", () => {
    const layout = { grid: { width: 1 }, panels: {} };
    expect(withoutMaximized(layout)).toBe(layout);
  });
});

// #1291: gruppernas andel av ytan, så att en återställd maximering kan skalas
// om till fönstrets nya storlek i stället för att få gamla pixelstorlekar.
describe("groupShares — varje grupps andel av ytan", () => {
  const sized = (id: string, size: number) => ({ type: "leaf" as const, data: { id, views: [id] }, size });

  it("två kolumner, höger kolumn delad: andelar i bredd och höjd", () => {
    const shares = groupShares({
      root: { type: "branch", data: [sized("g1", 600), { type: "branch", data: [sized("g2", 200), sized("g3", 600)], size: 600 }], size: 800 },
      width: 1200, height: 800, orientation: "HORIZONTAL",
    });
    expect(shares.get("g1")).toEqual({ width: 0.5, height: 1 });
    expect(shares.get("g2")).toEqual({ width: 0.5, height: 0.25 });
    expect(shares.get("g3")).toEqual({ width: 0.5, height: 0.75 });
  });

  it("vertikal rot: barnen staplas uppifrån och ned", () => {
    const shares = groupShares({
      root: { type: "branch", data: [sized("top", 300), sized("bottom", 100)], size: 1000 },
      width: 1000, height: 400, orientation: "VERTICAL",
    });
    expect(shares.get("top")).toEqual({ width: 1, height: 0.75 });
    expect(shares.get("bottom")).toEqual({ width: 1, height: 0.25 });
  });

  it("tre nivåer djupt", () => {
    const shares = groupShares({
      root: { type: "branch", data: [
        sized("a", 500),
        { type: "branch", data: [sized("b", 400), { type: "branch", data: [sized("c", 250), sized("d", 250)], size: 400 }], size: 500 },
      ], size: 800 },
      width: 1000, height: 800, orientation: "HORIZONTAL",
    });
    expect(shares.get("c")).toEqual({ width: 0.25, height: 0.5 });
    expect(shares.get("d")).toEqual({ width: 0.25, height: 0.5 });
  });

  it("en ensam grupp tar hela ytan", () => {
    expect(groupShares({ root: sized("only", 800), width: 1200, height: 800, orientation: "HORIZONTAL" }).get("only"))
      .toEqual({ width: 1, height: 1 });
  });

  it("noll-yta eller nod utan storlek → inga andelar (inget att skala efter)", () => {
    expect(groupShares({ root: sized("x", 0), width: 0, height: 0, orientation: "HORIZONTAL" }).size).toBe(0);
    const noSize = groupShares({
      root: { type: "branch", data: [{ type: "leaf", data: { id: "n", views: ["n"] } }] },
      width: 100, height: 100, orientation: "HORIZONTAL",
    });
    expect(noSize.get("n")).toEqual({ width: 0, height: 1 });
  });
});
