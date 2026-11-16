/**
 * DockWorkspace (#1185) — vilken layout som visas, när den sparas, återställ och
 * firmastandard. dockview kräver en riktig layoutmotor, så en attrapp spelar in
 * anropen; det är logiken runt den som testas här.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import type { AddPanel } from "@/components/layout/dock-workspace";
import { LAYOUT_VERSION, type SerializedLayout } from "@/lib/shared/layout/dock-layout";

interface FakeApi {
  added: Array<{ id: string; inactive?: boolean; position?: unknown }>;
  loaded: unknown[];
  titles: Record<string, string>;
  failLoad: boolean;
  layoutListener: (() => void) | null;
  maximized: boolean;
  maximizeListeners: Array<(e: { isMaximized: boolean }) => void>;
  /** Paneler som användaren stängt med ×. */
  closed: string[];
}
const fake: FakeApi = {
  added: [], loaded: [], titles: {}, failLoad: false, layoutListener: null, maximized: false, maximizeListeners: [], closed: [],
};
/** Flikar som attrappen ritar med sidans flikkomponent (#1611). */
const TAB_IDS = ["a", "b", "c"];
type TabComponent = (p: { api: { id: string; close: () => void } }) => React.ReactNode;
let readyCount = 0;

const dockProps: { defaultTabComponent: unknown; disableFloatingGroups: unknown } = { defaultTabComponent: null, disableFloatingGroups: undefined };
/** Tangenter som nådde flikraden — dockviews lyssnare sitter där (bubbelfasen). */
const tablistKeys: string[] = [];
const recordTablistKeys = (el: HTMLDivElement | null): void => {
  el?.addEventListener("keydown", (e) => { tablistKeys.push(e.key); });
};

vi.mock("dockview-react", () => ({
  themeLight: { name: "light" },
  themeDark: { name: "dark" },
  DockviewDefaultTab: ({ hideClose, closeActionOverride, api }: { hideClose?: boolean; closeActionOverride?: () => void; api?: { id: string } }) => (
    <span data-testid="default-tab" data-hide-close={String(hideClose)}>
      {!hideClose && <button type="button" aria-label={`Stäng ${api?.id ?? ""}`} onClick={closeActionOverride}>×</button>}
    </span>
  ),
  DockviewReact: ({ onReady, defaultTabComponent, disableFloatingGroups }: {
    onReady: (e: { api: unknown }) => void; defaultTabComponent?: unknown; disableFloatingGroups?: boolean;
  }) => {
    dockProps.defaultTabComponent = defaultTabComponent;
    dockProps.disableFloatingGroups = disableFloatingGroups;
    const panels = new Set<string>();
    const api = {
      addPanel: (o: { id: string; inactive?: boolean; position?: { referencePanel?: string } }) => {
        // Som dockview: en placering relativt en panel som inte finns kastar.
        const ref = o.position?.referencePanel;
        if (ref !== undefined && !panels.has(ref)) throw new Error(`no panel ${ref}`);
        panels.add(o.id); fake.added.push(o);
      },
      getPanel: (id: string) => (panels.has(id) ? { api: { setTitle: (t: string) => { fake.titles[id] = t; } } } : undefined),
      fromJSON: (j: { panels: Record<string, unknown> }) => {
        if (fake.failLoad) throw new Error("trasig");
        fake.loaded.push(j);
        Object.keys(j.panels).forEach((id) => panels.add(id));
      },
      clear: () => { panels.clear(); },
      toJSON: () => ({ saved: true, grid: {} }),
      onDidLayoutChange: (l: () => void) => { fake.layoutListener = l; },
      hasMaximizedGroup: () => fake.maximized,
      width: 1200, height: 800,
      getGroup: () => undefined,
      onDidMaximizedGroupChange: (l: (e: { isMaximized: boolean }) => void) => { fake.maximizeListeners.push(l); return { dispose: () => {} }; },
    };
    // En gång per montering, som dockview.
    if (readyCount++ === 0 || !fake.layoutListener) onReady({ api });
    const Tab = defaultTabComponent as TabComponent;
    return (
      <div data-testid="dock">
        {TAB_IDS.map((id) => <Tab key={id} api={{ id, close: () => { fake.closed.push(id); } }} />)}
        <div role="tablist" aria-label="flikrad" ref={recordTablistKeys}>
          <div className="dv-tab" data-testid="dv-tab" tabIndex={0} />
        </div>
      </div>
    );
  },
}));

