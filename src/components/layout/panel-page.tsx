"use client";

/**
 * En sida av paneler (#1184): huvudet överst, panelerna fyller resten av
 * höjden — sidan scrollar aldrig. dockview laddas först när en sådan sida visas.
 */

import dynamic from "next/dynamic";
import { useLayoutEffect, type ReactNode } from "react";
import type { DefaultLayout } from "./dock-workspace";
import type { PanelDef } from "./panel-def";

const DockWorkspace = dynamic(() => import("./dock-workspace").then((m) => m.DockWorkspace), {
  ssr: false,
  loading: () => <p className="text-sm text-gray-500">Laddar…</p>,
});

/**
 * Medan en sida med rutor visas: märk <html>, så att sidkanten runt <main> blir
 * 8 px från 768 px bredd (globals.css, #1845). Layout-effekt, så att kanten är
 * satt innan webbläsaren ritar och inte hoppar vid navigering.
 */
function useMarkPanelPage(): void {
  useLayoutEffect(() => {
    document.documentElement.dataset.panelPage = "";
    return () => { delete document.documentElement.dataset.panelPage; };
  }, []);
}

export function PanelPage({ page, header, panels, defaultLayout, closable }: {
  /** Sidtyp — nyckeln layouten sparas under. Byt aldrig namn. */
  page: string;
  header: ReactNode;
  panels: readonly PanelDef[];
  defaultLayout: DefaultLayout;
  /** Panel-id:n som användaren får ta bort med × (#1611). Utan: en fast uppsättning. */
  closable?: readonly string[] | undefined;
}) {
  useMarkPanelPage();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0">{header}</div>
      <div className="min-h-0 flex-1">
        <DockWorkspace page={page} panels={panels} defaultLayout={defaultLayout} closable={closable} />
      </div>
    </div>
  );
}
