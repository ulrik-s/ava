"use client";

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/client/lib/trpc";
import { labelForContactType, labelForMatterRole } from "@/client/lib/labels";

export default function ConflictsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [searchType, setSearchType] = useState<"name" | "personalNumber" | "both">("both");

  const checkConflict = trpc.conflict.check.useMutation();
  const history = trpc.conflict.history.useQuery({ page: 1, pageSize: 10 });

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!searchTerm.trim()) return;
    checkConflict.mutate({ searchTerm: searchTerm.trim(), searchType });
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Jävskontroll</h1>

      <form onSubmit={handleSearch} className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <p className="text-sm text-gray-500 mb-4">
          Sök på personnummer (helt eller del av), organisationsnummer eller namn.
          Resultatet visar alla ärenden där personen förekommer och i vilken roll.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <input type="text" required value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Namn, personnummer eller orgnr..."
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          <div className="flex gap-3">
            <select value={searchType}
              onChange={(e) => setSearchType(e.target.value as typeof searchType)}
              className="flex-1 sm:flex-none rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="both">Namn + nummer</option>
              <option value="name">Bara namn</option>
              <option value="personalNumber">Bara personnr/orgnr</option>
            </select>
            <button type="submit" disabled={checkConflict.isPending}
              className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap">
              {checkConflict.isPending ? "Söker..." : "Sök"}
            </button>
          </div>
        </div>
      </form>

      {/* Results */}
      {checkConflict.data && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">
              Resultat för &quot;{checkConflict.data.searchTerm}&quot;
            </h2>
            <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
              checkConflict.data.matchCount > 0 ? "bg-amber-50 text-amber-700" : "bg-green-50 text-green-700"
            }`}>
              {checkConflict.data.matchCount > 0
                ? `${checkConflict.data.matchCount} träff(ar) — bedöm om jäv föreligger`
                : "Inga träffar"}
            </span>
          </div>

          {checkConflict.data.matchCount > 0 && (
            <div className="-mx-6 overflow-x-auto px-6">
              <table className="min-w-full divide-y divide-gray-200">
                <thead>
                  <tr>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase pb-2 pr-4">Kontakt</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase pb-2 pr-4">Typ</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase pb-2 pr-4">Personnr/Orgnr</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase pb-2 pr-4">Ärende</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase pb-2 pr-4">Roll i ärendet</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase pb-2">Klient</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {checkConflict.data.results.map((r, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="py-2.5 pr-4">
                        <Link href={`/contacts/${r.contactId}`} className="text-sm font-medium text-blue-600 hover:underline">
                          {r.contactName}
                        </Link>
                      </td>
                      <td className="py-2.5 pr-4 text-sm text-gray-500">
                        {labelForContactType(r.contactType)}
                      </td>
                      <td className="py-2.5 pr-4 text-sm text-gray-500">
                        {r.personalNumber || r.orgNumber || "—"}
                      </td>
                      <td className="py-2.5 pr-4">
                        <Link href={`/matters/${r.matterId}`} className="text-sm text-blue-600 hover:underline">
                          {r.matterNumber} — {r.matterTitle}
                        </Link>
                      </td>
                      <td className="py-2.5 pr-4">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          r.role === "KLIENT" ? "bg-blue-50 text-blue-700"
                            : r.role === "MOTPART" ? "bg-orange-50 text-orange-700"
                            : r.role === "MOTPARTSOMBUD" ? "bg-orange-50 text-orange-600"
                            : r.role === "AKLAGARE" ? "bg-purple-50 text-purple-700"
                            : "bg-gray-100 text-gray-600"
                        }`}>
                          {labelForMatterRole(r.role)}
                        </span>
                      </td>
                      <td className="py-2.5 text-sm text-gray-500">{r.klient || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {checkConflict.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 mb-6">
          <p className="text-sm text-red-800">{checkConflict.error.message}</p>
        </div>
      )}

      {/* History */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">Senaste sökningar</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {history.data?.checks.map((check) => {
            const results = check.results as Array<Record<string, unknown>>;
            return (
              <div key={check.id} className="px-6 py-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-900">
                    &quot;{check.searchTerm}&quot;
                    <span className="ml-2 text-xs text-gray-500">({check.searchType})</span>
                  </p>
                  <p className="text-xs text-gray-500">
                    {check.checkedBy.name} · {new Date(check.createdAt).toLocaleString("sv-SE")}
                  </p>
                </div>
                <p className={`text-xs mt-1 ${results.length > 0 ? "text-amber-600" : "text-green-600"}`}>
                  {results.length > 0 ? `${results.length} träff(ar)` : "Ingen träff"}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
