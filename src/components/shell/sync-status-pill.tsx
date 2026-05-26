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

interface Props {
  state: SyncState;
}

export function SyncStatusPill({ state }: Props) {
  const { icon, label, cls, title } = formatState(state);
  return (
    <Link
      href="/settings"
      title={title}
      className={`text-xs px-2 py-1 rounded border inline-flex items-center gap-1.5 hover:opacity-80 ${cls}`}
    >
      <span aria-hidden>{icon}</span>
      <span>{label}</span>
    </Link>
  );
}

// eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Function 'formatState' has a complexity of 12. Maximum allowed is 8.)
function formatState(s: SyncState): { icon: string; label: string; cls: string; title: string } {
  switch (s.kind) {
    case "idle":
      return { icon: "○", label: "Inte synkat ännu", cls: "bg-gray-50 text-gray-700 border-gray-200", title: "Synk inte påbörjad" };
    case "synced":
      return {
        icon: "✓", label: "Sparat",
        cls: "bg-green-50 text-green-800 border-green-200",
        title: `Senast synkat ${formatRelative(s.at)}`,
      };
    case "syncing":
      return {
        icon: "↻",
        label: s.what === "pull" ? "Hämtar…" : "Sparar…",
        cls: "bg-blue-50 text-blue-800 border-blue-200",
        title: "Synkar med GitHub",
      };
    case "pending":
      return {
        icon: "⏳",
        label: `${s.count} ändring${s.count === 1 ? "" : "ar"} — sparas snart`,
        cls: "bg-amber-50 text-amber-800 border-amber-200",
        title: "Sparas automatiskt om några sekunder",
      };
    case "offline":
      return {
        icon: "⚠",
        label: s.count > 0
          ? `Off-line — ${s.count} ändring${s.count === 1 ? "" : "ar"} väntar`
          : "Off-line",
        cls: "bg-gray-100 text-gray-700 border-gray-300",
        title: "Sparas till disk lokalt; pushas när du är tillbaka online",
      };
    case "merge-needed":
      return {
        icon: "⚠", label: "Merge behövs",
        cls: "bg-orange-50 text-orange-900 border-orange-200",
        title: "Konflikt — öppna inställningar för att lösa",
      };
    case "error":
      return {
        icon: "✗", label: "Synk-fel — försöker igen",
        cls: "bg-red-50 text-red-800 border-red-200",
        title: s.message,
      };
  }
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
