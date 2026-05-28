"use client";

/**
 * `OrgDefaultsSection` — admin-vy som visar vilka listor som har en
 * org-globalt satt kolumn-default. Sätts genom att admin går till själva
 * listan, ändrar vyn och klickar "Spara som org-default" i kolumn-menyn.
 * Här kan man bara titta + ta bort.
 */

import { trpc } from "@/lib/client/trpc";

const KEY_LABELS: Record<string, string> = {
  "list.contacts": "Kontakter",
  "list.matters": "Ärenden",
  "list.invoices": "Fakturor",
  "list.time-entries": "Tidregistrering",
  "list.users": "Användare",
};

function labelFor(key: string): string {
  if (KEY_LABELS[key]) return KEY_LABELS[key];
  if (key.startsWith("list.matter-time.")) return `Ärendes tidsposter (${key.split(".")[2]})`;
  if (key.startsWith("list.matter-expenses.")) return `Ärendes utlägg (${key.split(".")[2]})`;
  if (key.startsWith("list.matter-calendar.")) return `Ärendes kalender (${key.split(".")[2]})`;
  if (key.startsWith("list.matter-invoices.")) return `Ärendes fakturor (${key.split(".")[2]})`;
  return key;
}

export function OrgDefaultsSection() {
  const me = trpc.user.current.useQuery();
  const isAdmin = me.data?.role === "ADMIN";
  const list = trpc.prefs.listOrgDefaults.useQuery(undefined, { enabled: isAdmin });
  const utils = trpc.useUtils();
  const clearOrg = trpc.prefs.clearOrgDefault.useMutation({
    onSuccess: () => utils.prefs.listOrgDefaults.invalidate(),
  });

  if (!isAdmin) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-5 mb-5">
        <p className="text-sm text-gray-500">
          Endast administratörer kan se och hantera org-globala standardvyer.
        </p>
      </div>
    );
  }

  const defaults = (list.data ?? []) as Array<{ id: string; key: string }>;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900">Org-globala standardvyer</h2>
        <p className="text-xs text-gray-500">Sätts från kolumn-menyn (⋯) i varje lista.</p>
      </div>
      {list.isLoading ? (
        <p className="text-xs text-gray-400">Laddar…</p>
      ) : defaults.length === 0 ? (
        <p className="text-xs text-gray-500">Inga org-globala standardvyer satta ännu.</p>
      ) : (
        <ul className="divide-y divide-gray-100 -mx-2">
          {defaults.map((d) => (
            <li key={d.id} className="flex items-center justify-between px-2 py-2">
              <div>
                <p className="text-sm font-medium text-gray-900">{labelFor(d.key)}</p>
                <p className="text-[10px] text-gray-400 font-mono">{d.key}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Ta bort org-default för ${labelFor(d.key)}?`)) {
                    clearOrg.mutate({ key: d.key });
                  }
                }}
                className="text-xs text-red-600 hover:underline"
              >
                Ta bort
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-gray-500">
        Personliga inställningar vinner alltid över org-globala. Användare som inte
        har gjort egna val ser de globala värdena.
      </p>
    </div>
  );
}
