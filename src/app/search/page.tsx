"use client";

import { useState } from "react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { useCapabilities } from "@/lib/client/capabilities/use-capabilities";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { searchScope, searchScopeLabel, type SearchScope } from "@/lib/client/search/search-scope";
import { useOnlineStatus } from "@/lib/client/sync/use-online-status";
import { trpc } from "@/lib/client/trpc";
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

interface DocTypeCount { type: string; count: number }
interface SearchData { totalHits: number; hits: unknown[]; facets?: { documentTypes?: DocTypeCount[] } }

/** Före sökning: totalantal per typ. Efter: facet-träffar (0 för icke-matchande). */
function facetRows(types: DocTypeCount[], data: SearchData | undefined): DocTypeCount[] {
  if (!data) return types;
  const facetMap = new Map((data.facets?.documentTypes ?? []).map((f) => [f.type, f.count]));
  return types.map(({ type }) => ({ type, count: facetMap.get(type) ?? 0 }));
}

interface DocTypeFilterProps {
  types: DocTypeCount[];
  data: SearchData | undefined;
  searchTerm: string;
  selectedTypes: string[];
  onToggle: (type: string) => void;
  onClear: () => void;
}

function DocTypeFilter({ types, data, searchTerm, selectedTypes, onToggle, onClear }: DocTypeFilterProps) {
  return (
    <div className="mt-4">
      <p className="text-xs font-medium text-gray-600 mb-2">
        Begränsa till dokumenttyp:
        {data && (
          <span className="text-gray-400 font-normal">
            {" "}— räknarna visar träffar för &quot;{searchTerm}&quot; per typ
          </span>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        {facetRows(types, data).map(({ type, count }) => {
          const checked = selectedTypes.includes(type);
          const zeroAfterSearch = data !== undefined && count === 0;
          return (
            <label
              key={type}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs cursor-pointer border ${checked ? "bg-blue-100 border-blue-300 text-blue-900" : zeroAfterSearch ? "bg-gray-50 border-gray-200 text-gray-400" : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100"}`}
            >
              <input type="checkbox" className="sr-only" checked={checked} onChange={() => onToggle(type)} />
              {type} <span className={zeroAfterSearch ? "text-gray-300" : "text-gray-400"}>({count})</span>
            </label>
          );
        })}
        {selectedTypes.length > 0 && (
          <button type="button" onClick={onClear} className="text-xs text-gray-500 hover:text-gray-900 underline ml-1">
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
  );
}

function SearchResults({ searchTerm, data }: { searchTerm: string; data: SearchData }) {
  return (
    <div>
      <p className="text-sm text-gray-500 mb-2">
        {data.totalHits > 0
          ? `${data.totalHits} träff(ar) för "${searchTerm}"`
          : `Inga träffar för "${searchTerm}"`}
      </p>
      {data.hits.length > 0 && (
        <DataTable
          prefKey="list.doc-search"
          columns={searchColumns(openHit)}
          data={data.hits as SearchHit[]}
          rowKey={(h) => h.documentId}
          emptyMessage="Inga träffar."
        />
      )}
    </div>
  );
}

interface SearchFormProps {
  query: string;
  onQueryChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  scope: SearchScope;
  isFetching: boolean;
  docTypes: DocTypeCount[] | undefined;
  resultsData: SearchData | undefined;
  searchTerm: string;
  selectedTypes: string[];
  onToggleType: (type: string) => void;
  onClearTypes: () => void;
}

function SearchForm(p: SearchFormProps) {
  const offline = p.scope === "offline";
  return (
    <form onSubmit={p.onSubmit} className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
      <p className="text-sm text-gray-500 mb-4">
        Sök i innehållet i alla uppladdade dokument (PDF, Word, etc.).
        Texten extraheras automatiskt vid uppladdning.{" "}
        <span className="text-gray-400">
          Använd <code className="font-mono text-xs bg-gray-100 px-1 rounded">*</code> som
          wildcard, t.ex. <code className="font-mono text-xs bg-gray-100 px-1 rounded">stäm*ansökan</code>.
        </span>
      </p>
      <p className={`text-xs mb-4 ${offline ? "text-amber-700" : "text-gray-500"}`}>{searchScopeLabel(p.scope)}</p>
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          required
          value={p.query}
          onChange={(e) => p.onQueryChange(e.target.value)}
          placeholder="Sök i dokument..."
          disabled={offline}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400"
        />
        <button
          type="submit"
          disabled={p.isFetching || offline}
          className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
        >
          {p.isFetching ? "Söker..." : "Sök"}
        </button>
      </div>

      {p.docTypes && p.docTypes.length > 0 && (
        <DocTypeFilter
          types={p.docTypes}
          data={p.resultsData}
          searchTerm={p.searchTerm}
          selectedTypes={p.selectedTypes}
          onToggle={p.onToggleType}
          onClear={p.onClearTypes}
        />
      )}
    </form>
  );
}

export default function DocumentSearchPage() {
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [searchedTypes, setSearchedTypes] = useState<string[]>([]);

  // Kapabilitets-tierat sök-omfång (ADR 0028 §4c): server (online) / lokalt
  // i cachen (demo) / offline-notis (server-first utan nät). Gate:as på
  // kapabilitet + online — aldrig på `if (isDemo)` (ADR 0027).
  const { sync } = useCapabilities();
  const online = useOnlineStatus();
  const scope = searchScope(sync, online);

  const docTypes = trpc.document.listDocumentTypes.useQuery();

  const results = trpc.document.search.useQuery(
    { query: searchTerm, documentTypes: searchedTypes.length > 0 ? searchedTypes : undefined },
    { enabled: searchTerm.length > 0 && scope !== "offline" }
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

      <SearchForm
        query={query}
        onQueryChange={setQuery}
        onSubmit={handleSearch}
        scope={scope}
        isFetching={results.isFetching}
        docTypes={docTypes.data}
        resultsData={results.data as SearchData | undefined}
        searchTerm={searchTerm}
        selectedTypes={selectedTypes}
        onToggleType={toggleType}
        onClearTypes={() => setSelectedTypes([])}
      />

      {searchTerm && results.data && <SearchResults searchTerm={searchTerm} data={results.data as SearchData} />}

      {results.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-800">{results.error.message}</p>
        </div>
      )}
    </div>
  );
}
