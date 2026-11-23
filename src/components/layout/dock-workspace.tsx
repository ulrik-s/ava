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
 *
 * Valbara paneler (#1611): sidan kan ange paneler som användaren får ta bort
 * med ×. De dolda filtreras bort innan de når layouten, så varken en sparad
 * layout, standardlayouten eller sent tillkomna paneler lägger tillbaka dem.
 * "Lägg till ruta" (#1612) lägger tillbaka en dold panel som aktiv; är alla
 * borttagna visas ett tomt läge i stället för en tom dockyta.
 */

import "dockview-react/dist/styles/dockview.css";
import {
  DockviewDefaultTab, DockviewReact, themeDark, themeLight,
  type AddPanelPositionOptions, type DockviewApi, type IDockviewPanelHeaderProps, type IDockviewPanelProps, type SerializedDockview,
} from "dockview-react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useScreenClass } from "@/lib/client/layout/use-screen-class";
import { trpc } from "@/lib/client/trpc";
import {
  hiddenChoices, LAYOUT_VERSION, layoutPrefKey, panelOrder, parseStoredLayout, reconcileLayout, visiblePanels, withoutMaximized,
  type SerializedLayout,
} from "@/lib/shared/layout/dock-layout";
import { AddPanelMenu, NoPanels, TOOLBAR_BUTTON, type PanelChoices } from "./add-panel-menu";
import { MaximizeAction } from "./maximize-action";
import { keepProportionsAcrossMaximize } from "./maximize-proportions";
import { useOverflowTriggerLabels } from "./overflow-trigger";
import type { PanelDef } from "./panel-def";
import { PhonePanels } from "./phone-panels";
import { swallowTabCloseKey } from "./tab-close-keys";
import { useHiddenPanels } from "./use-hidden-panels";

/** Lägg till en panel (via id); standardlayouter bygger med den. `inactive` = lägg till som bakgrundsflik. */
export type AddPanel = (id: string, opts?: { position?: AddPanelPositionOptions; inactive?: boolean; initialWidth?: number }) => void;
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
  /** Panel-id:n som användaren får ta bort med ×. Utan: inga flikar kan stängas. */
  closable?: readonly string[] | undefined;
}

const NO_CLOSABLE: readonly string[] = [];

/** Vilka flikar som har × och vad × gör; `null` = sidan har inga valbara paneler. */
interface TabClose { closable: ReadonlySet<string>; hide: (id: string) => void }
const TabCloseContext = createContext<TabClose | null>(null);

const PanelDefs = createContext<ReadonlyMap<string, PanelDef>>(new Map());

/**
 * Panelens innehåll; scrollar inom panelen, aldrig sidan. `relative` gör
 * panelkroppen till referens för absoluta element (t.ex. `sr-only`). Annars
 * räknades de mot dockviews `.dv-view`, som fick en egen scrollbar ovanpå
 * panelens: två scrollbarer (#1306).
 */
function PanelHost({ params }: IDockviewPanelProps<{ id: string }>) {
  const def = useContext(PanelDefs).get(params.id);
  const pad = def?.fill ? "" : " p-2 space-y-2";
  return <div className={`relative h-full overflow-y-auto${pad}`}>{def?.render()}</div>;
}
const COMPONENTS = { panel: PanelHost };

/**
 * Fliken utan stängknapp (#1292): en sida har en fast uppsättning paneler.
 * × (och mittenklick) stängde panelen, och den var borta tills sidan
 * laddades om. Undantag: en valbar panel (#1611) får ×, som tar bort panelen
 * och sparar den som dold. Bara användarens × går hit, aldrig dockviews egna
 * borttagningar (`clear`, `fromJSON`).
 */
export function PanelTab(props: IDockviewPanelHeaderProps) {
  const close = useContext(TabCloseContext);
  if (!close?.closable.has(props.api.id)) return <DockviewDefaultTab {...props} hideClose />;
  const closeAction = (): void => { props.api.close(); close.hide(props.api.id); };
  return <DockviewDefaultTab {...props} closeActionOverride={closeAction} />;
}

/** Placering relativt en panel som inte finns (t.ex. dold) → ingen placering; dockview hade kastat. */
function placeable(api: DockviewApi, position: AddPanelPositionOptions | undefined): AddPanelPositionOptions | undefined {
  if (!position || !("referencePanel" in position)) return position;
  const ref = position.referencePanel;
  return typeof ref === "string" && !api.getPanel(ref) ? undefined : position;
}

const SAVE_DEBOUNCE_MS = 800;

function adder(api: DockviewApi, defs: ReadonlyMap<string, PanelDef>): AddPanel {
  return (id, opts = {}) => {
    const def = defs.get(id);
    if (!def || api.getPanel(id)) return;
    const position = placeable(api, opts.position);
    api.addPanel({
      id, component: "panel", title: def.title, params: { id },
      ...(position ? { position } : {}), ...(opts.inactive ? { inactive: true } : {}),
      ...(opts.initialWidth ? { initialWidth: opts.initialWidth } : {}),
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

/** `/settings#external` → den panelen blir aktiv (länkar från andra sidor). */
export function activatePanelFromHash(
  api: { getPanel: (id: string) => { api: { setActive: () => void } } | undefined },
  hash: string,
): void {
  const id = hash.replace(/^#/, "");
  if (id) api.getPanel(id)?.api.setActive();
}

export function DockWorkspace({ page, panels, defaultLayout, closable = NO_CLOSABLE }: Props) {
  const screen = useScreenClass();
  const hidden = useHiddenPanels(page, closable);
  const visible = useMemo(() => visiblePanels(panels, closable, hidden.hidden), [panels, closable, hidden.hidden]);
  const closableSet = useMemo(() => new Set(closable), [closable]);
  const selectable = closable.length > 0;
  const tabClose = selectable ? { closable: closableSet, hide: hidden.hide } : null;
  const choices = selectable ? { hidden: hiddenChoices(panels, closable, hidden.hidden), show: hidden.show } : null;
  if (hidden.isLoading) return <p className="text-sm text-gray-500">Laddar…</p>;
  if (choices && visible.length === 0) return <NoPanels choices={choices} />;
  return (
    <TabCloseContext.Provider value={tabClose}>
      {screen === "phone"
        ? <PhoneWorkspace page={page} panels={visible} choices={choices} />
        : <DesktopWorkspace key={screen} page={page} panels={visible} defaultLayout={defaultLayout} screen={screen} choices={choices} />}
    </TabCloseContext.Provider>
  );
}

/** Telefon: panelerna i laptop-layoutens ordning (personlig → firma → registrets). */
function PhoneWorkspace({ page, panels, choices }: { page: string; panels: readonly PanelDef[]; choices: PanelChoices | null }) {
  const close = useContext(TabCloseContext);
  const prefs = trpc.prefs.get.useQuery({ key: layoutPrefKey(page, "laptop") });
  const ordered = useMemo(() => {
    const layout = parseStoredLayout(prefs.data?.user) ?? parseStoredLayout(prefs.data?.org);
    if (!layout) return panels;
    const order = panelOrder(layout);
    const rank = (id: string): number => { const i = order.indexOf(id); return i < 0 ? order.length : i; };
    return [...panels].sort((a, b) => rank(a.id) - rank(b.id));
  }, [prefs.data, panels]);
  return <PhonePanels panels={ordered} closable={close?.closable} onClose={close?.hide} choices={choices} />;
}

function DesktopWorkspace({ page, panels, defaultLayout, screen, choices }: Props & { screen: "laptop" | "large"; choices: PanelChoices | null }) {
  const key = layoutPrefKey(page, screen);
  const [generation, setGeneration] = useState(0);
  const prefs = trpc.prefs.get.useQuery({ key });
  const apiRef = useRef<DockviewApi | null>(null);
  const defs = useMemo(() => new Map(panels.map((p) => [p.id, p])), [panels]);
  const layout = useLayoutPersistence(key, () => { setGeneration((g) => g + 1); });
  const overflowLabels = useOverflowTriggerLabels();
  const [maximized, setMaximized] = useState(false);
  // Panelen som användaren just lagt tillbaka med "Lägg till ruta" (#1612).
  const revealed = useRef<string | null>(null);
  // En panel som tillkommer efter start — t.ex. Backup, som visas först när
  // servern och rollen är kända (#1431) — läggs till som en inaktiv flik.
  // Den som användaren själv lagt tillbaka blir aktiv.
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const add = adder(api, defs);
    defs.forEach((_, id) => add(id, id === revealed.current ? {} : { inactive: true }));
    revealed.current = null;
  }, [defs]);
  const reveal = choices && { ...choices, show: (id: string) => { revealed.current = id; choices.show(id); } };

  if (prefs.isLoading) return <p className="text-sm text-gray-500">Laddar…</p>;
  const stored = parseStoredLayout(prefs.data?.user) ?? parseStoredLayout(prefs.data?.org);

  return (
    <div ref={overflowLabels} className="flex h-full min-h-0 flex-col" onPointerDown={layout.markTouched} onKeyDownCapture={swallowTabCloseKey}>
      <LayoutToolbar hasOrgDefault={prefs.data?.org != null} maximized={maximized} onReset={layout.reset} choices={reveal}
        onSaveOrg={() => { if (apiRef.current && !apiRef.current.hasMaximizedGroup()) layout.saveOrgDefault(apiRef.current.toJSON()); }}
        onClearOrg={layout.clearOrgDefault} />
      <PanelDefs.Provider value={defs}>
        <DockviewReact
          key={generation}
          className="min-h-0 flex-1"
          components={COMPONENTS}
          defaultTabComponent={PanelTab}
          rightHeaderActionsComponent={MaximizeAction}
          // Shift-drag skapade flytande grupper (#1356) — sidans paneler hör hemma i rutnätet.
          disableFloatingGroups
          theme={document.documentElement.classList.contains("dark") ? themeDark : themeLight}
          onReady={({ api }) => {
            apiRef.current = api;
            applyLayout(api, stored, defs, () => defaultLayout(adder(api, defs), screen));
            keepProportionsAcrossMaximize(api);
            activatePanelFromHash(api, window.location.hash);
            api.onDidMaximizedGroupChange(() => setMaximized(api.hasMaximizedGroup()));
            // Under maximering serialiserar dockview de dolda gruppernas gamla
            // pixlar; sparas först när gruppen återställts (#1291).
            api.onDidLayoutChange(() => { if (!api.hasMaximizedGroup()) layout.onChange(api.toJSON()); });
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
  const stored = (layout: SerializedDockview) => ({ version: LAYOUT_VERSION, layout: withoutMaximized(layout) });
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

/**
 * Verktygsraden. Firmastandarden går inte att spara medan en panel är
 * maximerad (#1356): dockview serialiserar då de dolda gruppernas gamla
 * pixlar, och hela byrån hade fått den skeva layouten (jfr #1291).
 */
function LayoutToolbar({ hasOrgDefault, maximized, onReset, onSaveOrg, onClearOrg, choices }: {
  hasOrgDefault: boolean; maximized: boolean; onReset: () => void; onSaveOrg: () => void; onClearOrg: () => void;
  /** Valbara paneler (#1612); `null` = sidan har inga. */
  choices: PanelChoices | null;
}) {
  const me = trpc.user.current.useQuery();
  const btn = TOOLBAR_BUTTON;
  return (
    <div className="flex shrink-0 items-center justify-end gap-1 pb-1 text-xs text-gray-500">
      <span className="mr-auto">Dra flikarna för att ordna panelerna.</span>
      {choices && <AddPanelMenu choices={choices} />}
      <button type="button" className={btn} onClick={onReset}>Återställ layout</button>
      {me.data?.role === "ADMIN" && (
        <>
          <button type="button" className={btn} onClick={onSaveOrg} disabled={maximized}
            title={maximized ? "Återställ den maximerade panelen först" : undefined}>Spara som firmastandard</button>
          {hasOrgDefault && <button type="button" className={btn} onClick={onClearOrg}>Ta bort firmastandard</button>}
        </>
      )}
    </div>
  );
}