const prefsData: { user: unknown; org: unknown } = { user: null, org: null };
/** Listan över dolda paneler (#1611) — egen nyckel, ingen firmastandard. */
const hiddenPrefs: { user: unknown; org: unknown; loading: boolean } = { user: null, org: null, loading: false };
const role = { value: "LAWYER" };
const save = vi.fn();
const clear = vi.fn();
const setOrg = vi.fn();
const clearOrg = vi.fn();
const invalidate = vi.fn(async () => undefined);
const mutation = (fn: ReturnType<typeof vi.fn>) => ({
  useMutation: () => ({ mutate: (a: unknown, o?: { onSuccess?: () => void }) => { fn(a); o?.onSuccess?.(); } }),
});

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ prefs: { get: { invalidate } } }),
    prefs: {
      get: {
        useQuery: ({ key }: { key: string }) => (key.startsWith("panels.")
          ? { data: hiddenPrefs, isLoading: hiddenPrefs.loading }
          : { data: prefsData, isLoading: false }),
      },
      save: mutation(save), clear: mutation(clear), setOrgDefault: mutation(setOrg), clearOrgDefault: mutation(clearOrg),
    },
    user: { current: { useQuery: () => ({ data: { role: role.value } }) } },
  },
}));

const screenClass = { value: "laptop" as "laptop" | "large" | "phone" };
vi.mock("@/lib/client/layout/use-screen-class", () => ({ useScreenClass: () => screenClass.value }));

const { DockWorkspace, PanelTab, activatePanelFromHash, addGroup } = await import("@/components/layout/dock-workspace");

const PANELS = [
  { id: "a", title: "Alfa", render: () => <p>alfa-innehåll</p> },
  { id: "b", title: "Beta", render: () => <p>beta-innehåll</p> },
  { id: "c", title: "Gamma", render: () => <p>gamma-innehåll</p> },
];
const defaultLayout = vi.fn((add: (id: string) => void) => { add("a"); add("b"); add("c"); });

/** Sparad layout med paneler b, a (c saknas — tillkom efter att den sparades). */
const SAVED: SerializedLayout = {
  grid: { root: { type: "leaf", data: { id: "g1", views: ["b", "a"] }, size: 1 }, width: 100, height: 100, orientation: "HORIZONTAL" },
  panels: { a: { id: "a" }, b: { id: "b" } },
};
const stored = (layout: SerializedLayout) => ({ version: LAYOUT_VERSION, layout });

const renderWs = () => render(<DockWorkspace page="matter" panels={PANELS} defaultLayout={defaultLayout} />);

beforeEach(() => {
  vi.clearAllMocks();
  fake.added = []; fake.loaded = []; fake.titles = {}; fake.failLoad = false; fake.layoutListener = null;
  fake.maximized = false; fake.maximizeListeners = []; fake.closed = [];
  hiddenPrefs.user = null; hiddenPrefs.org = null; hiddenPrefs.loading = false;
  tablistKeys.length = 0;
  readyCount = 0;
  prefsData.user = null; prefsData.org = null;
  role.value = "LAWYER";
  screenClass.value = "laptop";
});

