"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/client/trpc";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { shellPath } from "@/lib/client/demo/entity-href";
import { Plus, Pencil, Trash2, FileText } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";

interface Template {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  createdBy?: { name?: string | null } | null;
  updatedAt: string | Date;
}

export default function TemplatesPage() {
  const router = useRouter();
  const templates = trpc.documentTemplate.list.useQuery();
  const utils = trpc.useUtils();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const deleteTemplate = trpc.documentTemplate.delete.useMutation({
    onSuccess: () => {
      void utils.documentTemplate.list.invalidate();
      setConfirmDelete(null);
    },
  });

  const columns: Column<Template>[] = [
    { key: "name", label: "Namn", sortable: true, sortValue: (t) => t.name,
      render: (t) => <span className="text-sm font-medium text-gray-900">{t.name}</span> },
    { key: "category", label: "Kategori", sortable: true,
      sortValue: (t) => t.category ?? "Okategoriserade",
      render: (t) => <span className="text-sm text-gray-700">{t.category || "Okategoriserade"}</span> },
    { key: "description", label: "Beskrivning", sortable: true,
      sortValue: (t) => t.description ?? "",
      render: (t) => <span className="text-sm text-gray-500">{t.description || "–"}</span> },
    { key: "createdBy", label: "Skapad av", sortable: true,
      sortValue: (t) => t.createdBy?.name ?? "",
      render: (t) => <span className="text-sm text-gray-500">{t.createdBy?.name ?? "—"}</span> },
    { key: "updatedAt", label: "Uppdaterad", sortable: true,
      sortValue: (t) => new Date(t.updatedAt),
      render: (t) => <span className="text-sm text-gray-400">{new Date(t.updatedAt).toLocaleDateString("sv-SE")}</span> },
    { key: "actions", label: "", sortable: false, align: "right", hideable: false,
      render: (t) => (
        <span className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
          <EntityLink route="templates" id={t.id} sub="edit"
            className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700" title="Redigera">
            <Pencil size={14} />
          </EntityLink>
          <button onClick={() => setConfirmDelete(t.id)}
            className="p-1.5 rounded hover:bg-red-50 text-gray-500 hover:text-red-600" title="Ta bort">
            <Trash2 size={14} />
          </button>
        </span>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dokumentmallar</h1>
          <p className="text-sm text-gray-500 mt-1">
            Skapa och hantera mallar för att generera dokument från ärendedata.
          </p>
        </div>
        <Link
          href="/templates/new"
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
        >
          <Plus size={16} /> Ny mall
        </Link>
      </div>

      {templates.isLoading && <p className="text-gray-500 text-sm">Laddar mallar…</p>}

      {templates.data && templates.data.length === 0 && (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl">
          <FileText className="mx-auto text-gray-300 mb-3" size={40} />
          <p className="text-gray-500 font-medium">Inga mallar än</p>
          <p className="text-gray-400 text-sm mt-1">Skapa din första mall för att komma igång.</p>
          <Link
            href="/templates/new"
            className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
          >
            <Plus size={14} /> Ny mall
          </Link>
        </div>
      )}

      {templates.data && templates.data.length > 0 && (
        <DataTable
          prefKey="list.templates"
          columns={columns}
          data={templates.data as Template[]}
          rowKey={(t) => t.id}
          onRowClick={(t) => router.push(shellPath("templates", t.id, "edit"))}
          emptyMessage="Inga mallar."
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-semibold text-gray-900 mb-2">Ta bort mall?</h3>
            <p className="text-sm text-gray-500 mb-4">
              Åtgärden kan inte ångras. Mallen tas bort permanent.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
              >
                Avbryt
              </button>
              <button
                onClick={() => deleteTemplate.mutate({ id: confirmDelete })}
                disabled={deleteTemplate.isPending}
                className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                {deleteTemplate.isPending ? "Tar bort…" : "Ta bort"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
