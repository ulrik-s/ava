"use client";

/**
 * En dockbar sida (#1184/#1185): panelerna ligger i en dockview-yta som alltid
 * fyller skärmen — ingen sidscroll, bara panelinnehåll scrollar. Användaren
 * drar flikar för att dela/gruppera; layouten sparas per sidtyp och skärmklass.
 *
 * Vilken layout som visas: personlig → firmastandard (admin) → sidans standard.
 * Något sparas FÖRST när användaren själv rört layouten — annars hade varje
 * sidvisning låst användaren vid det hon råkade se, och en ny firmastandard
 * aldrig nått henne.
 *
 * Telefon: ingen dragning — en panel i taget i laptop-layoutens ordning.
 */

import "dockview-react/dist/styles/dockview.css";
import {
  DockviewReact, themeDark, themeLight,
  type AddPanelPositionOptions, type DockviewApi, type IDockviewPanelProps, type SerializedDockview,
} from "dockview-react";
import { createContext, useContext, useMemo, useRef, useState } from "react";
import { useScreenClass } from "@/lib/client/layout/use-screen-class";
import { trpc } from "@/lib/client/trpc";
import {
  LAYOUT_VERSION, layoutPrefKey, panelOrder, parseStoredLayout, reconcileLayout, type SerializedLayout,
} from "@/lib/shared/layout/dock-layout";
import type { PanelDef } from "./panel-def";
import { PhonePanels } from "./phone-panels";

/** Lägg till en panel (via id); standardlayouter bygger med den. `inactive` = lägg till som bakgrundsflik. */
export type AddPanel = (id: string, opts?: { position?: AddPanelPositionOptions; inactive?: boolean }) => void;
/** Sidans standardlayout per skärmklass. */
export type DefaultLayout = (add: AddPanel, screen: "laptop" | "large") => void;

/** En flikgrupp: första panelen synlig, resten som bakgrundsflikar i samma grupp. */
export function addGroup(add: AddPanel, ids: readonly string[], position?: AddPanelPositionOptions): void {
  const [first, ...rest] = ids;
  if (!first) return;
  add(first, position ? { position } : undefined);
  rest.forEach((id) => add(id, { position: { referencePanel: first, direction: "within" }, inactive: true }));
}

interface Props {
  /** Sidtyp, t.ex. "matter" — en layout för alla ärenden. */
  page: string;
  panels: readonly PanelDef[];
  defaultLayout: DefaultLayout;
}

const PanelDefs = createContext<ReadonlyMap<string, PanelDef>>(new Map());

/** Panelens innehåll; scrollar inom panelen, aldrig sidan. */
function PanelHost({ params }: IDockviewPanelProps<{ id: string }>) {
  const def = useContext(PanelDefs).get(params.id);
  return <div className="h-full overflow-y-auto p-3">{def?.render()}</div>;
}
const COMPONENTS = { panel: PanelHost };

const SAVE_DEBOUNCE_MS = 800;

function adder(api: DockviewApi, defs: ReadonlyMap<string, PanelDef>): AddPanel {
  return (id, opts = {}) => {
    const def = defs.get(id);
    if (!def || api.getPanel(id)) return;
    api.addPanel({
      id, component: "panel", title: def.title, params: { id },
      ...(opts.position ? { position: opts.position } : {}), ...(opts.inactive ? { inactive: true } : {}),
    });
  };
}

/** Sparad layout (anpassad till dagens paneler) eller sidans standard. */
function applyLayout(api: DockviewApi, stored: SerializedLayout | null, defs: ReadonlyMap<string, PanelDef>, fallback: () => void): void {
  const r = stored ? reconcileLayout(stored, [...defs.keys()]) : null;
  if (!r) { fallback(); return; }
  try {
    // Formen är dockviews egen toJSON(), strikt parsad i reconcileLayout.
    api.fromJSON(r.layout as SerializedDockview);
  } catch {
    api.clear();
    fallback();
    return;
  }
  const add = adder(api, defs);
  r.missing.forEach((id) => add(id));
  // Titlarna i en sparad layout kan vara gamla — appens titlar gäller.
  for (const def of defs.values()) api.getPanel(def.id)?.api.setTitle(def.title);
}

export function DockWorkspace({ page, panels, defaultLayout }: Props) {
  const screen = useScreenClass();
  if (screen === "phone") return <PhoneWorkspace page={page} panels={panels} />;
  return <DesktopWorkspace key={screen} page={page} panels={panels} defaultLayout={defaultLayout} screen={screen} />;
}

