import { describe, expect, it } from "vitest-compat";
import {
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
