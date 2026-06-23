"use client";

import { useState } from "react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { labelForContactType, labelForMatterRole } from "@/lib/client/labels";
import { trpc } from "@/lib/client/trpc";
import type { ContactType, MatterRole } from "@/lib/shared/schemas/enums";
import type { ContactId, MatterId } from "@/lib/shared/schemas/ids";

interface ConflictRow {
  contactId: ContactId;
  contactName: string;
  contactType: ContactType;
  personalNumber?: string | null;
  orgNumber?: string | null;
  matterId: MatterId;
  matterNumber: string;
  matterTitle: string;
  role: MatterRole;
  klient?: string | null;
}

function rolePillClass(role: MatterRole): string {
  if (role === "KLIENT") return "bg-blue-50 text-blue-700";
  if (role === "MOTPART") return "bg-orange-50 text-orange-700";
  if (role === "MOTPARTSOMBUD") return "bg-orange-50 text-orange-600";
  if (role === "AKLAGARE") return "bg-purple-50 text-purple-700";
  return "bg-gray-100 text-gray-600";
}

const conflictColumns: Column<ConflictRow>[] = [
  { key: "contactName", label: "Kontakt", sortable: true, sortValue: (r) => r.contactName,
    render: (r) => (
      <EntityLink route="contacts" id={r.contactId} className="text-sm font-medium text-blue-600 hover:underline">
        {r.contactName}
      </EntityLink>
    ),
  },
  { key: "contactType", label: "Typ", sortable: true, sortValue: (r) => labelForContactType(r.contactType),
    render: (r) => <span className="text-sm text-gray-500">{labelForContactType(r.contactType)}</span> },
  { key: "number", label: "Personnr/Orgnr", sortable: true,
    sortValue: (r) => r.personalNumber || r.orgNumber || "",
    render: (r) => <span className="text-sm text-gray-500">{r.personalNumber || r.orgNumber || "—"}</span> },
  { key: "matter", label: "Ärende", sortable: true, sortValue: (r) => r.matterNumber,
    render: (r) => (
      <EntityLink route="matters" id={r.matterId} className="text-sm text-blue-600 hover:underline">
        {r.matterNumber} — {r.matterTitle}
      </EntityLink>
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

    </div>
  );
}
