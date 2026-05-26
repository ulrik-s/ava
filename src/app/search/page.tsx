"use client";

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/client/trpc";

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
    doc: { id: hit.documentId, storagePath: hit.storagePath, fileName: hit.fileName },
    isDemo,
    demoRepo: process.env.NEXT_PUBLIC_DEFAULT_DEMO_REPO,
    loadHandle: () => loadHandle("repo-root"),
    readFromHandle: readFromFsa,
    openUrl: (u) => window.open(u, "_blank", "noopener,noreferrer"),
    notifyError: (m) => alert(m),
  });
}

export default function DocumentSearchPage() {
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const results = trpc.document.search.useQuery(
    { query: searchTerm },
    { enabled: searchTerm.length > 0 }
  );

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearchTerm(query.trim());
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
      </form>

      {searchTerm && results.data && (
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <p className="text-sm text-gray-500">
              {results.data.totalHits > 0
                ? `${results.data.totalHits} träff(ar) för "${searchTerm}"`
                : `Inga träffar för "${searchTerm}"`}
            </p>
          </div>

          {results.data.hits.length > 0 && (
            <div className="divide-y divide-gray-100">
              {results.data.hits.map((hit) => (
                <div key={hit.documentId} className="px-6 py-4 hover:bg-gray-50">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <button
                        type="button"
                        onClick={() => void openHit(hit)}
                        className="text-sm font-medium text-blue-600 hover:underline text-left"
                      >
                        {hit.fileName}
                      </button>
                      <p className="text-xs text-gray-500 mt-1">
                        Ärende:{" "}
                        <Link
                          href={`/matters/${hit.matterId}`}
                          className="text-blue-600 hover:underline"
                        >
                          {hit.matterNumber} — {hit.matterTitle}
                        </Link>
                      </p>
                    </div>
                  </div>
                  {hit.highlight && (
                    <p
                      className="text-sm text-gray-600 mt-2 line-clamp-2"
                      dangerouslySetInnerHTML={{ __html: hit.highlight }}
                    />
                  )}
                </div>
              ))}
            </div>
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
