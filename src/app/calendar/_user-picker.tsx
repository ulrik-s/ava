"use client";

/**
 * `UserPicker` — checkbox-lista över org-användare för multi-user-
 * kalendervyn. Färgswatch framför namnet matchar `colorForUserId`.
 *
 * Persistar val i localStorage (`ava.calendar.selectedUsers`) så vyn
 * minns vilka man tittar på mellan sessioner.
 */

import { useEffect } from "react";
import { Users } from "lucide-react";
import { trpc } from "@/client/lib/trpc";
import { colorForUserId, type UserColor } from "@/client/lib/calendar/user-colors";

interface UserPickerProps {
  selectedUserIds: readonly string[];
  onChange: (ids: string[]) => void;
  /** Min 1 användare måste vara markerad — annars är vyn tom. Default: false. */
  enforceAtLeastOne?: boolean;
  /**
   * Stabil färgkarta från `buildUserColorMap` — garanterat unika färger
   * för ≤12 användare. Faller tillbaka till hash-baserad `colorForUserId`
   * om id:t saknas i mappen.
   */
  userColors?: Map<string, UserColor>;
}

const LS_KEY = "ava.calendar.selectedUsers";

export function UserPicker({ selectedUserIds, onChange, enforceAtLeastOne, userColors }: UserPickerProps) {
  const usersQuery = trpc.user.list.useQuery();
  const users = usersQuery.data?.users ?? [];

  // Persistera vid varje ändring
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(LS_KEY, JSON.stringify(selectedUserIds));
  }, [selectedUserIds]);

  const toggle = (id: string) => {
    const isSelected = selectedUserIds.includes(id);
    if (isSelected) {
      if (enforceAtLeastOne && selectedUserIds.length <= 1) return;
      onChange(selectedUserIds.filter((x) => x !== id));
    } else {
      onChange([...selectedUserIds, id]);
    }
  };

  if (usersQuery.isLoading) {
    return <div className="text-xs text-gray-500 px-3 py-2">Laddar användare…</div>;
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 text-xs font-semibold uppercase text-gray-500">
        <Users size={12} /> Användare
      </div>
      <ul className="divide-y divide-gray-100">
        {users.map((u: { id: string; name: string; role?: string }) => {
          const selected = selectedUserIds.includes(u.id);
          const c = userColors?.get(u.id) ?? colorForUserId(u.id);
          return (
            <li key={u.id}>
              <button type="button" onClick={() => toggle(u.id)}
                aria-pressed={selected}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 ${selected ? "bg-blue-50/50" : ""}`}>
                <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ background: c.bg }} aria-hidden />
                <input type="checkbox" readOnly checked={selected} className="pointer-events-none" tabIndex={-1} />
                <span className={`truncate ${selected ? "font-medium text-gray-900" : "text-gray-700"}`}>
                  {u.name}
                </span>
                {u.role === "ADMIN" && (
                  <span className="ml-auto text-[9px] bg-gray-200 text-gray-700 px-1 rounded">ADMIN</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Läs sparat val från localStorage. Returnerar tom array om inget eller fel. */
export function loadSelectedUserIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
