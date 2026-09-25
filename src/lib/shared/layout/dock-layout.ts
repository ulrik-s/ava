/**
 * Dockbara sidlayouter (#1184/#1185) — det rena, testbara lagret.
 *
 * En sida (t.ex. ärendesidan) består av PANELER som användaren drar runt i en
 * dockview-yta. Layouten sparas per sidtyp och SKÄRMKLASS: samma person på en
 * 13"-laptop och på kontorets stora skärm vill ha olika uppställning.
 *
 * Den sparade layouten är dockviews egen serialisering. Vi parsar den del vi
 * rör strikt (zod) och låter resten passera — formatet ägs av biblioteket.
 */

import { z } from "zod";

/** Skärmklasser. Telefon har ingen dragning — en panel i taget. */
export type ScreenClass = "phone" | "laptop" | "large";

/** Brytpunkter i CSS-pixlar (fönsterbredd). 13" MacBook Air ≈ 1470 px. */
export const PHONE_MAX_WIDTH = 767;
export const LAPTOP_MAX_WIDTH = 1799;

export function screenClassFor(width: number): ScreenClass {
  if (width <= PHONE_MAX_WIDTH) return "phone";
  return width <= LAPTOP_MAX_WIDTH ? "laptop" : "large";
}

/** Preferens-nyckeln för en sidtyps layout på en skärmklass. */
export function layoutPrefKey(page: string, screen: Exclude<ScreenClass, "phone">): string {
  return `layout.${page}.${screen}`;
}

/** Bumpas när layoutformatet ändras så gamla sparade layouter ignoreras. */
export const LAYOUT_VERSION = 1;

type NodeExtras = { size?: number | undefined; visible?: boolean | undefined };
type GridNode = ({ type: "leaf"; data: GroupState } | { type: "branch"; data: GridNode[] }) & NodeExtras;

const groupStateSchema = z.object({
  id: z.string(),
  views: z.array(z.string()),
  activeView: z.string().optional(),
}).passthrough();
type GroupState = z.infer<typeof groupStateSchema>;

const gridNodeSchema: z.ZodType<GridNode> = z.lazy(() => z.union([
  z.object({ type: z.literal("leaf"), data: groupStateSchema, size: z.number().optional(), visible: z.boolean().optional() }).passthrough(),
  z.object({ type: z.literal("branch"), data: z.array(gridNodeSchema), size: z.number().optional(), visible: z.boolean().optional() }).passthrough(),
]));

/** Den del av dockviews serialisering vi läser och skriver. */
export const serializedLayoutSchema = z.object({
  grid: z.object({ root: gridNodeSchema, width: z.number(), height: z.number(), orientation: z.string() }).passthrough(),
  panels: z.record(z.string(), z.object({ id: z.string() }).passthrough()),
  activeGroup: z.string().optional(),
}).passthrough();
export type SerializedLayout = z.infer<typeof serializedLayoutSchema>;

/** Det som sparas i preferensen. */
export const storedLayoutSchema = z.object({ version: z.literal(LAYOUT_VERSION), layout: serializedLayoutSchema });

/** Sparad layout ur en preferens, eller null om den saknas/är av fel version/trasig. */
export function parseStoredLayout(prefs: unknown): SerializedLayout | null {
  const r = storedLayoutSchema.safeParse(prefs);
  return r.success ? r.data.layout : null;
}

/** Paneler i visningsordning: vänster→höger, uppifrån och ned, flikordning. */
export function panelOrder(layout: SerializedLayout): string[] {
  const walk = (n: GridNode): string[] => (n.type === "leaf" ? n.data.views : n.data.flatMap(walk));
  return walk(layout.grid.root);
}

/** Ta bort paneler ur trädet som inte längre finns; tomma grupper/grenar försvinner. */
function pruneNode(n: GridNode, keep: ReadonlySet<string>): GridNode | null {
  if (n.type === "leaf") {
    const g = n.data;
    const views = g.views.filter((v) => keep.has(v));
    if (views.length === 0) return null;
    const activeView = g.activeView !== undefined && keep.has(g.activeView) ? g.activeView : views[0];
    return { ...n, data: { ...g, views, activeView } };
  }
  const children = n.data.map((c) => pruneNode(c, keep)).filter((c): c is GridNode => c !== null);
  return children.length === 0 ? null : { ...n, data: children };
}

/**
 * Anpassa en sparad layout till dagens panel-uppsättning: paneler som tagits
 * bort ur appen rensas, och de som tillkommit efter att layouten sparades
 * returneras i `missing` (anroparen lägger in dem). `null` = inget kvar av
 * layouten — använd standard.
 */
export function reconcileLayout(
  layout: SerializedLayout, panelIds: readonly string[],
): { layout: SerializedLayout; missing: string[] } | null {
  const keep = new Set(panelIds);
  const root = pruneNode(layout.grid.root, keep);
  if (!root) return null;
  const panels = Object.fromEntries(Object.entries(layout.panels).filter(([id]) => keep.has(id)));
  const present = new Set(panelOrder({ ...layout, grid: { ...layout.grid, root } }));
  return {
    layout: { ...layout, grid: { ...layout.grid, root }, panels },
    missing: panelIds.filter((id) => !present.has(id)),
  };
}
