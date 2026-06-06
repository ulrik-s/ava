"use client";

import Link from "next/link";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { trpc } from "@/lib/client/trpc";
import { ShieldAlert, UserX, UserRound } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { patchFirmaConfig } from "@/lib/client/firma/firma-config";

const roleLabels: Record<string, string> = {
  ADMIN: "Admin",
  LAWYER: "Advokat",
  ASSISTANT: "Assistent",
};

interface UserRow {
  id: string;
  name: string;
  title?: string | null;
  email: string;
  role: string;
  hourlyRate?: number | null;
  mileageRate?: number | null;
}

/** Logga in som en annan användare ("Bli X"). Admin-only — använder samma
 *  patch som /login. Reloadar sidan så demo-bootstrap initierar
 *  trpcClient med nytt principal-id. */
export function becomeUser(u: Pick<UserRow, "id" | "name" | "email">): void {
  if (typeof window === "undefined") return;
  patchFirmaConfig({ principalId: u.id, authorName: u.name, authorEmail: u.email });
  const basePath = process.env.NEXT_PUBLIC_DEMO_BASE_PATH ?? "";
  window.location.replace(`${basePath}/`);
}

function BecomeButton({ user, onClick }: { user: UserRow; onClick: (u: UserRow) => void }) {
  return (
    <button
      type="button"
      onClick={() => onClick(user)}
      className="text-xs text-gray-400 hover:text-blue-600 inline-flex items-center gap-1"
      title={`Logga in som ${user.name}`}
    >
      <UserRound size={12} /> Bli denna
    </button>
  );
}

function buildUserColumns(opts: {
  isAdmin: boolean;
  meId?: string | undefined;
  onDeactivate: (id: string, name: string) => void;
  onBecome: (u: UserRow) => void;
}): Column<UserRow>[] {
  const base: Column<UserRow>[] = [
    { key: "name", label: "Namn", sortable: true, sortValue: (u) => u.name,
      render: (u) => <EntityLink route="users" id={u.id} className="text-sm font-medium text-blue-600 hover:underline">{u.name}</EntityLink> },
    { key: "title", label: "Titel", sortable: true, sortValue: (u) => u.title ?? "",
      render: (u) => <span className="text-sm text-gray-500">{u.title || "—"}</span> },
    { key: "email", label: "E-post", sortable: true, sortValue: (u) => u.email,
      render: (u) => <span className="text-sm text-gray-500">{u.email}</span> },
    { key: "role", label: "Roll", sortable: true, sortValue: (u) => roleLabels[u.role] || u.role,
      render: (u) => <span className="text-sm text-gray-500">{roleLabels[u.role] || u.role}</span> },
    { key: "hourlyRate", label: "Timtaxa", sortable: true, align: "right",
      sortValue: (u) => u.hourlyRate ?? -1,
      render: (u) => <span className="text-sm text-gray-500">{u.hourlyRate != null ? `${u.hourlyRate} kr/h` : "—"}</span> },
    { key: "mileageRate", label: "Milersättning", sortable: true, align: "right",
      sortValue: (u) => u.mileageRate ?? -1,
      render: (u) => <span className="text-sm text-gray-500">{u.mileageRate != null ? `${(u.mileageRate / 100).toFixed(2)} kr/km` : "—"}</span> },
  ];
  if (!opts.isAdmin) return base;
  return [
    ...base,
    { key: "actions", label: "", sortable: false, align: "right", hideable: false,
      render: (u) => (
        u.id !== opts.meId ? (
          <span className="inline-flex items-center gap-3">
            <BecomeButton user={u} onClick={opts.onBecome} />
            <button
              type="button"
              onClick={() => opts.onDeactivate(u.id, u.name)}
              className="text-xs text-gray-400 hover:text-red-600 inline-flex items-center gap-1"
              title="Inaktivera"
            >
              <UserX size={12} /> Inaktivera
            </button>
          </span>
        ) : null
      ),
    },
  ];
}

function confirmDeactivate(id: string, name: string, run: (args: { id: string }) => void): void {
  if (confirm(`Inaktivera ${name}? Användaren kan inte längre logga in men historik bevaras.`)) {
    run({ id });
  }
}

// eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8 — JSX-conditionals i list-headern)
export default function UsersPage() {
  const me = trpc.user.current.useQuery();
  const users = trpc.user.list.useQuery();
  const utils = trpc.useUtils();
  const deactivate = trpc.user.deactivate.useMutation({
    onSuccess: () => utils.user.list.invalidate(),
  });

  const isAdmin = me.data?.role === "ADMIN";
  const columns = buildUserColumns({
    isAdmin,
    meId: me.data?.id,
    onDeactivate: (id, name) => confirmDeactivate(id, name, deactivate.mutate),
    onBecome: (u) => { if (confirm(`Logga in som ${u.name}?`)) becomeUser(u); },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Användare</h1>
        {isAdmin && (
          <Link
            href="/users/new"
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            + Ny användare
          </Link>
        )}
      </div>

      {!isAdmin && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-900 flex items-center gap-2">
          <ShieldAlert size={16} /> Endast administratörer kan skapa eller inaktivera användare.
        </div>
      )}

      <DataTable
        prefKey="list.users"
        columns={columns}
        data={(users.data?.users ?? []) as UserRow[]}
        rowKey={(u) => u.id}
        emptyMessage="Inga användare."
      />

      {users.isLoading && <p className="mt-4 text-sm text-gray-500">Laddar...</p>}
      {users.error && <p className="mt-4 text-sm text-red-600">Fel: {users.error.message}</p>}
      {deactivate.error && <p className="mt-4 text-sm text-red-600">{deactivate.error.message}</p>}
    </div>
  );
}
