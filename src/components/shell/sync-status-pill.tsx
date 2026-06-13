"use client";

/**
 * `SyncStatusPill` — kompakt status-badge som visar nuvarande sync-läge.
 *
 *   ✓ Sparat       (synced)
 *   ↻ Sparar…      (syncing)
 *   ⏳ Sparas snart (pending — 3 ändringar)
 *   ⚠ Off-line    (offline — 3 ändringar väntar)
 *   ⚠ Merge       (merge-needed)
 *   ✗ Synk-fel    (error)
 *
 * Klick → navigera till /settings (där man kan trigga manuell sync).
 */

import Link from "next/link";
import type { SyncState } from "@/lib/client/sync/use-auto-sync";
import { pluralChanges } from "@/lib/client/utils";

interface Props {
  state: SyncState;
}

export function SyncStatusPill({ state }: Props) {
  const { icon, label, cls, title } = formatState(state);
  return (
    <Link
      href="/settings"
      title={title}
      data-testid="sync-pill"
      className={`text-xs px-2 py-1 rounded border inline-flex items-center gap-1.5 hover:opacity-80 ${cls}`}
    >
      <span aria-hidden>{icon}</span>
      <span>{label}</span>
    </Link>
  );
}

interface PillView { icon: string; label: string; cls: string; title: string }
type SyncKind = SyncState["kind"];
type SyncVariant<K extends SyncKind> = Extract<SyncState, { kind: K }>;

function offlineLabel(count: number): string {
  return count > 0 ? `Off-line — ${count} ${pluralChanges(count)} väntar` : "Off-line";
}

/**
 * En vy per sync-läge. Uppslag i st.f. en 7-grenars switch håller `formatState`
 * under complexity@8 (#6-ratchet); den mappade typen ger varje vy den smalnade
 * varianten (t.ex. `synced` får `.at`, `error` `.message`).
 */
const PILL_VIEWS: { [K in SyncKind]: (s: SyncVariant<K>) => PillView } = {
  idle: () => ({ icon: "○", label: "Inte synkat ännu", cls: "bg-gray-50 text-gray-700 border-gray-200", title: "Synk inte påbörjad" }),
  synced: (s) => ({ icon: "✓", label: "Sparat", cls: "bg-green-50 text-green-800 border-green-200", title: `Senast synkat ${formatRelative(s.at)}` }),
  syncing: (s) => ({ icon: "↻", label: s.what === "pull" ? "Hämtar…" : "Sparar…", cls: "bg-blue-50 text-blue-800 border-blue-200", title: "Synkar med GitHub" }),
  pending: (s) => ({ icon: "⏳", label: `${s.count} ${pluralChanges(s.count)} — sparas snart`, cls: "bg-amber-50 text-amber-800 border-amber-200", title: "Sparas automatiskt om några sekunder" }),
  offline: (s) => ({ icon: "⚠", label: offlineLabel(s.count), cls: "bg-gray-100 text-gray-700 border-gray-300", title: "Sparas till disk lokalt; pushas när du är tillbaka online" }),
  "merge-needed": () => ({ icon: "⚠", label: "Merge behövs", cls: "bg-orange-50 text-orange-900 border-orange-200", title: "Konflikt — öppna inställningar för att lösa" }),
  error: (s) => ({ icon: "✗", label: "Synk-fel — försöker igen", cls: "bg-red-50 text-red-800 border-red-200", title: s.message }),
};

function formatState(s: SyncState): PillView {
  // Uppslaget kan inte korreleras med `s`:s variant av TS → en lokal cast.
  const view = PILL_VIEWS[s.kind] as (x: SyncState) => PillView;
  return view(s);
}

function formatRelative(at: number): string {
  const sec = Math.round((Date.now() - at) / 1000);
  if (sec < 5) return "just nu";
  if (sec < 60) return `${sec}s sedan`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min sedan`;
  const h = Math.round(min / 60);
  return `${h}h sedan`;
}
