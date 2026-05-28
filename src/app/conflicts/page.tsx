"use client";

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/client/trpc";
import { labelForContactType, labelForMatterRole } from "@/lib/client/labels";
import { DataTable, type Column } from "@/components/ui/data-table";

interface ConflictRow {
  contactId: string;
  contactName: string;
  contactType: string;
  personalNumber?: string | null;
  orgNumber?: string | null;
  matterId: string;
  matterNumber: string;
  matterTitle: string;
  role: string;
  klient?: string | null;
}

function rolePillClass(role: string): string {
  if (role === "KLIENT") return "bg-blue-50 text-blue-700";
  if (role === "MOTPART") return "bg-orange-50 text-orange-700";
  if (role === "MOTPARTSOMBUD") return "bg-orange-50 text-orange-600";
  if (role === "AKLAGARE") return "bg-purple-50 text-purple-700";
  return "bg-gray-100 text-gray-600";
}

const conflictColumns: Column<ConflictRow>[] = [
  { key: "contactName", label: "Kontakt", sortable: true, sortValue: (r) => r.contactName,
    render: (r) => (
      <Link href={`/contacts/${r.contactId}`} className="text-sm font-medium text-blue-600 hover:underline">
        {r.contactName}
      </Link>
    ),
  },
  { key: "contactType", label: "Typ", sortable: true, sortValue: (r) => labelForContactType(r.contactType),
    render: (r) => <span className="text-sm text-gray-500">{labelForContactType(r.contactType)}</span> },
  { key: "number", label: "Personnr/Orgnr", sortable: true,
    sortValue: (r) => r.personalNumber || r.orgNumber || "",
    render: (r) => <span className="text-sm text-gray-500">{r.personalNumber || r.orgNumber || "—"}</span> },
  { key: "matter", label: "Ärende", sortable: true, sortValue: (r) => r.matterNumber,
    render: (r) => (
      <Link href={`/matters/${r.matterId}`} className="text-sm text-blue-600 hover:underline">
        {r.matterNumber} — {r.matterTitle}
      </Link>
    ),
  },
  { key: "role", label: "Roll i ärendet", sortable: true, sortValue: (r) => labelForMatterRole(r.role),
    render: (r) => (
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${rolePillClass(r.role)}`}>
        {labelForMatterRole(r.role)}
      </span>
    ),
  },
  { key: "klient", label: "Klient", sortable: true, sortValue: (r) => r.klient ?? "",
    render: (r) => <span className="text-sm text-gray-500">{r.klient || "—"}</span> },
];

 
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
            <DataTable
              prefKey="list.conflicts"
              columns={conflictColumns}
              data={checkConflict.data.results as ConflictRow[]}
              rowKey={(r) => `${r.contactId}-${r.matterId}-${r.role}`}
              emptyMessage="Inga träffar."
            />
          )}
        </div>
      )}

      {checkConflict.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 mb-6">
          <p className="text-sm text-red-800">{checkConflict.error.message}</p>
        </div>
      )}

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
                    {check.checkedBy?.name ?? "—"} · {new Date(check.createdAt).toLocaleString("sv-SE")}
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
