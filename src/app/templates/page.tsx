"use client";

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/client/trpc";
import { Plus, Pencil, Trash2, FileText } from "lucide-react";

export default function TemplatesPage() {
  const templates = trpc.documentTemplate.list.useQuery();
  const utils = trpc.useUtils();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const deleteTemplate = trpc.documentTemplate.delete.useMutation({
    onSuccess: () => {
      utils.documentTemplate.list.invalidate();
      setConfirmDelete(null);
    },
  });

  const grouped = templates.data
    ? templates.data.reduce<Record<string, typeof templates.data>>((acc, t) => {
        const key = t.category || "Okategoriserade";
        if (!acc[key]) acc[key] = [];
        acc[key].push(t);
        return acc;
      }, {})
    : {};

  return (
    <div className="p-6 max-w-4xl">
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

      {Object.entries(grouped).map(([category, items]) => (
        <div key={category} className="mb-8">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            {category}
          </h2>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Namn</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600 hidden sm:table-cell">
                    Beskrivning
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600 hidden md:table-cell">
                    Skapad av
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600 hidden md:table-cell">
                    Uppdaterad
                  </th>
                  <th className="w-20" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{t.name}</td>
                    <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">
                      {t.description || <span className="text-gray-300">–</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500 hidden md:table-cell">
                      {t.createdBy?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-400 hidden md:table-cell">
                      {new Date(t.updatedAt).toLocaleDateString("sv-SE")}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <Link
                          href={`/templates/${t.id}/edit`}
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"
                          title="Redigera"
                        >
                          <Pencil size={14} />
                        </Link>
                        <button
                          onClick={() => setConfirmDelete(t.id)}
                          className="p-1.5 rounded hover:bg-red-50 text-gray-500 hover:text-red-600"
                          title="Ta bort"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {/* Delete confirmation dialog */}
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
