"use client";

/**
 * En sida av paneler (#1184): huvudet överst, panelerna fyller resten av
 * höjden — sidan scrollar aldrig. dockview laddas först när en sådan sida visas.
 */

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import type { DefaultLayout } from "./dock-workspace";
import type { PanelDef } from "./panel-def";

const DockWorkspace = dynamic(() => import("./dock-workspace").then((m) => m.DockWorkspace), {
  ssr: false,
  loading: () => <p className="text-sm text-gray-500">Laddar…</p>,
});

export function PanelPage({ page, header, panels, defaultLayout }: {
  /** Sidtyp — nyckeln layouten sparas under. Byt aldrig namn. */
  page: string;
  header: ReactNode;
  panels: readonly PanelDef[];
  defaultLayout: DefaultLayout;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0">{header}</div>
      <div className="min-h-0 flex-1">
        <DockWorkspace page={page} panels={panels} defaultLayout={defaultLayout} />
      </div>
    </div>
  );
}
