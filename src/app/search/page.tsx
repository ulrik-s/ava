"use client";

import { useState } from "react";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { trpc } from "@/lib/client/trpc";
import { DataTable, type Column } from "@/components/ui/data-table";
import { omitUndefined } from "@/lib/shared/omit-undefined";

interface SearchHit {
  documentId: string;
  fileName: string;
  storagePath?: string | null;
  matterId: string;
  matterNumber: string;
  matterTitle: string;
  highlight: string;
}

/**
 * Öppna en träff i ny flik. Använder samma open-document-pipeline som
 * document-row så det funkar för demo (gh-pages-URL) och self-hosted
 * (OPFS-blob) — utan att gå via den borttagna /api/-route:n som tidigare
 * gav 404.
 */
async function openHit(hit: SearchHit): Promise<void> {
  const [{ openDocument }, { loadHandle }, { readFromFsa }] = await Promise.all([
    import("@/lib/client/firma/open-document"),
    import("@/lib/client/fsa/handle-store"),
    import("@/lib/client/fsa/read-from-fsa"),
  ]);
  const isDemo = process.env.NEXT_PUBLIC_DEMO_BUILD === "1";
  await openDocument({
    doc: {
      id: hit.documentId,
      ...omitUndefined({ storagePath: hit.storagePath }),
      fileName: hit.fileName,
    },
    isDemo,
    ...omitUndefined({ demoRepo: process.env.NEXT_PUBLIC_DEFAULT_DEMO_REPO }),
    loadHandle: () => loadHandle("repo-root"),
    readFromHandle: readFromFsa,
    openUrl: (u) => window.open(u, "_blank", "noopener,noreferrer"),
    notifyError: (m) => alert(m),
  });
}

function searchColumns(open: (h: SearchHit) => Promise<void>): Column<SearchHit>[] {
  return [
    { key: "fileName", label: "Fil", sortable: true, sortValue: (h) => h.fileName,
      render: (h) => (
        <button type="button" onClick={() => void open(h)}
          className="text-sm font-medium text-blue-600 hover:underline text-left">
          {h.fileName}
        </button>
      ),
    },
    { key: "matter", label: "Ärende", sortable: true, sortValue: (h) => h.matterNumber,
      render: (h) => (
        <EntityLink route="matters" id={h.matterId} className="text-sm text-blue-600 hover:underline">
          {h.matterNumber} — {h.matterTitle}
        </EntityLink>
      ),
    },
    { key: "highlight", label: "Träff", sortable: false,
      render: (h) => (
        <span className="text-sm text-gray-600 line-clamp-2"
          dangerouslySetInnerHTML={{ __html: h.highlight }} />
      ),
    },
  ];
}

// eslint-disable-next-line complexity
export default function DocumentSearchPage() {
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [searchedTypes, setSearchedTypes] = useState<string[]>([]);

  const docTypes = trpc.document.listDocumentTypes.useQuery();

  const results = trpc.document.search.useQuery(
    { query: searchTerm, documentTypes: searchedTypes.length > 0 ? searchedTypes : undefined },
    { enabled: searchTerm.length > 0 }
  );

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearchTerm(query.trim());
    setSearchedTypes(selectedTypes);
  }

  function toggleType(type: string): void {
    setSelectedTypes((prev) => prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dokumentsökning</h1>

      <form onSubmit={handleSearch} className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <p className="text-sm text-gray-500 mb-4">
          Sök i innehållet i alla uppladdade dokument (PDF, Word, etc.).
          Texten extraheras automatiskt vid uppladdning.{" "}
          <span className="text-gray-400">
            Använd <code className="font-mono text-xs bg-gray-100 px-1 rounded">*</code> som
            wildcard, t.ex. <code className="font-mono text-xs bg-gray-100 px-1 rounded">stäm*ansökan</code>.
          </span>
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            required
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Sök i dokument..."
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={results.isFetching}
            className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
          >
            {results.isFetching ? "Söker..." : "Sök"}
          </button>
        </div>

        {docTypes.data && docTypes.data.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium text-gray-600 mb-2">
              Begränsa till dokumenttyp:
              {results.data && (
                <span className="text-gray-400 font-normal">
                  {" "}— räknarna visar träffar för &quot;{searchTerm}&quot; per typ
                </span>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {(() => {
                // Före sökning: visa totalantal per typ ur listDocumentTypes.
                // Efter sökning: visa antal träffar i query-result per typ
                //   (facets), och lägg till 0-räkningar för icke-matchande typer
                //   så user ser att de finns men inte träffas.
                const facetMap = new Map((results.data?.facets?.documentTypes ?? []).map((f) => [f.type, f.count]));
                const rows = results.data
                  ? docTypes.data.map(({ type }) => ({ type, count: facetMap.get(type) ?? 0 }))
                  : docTypes.data;
                return rows.map(({ type, count }) => {
                  const checked = selectedTypes.includes(type);
                  const zeroAfterSearch = results.data !== undefined && count === 0;
                  return (
                    <label
                      key={type}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs cursor-pointer border ${checked ? "bg-blue-100 border-blue-300 text-blue-900" : zeroAfterSearch ? "bg-gray-50 border-gray-200 text-gray-400" : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100"}`}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={checked}
                        onChange={() => toggleType(type)}
                      />
                      {type} <span className={zeroAfterSearch ? "text-gray-300" : "text-gray-400"}>({count})</span>
                    </label>
                  );
                });
              })()}
              {selectedTypes.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedTypes([])}
                  className="text-xs text-gray-500 hover:text-gray-900 underline ml-1"
                >
                  Rensa filter
                </button>
              )}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">
              {selectedTypes.length === 0
                ? "Inga filter — söker i alla typer."
                : `Filter aktivt: ${selectedTypes.length} typ(er) — klicka Sök för att tillämpa.`}
            </p>
          </div>
        )}
      </form>

      {searchTerm && results.data && (
        <div>
          <p className="text-sm text-gray-500 mb-2">
            {results.data.totalHits > 0
              ? `${results.data.totalHits} träff(ar) för "${searchTerm}"`
              : `Inga träffar för "${searchTerm}"`}
          </p>
          {results.data.hits.length > 0 && (
            <DataTable
              prefKey="list.doc-search"
              columns={searchColumns(openHit)}
              data={results.data.hits as SearchHit[]}
              rowKey={(h) => h.documentId}
              emptyMessage="Inga träffar."
            />
          )}
        </div>
      )}

      {results.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-800">{results.error.message}</p>
        </div>
      )}
    </div>
  );
}