describe("DockWorkspace — vilken layout", () => {
  it("utan sparad layout: sidans standard för skärmklassen", () => {
    renderWs();
    expect(defaultLayout).toHaveBeenCalledWith(expect.any(Function), "laptop");
    expect(fake.added.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("personlig layout vinner; nya paneler läggs till och titlarna uppdateras", () => {
    prefsData.user = stored(SAVED);
    prefsData.org = stored({ ...SAVED, panels: {} });
    renderWs();
    expect(defaultLayout).not.toHaveBeenCalled();
    expect(fake.loaded).toHaveLength(1);
    expect(fake.added.map((p) => p.id)).toEqual(["c"]);
    expect(fake.titles).toMatchObject({ a: "Alfa", b: "Beta" });
  });

  it("en panel som tillkommer efter start läggs till som inaktiv flik (#1431)", () => {
    const { rerender } = renderWs();
    const late = [...PANELS, { id: "d", title: "Delta", render: () => <p>delta-innehåll</p> }];
    rerender(<DockWorkspace page="matter" panels={late} defaultLayout={defaultLayout} />);
    expect(fake.added.filter((p) => p.id === "d")).toEqual([expect.objectContaining({ id: "d", inactive: true })]);
    expect(fake.added.filter((p) => p.id === "a")).toHaveLength(1);
  });

  it("firmastandard när användaren inte har någon egen", () => {
    prefsData.org = stored(SAVED);
    renderWs();
    expect(fake.loaded).toHaveLength(1);
  });

  it("trasig sparad layout → standard", () => {
    prefsData.user = stored(SAVED);
    fake.failLoad = true;
    renderWs();
    expect(defaultLayout).toHaveBeenCalled();
  });
});

describe("DockWorkspace — spara", () => {
  it("sparar INTE förrän användaren själv rört layouten", async () => {
    renderWs();
    act(() => fake.layoutListener?.());
    await new Promise((r) => setTimeout(r, 900));
    expect(save).not.toHaveBeenCalled();
  });

  // #1291: under maximering serialiserar dockview de dolda gruppernas GAMLA
  // pixlar — har fönstret bytt storlek blir den sparade layouten skev.
  it("sparar INTE medan en grupp är maximerad; efter återställning sparas som vanligt", async () => {
    renderWs();
    fireEvent.pointerDown(screen.getByTestId("dock"));
    fake.maximized = true;
    act(() => fake.layoutListener?.());
    await new Promise((r) => setTimeout(r, 900));
    expect(save).not.toHaveBeenCalled();
    fake.maximized = false;
    act(() => fake.layoutListener?.());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1), { timeout: 2000 });
  });

  it("lyssnar på maximeringar (proportionsvakten, #1291)", () => {
    renderWs();
    expect(fake.maximizeListeners.length).toBeGreaterThan(0);
  });

  it("efter egen ändring: debouncad sparning med version", async () => {
    renderWs();
    fireEvent.pointerDown(screen.getByTestId("dock"));
    act(() => { fake.layoutListener?.(); fake.layoutListener?.(); });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(save).toHaveBeenCalledWith({ key: "layout.matter.laptop", prefs: { version: LAYOUT_VERSION, layout: { saved: true, grid: {} } } });
  });

  it("återställ rensar den personliga layouten", async () => {
    renderWs();
    fireEvent.click(screen.getByRole("button", { name: "Återställ layout" }));
    expect(clear).toHaveBeenCalledWith({ key: "layout.matter.laptop" });
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
  });
});

describe("DockWorkspace — firmastandard (admin)", () => {
  it("bara admin ser knapparna", () => {
    renderWs();
    expect(screen.queryByRole("button", { name: "Spara som firmastandard" })).not.toBeInTheDocument();
  });

  it("admin sparar och tar bort firmastandard", () => {
    role.value = "ADMIN";
    prefsData.org = stored(SAVED);
    renderWs();
    fireEvent.click(screen.getByRole("button", { name: "Spara som firmastandard" }));
    expect(setOrg).toHaveBeenCalledWith({ key: "layout.matter.laptop", prefs: { version: LAYOUT_VERSION, layout: { saved: true, grid: {} } } });
    fireEvent.click(screen.getByRole("button", { name: "Ta bort firmastandard" }));
    expect(clearOrg).toHaveBeenCalledWith({ key: "layout.matter.laptop" });
  });

  it("stor skärm har egen nyckel", () => {
    screenClass.value = "large";
    role.value = "ADMIN";
    renderWs();
    expect(defaultLayout).toHaveBeenCalledWith(expect.any(Function), "large");
    fireEvent.click(screen.getByRole("button", { name: "Spara som firmastandard" }));
    expect(setOrg).toHaveBeenCalledWith(expect.objectContaining({ key: "layout.matter.large" }));
  });
});

describe("DockWorkspace — telefon", () => {
  it("en panel i taget, i laptop-layoutens ordning, utan dockyta", () => {
    screenClass.value = "phone";
    prefsData.user = stored(SAVED);
    renderWs();
    expect(screen.queryByTestId("dock")).not.toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Beta", "Alfa", "Gamma"]);
    expect(screen.getByText("beta-innehåll")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Gamma" }));
    expect(screen.getByText("gamma-innehåll")).toBeInTheDocument();
    expect(screen.queryByText("beta-innehåll")).not.toBeInTheDocument();
  });

  it("utan sparad layout: registrets ordning", () => {
    screenClass.value = "phone";
    renderWs();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Alfa", "Beta", "Gamma"]);
  });
});

// #1292: flikarna går inte att stänga — panelerna är sidans fasta uppsättning.
describe("DockWorkspace — flikar", () => {
  it("dockytan använder PanelTab, som är dockviews flik utan stängknapp", () => {
    renderWs();
    expect(dockProps.defaultTabComponent).toBe(PanelTab);
    const tabs = screen.getAllByTestId("default-tab");
    expect(tabs.map((t) => t.getAttribute("data-hide-close"))).toEqual(["true", "true", "true"]);
    expect(screen.queryByRole("button", { name: /^Stäng/ })).not.toBeInTheDocument();
  });
});

// #1611: valbara paneler — användaren tar bort dem med ×, och de förblir dolda.
describe("DockWorkspace — valbara paneler", () => {
  const renderClosable = (closable: readonly string[], layout = defaultLayout) =>
    render(<DockWorkspace page="dashboard" panels={PANELS} defaultLayout={layout} closable={closable} />);

  it("bara valbara flikar får ×", () => {
    renderClosable(["b"]);
    const tabs = screen.getAllByTestId("default-tab");
    expect(tabs.map((t) => t.getAttribute("data-hide-close"))).toEqual(["true", "undefined", "true"]);
  });

  it("× stänger panelen, sparar den som dold och den läggs inte tillbaka", () => {
    renderClosable(["b", "c"]);
    fireEvent.click(screen.getByRole("button", { name: "Stäng b" }));
    expect(fake.closed).toEqual(["b"]);
    expect(save).toHaveBeenCalledWith({ key: "panels.dashboard.hidden", prefs: { hidden: ["b"] } });
    expect(fake.added.filter((p) => p.id === "b")).toHaveLength(1);
  });

  it("dold panel läggs inte till av standardlayouten; id utanför closable ignoreras", () => {
    hiddenPrefs.user = { hidden: ["b", "a"] };
    renderClosable(["b"]);
    expect(fake.added.map((p) => p.id)).toEqual(["a", "c"]);
  });

  it("dold panel läggs inte till av reconcileLayout eller av sent tillkomna paneler", () => {
    prefsData.user = stored(SAVED);
    hiddenPrefs.user = { hidden: ["b", "c"] };
    const { rerender } = renderClosable(["b", "c"]);
    expect(fake.loaded).toEqual([expect.objectContaining({ panels: { a: { id: "a" } } })]);
    rerender(<DockWorkspace page="dashboard" panels={[...PANELS]} defaultLayout={defaultLayout} closable={["b", "c"]} />);
    expect(fake.added).toEqual([]);
  });

  it("standardlayout med dold referenspanel kraschar inte; övriga paneler syns", () => {
    hiddenPrefs.user = { hidden: ["b"] };
    const relative = vi.fn((add: AddPanel) => {
      add("b");
      add("c", { position: { referencePanel: "b", direction: "below" } });
      add("a", { position: { direction: "right" } });
    });
    renderClosable(["b"], relative);
    expect(fake.added).toEqual([
      expect.not.objectContaining({ position: expect.anything() }),
      expect.objectContaining({ id: "a", position: { direction: "right" } }),
    ]);
    expect(fake.added[0]?.id).toBe("c");
  });

  it("referenspanel som finns: placeringen behålls", () => {
    const relative = vi.fn((add: AddPanel) => { addGroup(add, ["a", "b"]); });
    renderClosable(["c"], relative);
    expect(fake.added[1]).toEqual(expect.objectContaining({ id: "b", position: { referencePanel: "a", direction: "within" } }));
  });

  it("programmatiska borttagningar (trasig layout, Återställ layout) döljer inget", () => {
    prefsData.user = stored(SAVED);
    fake.failLoad = true;
    renderClosable(["a", "b", "c"]);
    fireEvent.click(screen.getByRole("button", { name: "Återställ layout" }));
    expect(clear).toHaveBeenCalledWith({ key: "layout.dashboard.laptop" });
    expect(save).not.toHaveBeenCalledWith(expect.objectContaining({ key: "panels.dashboard.hidden" }));
  });

  it("väntar på listan över dolda innan dockytan byggs", () => {
    hiddenPrefs.loading = true;
    renderClosable(["b"]);
    expect(screen.getByText("Laddar…")).toBeInTheDocument();
    expect(screen.queryByTestId("dock")).not.toBeInTheDocument();
  });

  it("telefon: dolda paneler syns inte och × på en valbar flik döljer den", () => {
    screenClass.value = "phone";
    hiddenPrefs.user = { hidden: ["b"] };
    renderClosable(["b", "c"]);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Alfa", "Gamma"]);
    expect(screen.queryByRole("button", { name: "Ta bort Alfa" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ta bort Gamma" }));
    expect(save).toHaveBeenCalledWith({ key: "panels.dashboard.hidden", prefs: { hidden: ["b", "c"] } });
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Alfa"]);
  });

  it("telefon utan closable: inga ×", () => {
    screenClass.value = "phone";
    renderWs();
    expect(screen.queryByRole("button", { name: /^Ta bort/ })).not.toBeInTheDocument();
  });
});

// #1612: "Lägg till ruta" lägger tillbaka en dold valbar panel.
describe("DockWorkspace — Lägg till ruta", () => {
  const renderClosable = (closable: readonly string[]) =>
    render(<DockWorkspace page="dashboard" panels={PANELS} defaultLayout={defaultLayout} closable={closable} />);
  const addButton = () => screen.getByRole("button", { name: "Lägg till ruta" });

  it("visas bara på sidor med valbara paneler", () => {
    renderWs();
    expect(screen.queryByRole("button", { name: "Lägg till ruta" })).not.toBeInTheDocument();
  });

  it("inaktiv med förklaring när ingen ruta är dold", () => {
    renderClosable(["b", "c"]);
    expect(addButton()).toBeDisabled();
    expect(addButton()).toHaveAttribute("title", "Alla rutor visas redan");
  });

  it("listan visar bara dolda valbara rutor; ett val lägger tillbaka rutan aktiv", () => {
    hiddenPrefs.user = { hidden: ["b", "a"] };
    renderClosable(["b", "c"]);
    expect(addButton()).toBeEnabled();
    fireEvent.click(addButton());
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Beta"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Beta" }));
    expect(save).toHaveBeenCalledWith({ key: "panels.dashboard.hidden", prefs: { hidden: ["a"] } });
    expect(fake.added.filter((p) => p.id === "b")).toEqual([expect.not.objectContaining({ inactive: true })]);
  });

  it("efter tillbakaläggning tillkommer sena paneler som vanligt inaktiva", () => {
    hiddenPrefs.user = { hidden: ["b"] };
    const { rerender } = renderClosable(["b"]);
    fireEvent.click(addButton());
    fireEvent.click(screen.getByRole("menuitem", { name: "Beta" }));
    const late = [...PANELS, { id: "d", title: "Delta", render: () => <p>delta-innehåll</p> }];
    rerender(<DockWorkspace page="dashboard" panels={late} defaultLayout={defaultLayout} closable={["b"]} />);
    expect(fake.added.filter((p) => p.id === "d")).toEqual([expect.objectContaining({ inactive: true })]);
  });

  it("alla rutor borttagna: tomt läge med knappen i stället för dockytan", () => {
    hiddenPrefs.user = { hidden: ["a", "b", "c"] };
    renderClosable(["a", "b", "c"]);
    expect(screen.queryByTestId("dock")).not.toBeInTheDocument();
    expect(screen.getByText("Du har tagit bort alla rutor.")).toBeInTheDocument();
    fireEvent.click(addButton());
    fireEvent.click(screen.getByRole("menuitem", { name: "Gamma" }));
    expect(screen.getByTestId("dock")).toBeInTheDocument();
    expect(fake.added.map((p) => p.id)).toEqual(["c"]);
  });

  it("telefon: knappen lägger tillbaka rutan och visar den", () => {
    screenClass.value = "phone";
    hiddenPrefs.user = { hidden: ["c"] };
    renderClosable(["b", "c"]);
    expect(screen.getByText("alfa-innehåll")).toBeInTheDocument();
    fireEvent.click(addButton());
    fireEvent.click(screen.getByRole("menuitem", { name: "Gamma" }));
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Alfa", "Beta", "Gamma"]);
    expect(screen.getByRole("tab", { name: "Gamma" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("gamma-innehåll")).toBeInTheDocument();
  });

  it("telefon: tomt läge när alla rutor är borttagna", () => {
    screenClass.value = "phone";
    hiddenPrefs.user = { hidden: ["b", "c"] };
    renderClosable(["a", "b", "c"]);
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Ta bort Alfa" }));
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.getByText("Du har tagit bort alla rutor.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lägg till ruta" })).toBeEnabled();
  });
});

// #1356: dockview-core stänger en fokuserad flik med Delete/Backspace trots
// hideClose, och shift-drag skapade flytande grupper.
describe("DockWorkspace — tangentbord och flytande grupper", () => {
  it("Delete/Backspace på en flik når aldrig dockviews flikrad; piltangenter gör det", () => {
    renderWs();
    const tab = screen.getByTestId("dv-tab");
    fireEvent.keyDown(tab, { key: "Delete" });
    fireEvent.keyDown(tab, { key: "Backspace" });
    fireEvent.keyDown(tab, { key: "ArrowRight" });
    expect(tablistKeys).toEqual(["ArrowRight"]);
  });

  it("flytande grupper är avstängda", () => {
    renderWs();
    expect(dockProps.disableFloatingGroups).toBe(true);
  });
});

describe("DockWorkspace — firmastandard under maximering (#1356)", () => {
  const maximize = (on: boolean): void => {
    fake.maximized = on;
    act(() => { fake.maximizeListeners.forEach((l) => l({ isMaximized: on })); });
  };

  it("knappen är spärrad medan en panel är maximerad och öppnas igen efter återställning", () => {
    role.value = "ADMIN";
    renderWs();
    const btn = screen.getByRole("button", { name: "Spara som firmastandard" });
    maximize(true);
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "Återställ den maximerade panelen först");
    fireEvent.click(btn);
    expect(setOrg).not.toHaveBeenCalled();
    maximize(false);
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(setOrg).toHaveBeenCalledTimes(1);
  });

  it("sparar inte heller om maximeringen hann före omritningen", () => {
    role.value = "ADMIN";
    renderWs();
    fake.maximized = true; // dockview har maximerat; React har inte ritat om än
    fireEvent.click(screen.getByRole("button", { name: "Spara som firmastandard" }));
    expect(setOrg).not.toHaveBeenCalled();
  });
});

describe("activatePanelFromHash", () => {
  it("#external aktiverar den panelen; tom hash eller okänd panel gör inget", () => {
    const setActive = vi.fn();
    const getPanel = vi.fn((id: string) => (id === "external" ? { api: { setActive } } : undefined));
    activatePanelFromHash({ getPanel }, "#external");
    activatePanelFromHash({ getPanel }, "#saknas");
    activatePanelFromHash({ getPanel }, "");
    expect(setActive).toHaveBeenCalledTimes(1);
    expect(getPanel).toHaveBeenCalledTimes(2);
  });
});