/** Telefon: panelerna i laptop-layoutens ordning (personlig → firma → registrets). */
function PhoneWorkspace({ page, panels }: { page: string; panels: readonly PanelDef[] }) {
  const prefs = trpc.prefs.get.useQuery({ key: layoutPrefKey(page, "laptop") });
  const ordered = useMemo(() => {
    const layout = parseStoredLayout(prefs.data?.user) ?? parseStoredLayout(prefs.data?.org);
    if (!layout) return panels;
    const order = panelOrder(layout);
    const rank = (id: string): number => { const i = order.indexOf(id); return i < 0 ? order.length : i; };
    return [...panels].sort((a, b) => rank(a.id) - rank(b.id));
  }, [prefs.data, panels]);
  return <PhonePanels panels={ordered} />;
}

function DesktopWorkspace({ page, panels, defaultLayout, screen }: Props & { screen: "laptop" | "large" }) {
  const key = layoutPrefKey(page, screen);
  const [generation, setGeneration] = useState(0);
  const prefs = trpc.prefs.get.useQuery({ key });
  const apiRef = useRef<DockviewApi | null>(null);
  const defs = useMemo(() => new Map(panels.map((p) => [p.id, p])), [panels]);
  const layout = useLayoutPersistence(key, () => { setGeneration((g) => g + 1); });

  if (prefs.isLoading) return <p className="text-sm text-gray-500">Laddar…</p>;
  const stored = parseStoredLayout(prefs.data?.user) ?? parseStoredLayout(prefs.data?.org);

  return (
    <div className="flex h-full min-h-0 flex-col" onPointerDown={layout.markTouched}>
      <LayoutToolbar hasOrgDefault={prefs.data?.org != null} onReset={layout.reset}
        onSaveOrg={() => { if (apiRef.current) layout.saveOrgDefault(apiRef.current.toJSON()); }} onClearOrg={layout.clearOrgDefault} />
      <PanelDefs.Provider value={defs}>
        <DockviewReact
          key={generation}
          className="min-h-0 flex-1"
          components={COMPONENTS}
          theme={document.documentElement.classList.contains("dark") ? themeDark : themeLight}
          onReady={({ api }) => {
            apiRef.current = api;
            applyLayout(api, stored, defs, () => defaultLayout(adder(api, defs), screen));
            api.onDidLayoutChange(() => layout.onChange(api.toJSON()));
          }}
        />
      </PanelDefs.Provider>
    </div>
  );
}

/** Spara (debouncat, bara efter egen ändring), återställ och firmastandard. */
function useLayoutPersistence(key: string, remount: () => void) {
  const utils = trpc.useUtils();
  const save = trpc.prefs.save.useMutation();
  const clear = trpc.prefs.clear.useMutation();
  const setOrg = trpc.prefs.setOrgDefault.useMutation();
  const clearOrg = trpc.prefs.clearOrgDefault.useMutation();
  const touched = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stored = (layout: SerializedDockview) => ({ version: LAYOUT_VERSION, layout });
  const refresh = () => { void utils.prefs.get.invalidate({ key }).then(remount); };
  return {
    markTouched: () => { touched.current = true; },
    onChange: (layout: SerializedDockview) => {
      if (!touched.current) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => save.mutate({ key, prefs: stored(layout) }), SAVE_DEBOUNCE_MS);
    },
    reset: () => { touched.current = false; clear.mutate({ key }, { onSuccess: refresh }); },
    saveOrgDefault: (layout: SerializedDockview) => setOrg.mutate({ key, prefs: stored(layout) }, { onSuccess: refresh }),
    clearOrgDefault: () => clearOrg.mutate({ key }, { onSuccess: refresh }),
  };
}

function LayoutToolbar({ hasOrgDefault, onReset, onSaveOrg, onClearOrg }: {
  hasOrgDefault: boolean; onReset: () => void; onSaveOrg: () => void; onClearOrg: () => void;
}) {
  const me = trpc.user.current.useQuery();
  const btn = "rounded px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100";
  return (
    <div className="flex shrink-0 items-center justify-end gap-1 pb-1 text-xs text-gray-500">
      <span className="mr-auto">Dra flikarna för att ordna panelerna.</span>
      <button type="button" className={btn} onClick={onReset}>Återställ layout</button>
      {me.data?.role === "ADMIN" && (
        <>
          <button type="button" className={btn} onClick={onSaveOrg}>Spara som firmastandard</button>
          {hasOrgDefault && <button type="button" className={btn} onClick={onClearOrg}>Ta bort firmastandard</button>}
        </>
      )}
    </div>
  );
}
