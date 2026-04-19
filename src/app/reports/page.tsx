"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatMinutes, formatCurrency } from "@/lib/utils";

export default function ReportsPage() {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
  const today = now.toISOString().split("T")[0];

  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  const users = trpc.user.list.useQuery({});
  const report = trpc.timeEntry.report.useQuery({
    from,
    to,
    userIds: selectedUserIds.length > 0 ? selectedUserIds : undefined,
  });

  const [exporting, setExporting] = useState(false);

  function toggleUser(userId: string) {
    setSelectedUserIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    );
  }

  function selectAllUsers() {
    if (!users.data) return;
    if (selectedUserIds.length === users.data.users.length) {
      setSelectedUserIds([]);
    } else {
      setSelectedUserIds(users.data.users.map((u) => u.id));
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const params = new URLSearchParams({ from, to });
      if (selectedUserIds.length > 0) {
        params.set("userIds", selectedUserIds.join(","));
      }
      const res = await fetch(`/api/reports/excel?${params}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tidsrapport_${from}_${to}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Rapporter</h1>

      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="font-semibold text-gray-900 mb-4">Tidsrapport per advokat</h2>

        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-4 sm:items-end">
          <div>
            <label className="block text-sm text-gray-500 mb-1">Från</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="w-full sm:w-auto rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">Till</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="w-full sm:w-auto rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <button onClick={handleExport} disabled={exporting || !report.data}
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50">
            {exporting ? "Exporterar..." : "Exportera Excel"}
          </button>
        </div>

        {/* User filter */}
        {users.data && users.data.users.length > 1 && (
          <div className="mb-4">
            <label className="block text-sm text-gray-500 mb-2">Filtrera på användare</label>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={selectAllUsers}
                className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                  selectedUserIds.length === 0
                    ? "bg-blue-100 text-blue-700 border-blue-200"
                    : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                }`}
              >
                Alla
              </button>
              {users.data.users.map((user) => (
                <button
                  key={user.id}
                  onClick={() => toggleUser(user.id)}
                  className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                    selectedUserIds.includes(user.id)
                      ? "bg-blue-100 text-blue-700 border-blue-200"
                      : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {user.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {report.isLoading && <p className="text-sm text-gray-500">Laddar rapport...</p>}

        {report.data && (
          <div className="space-y-6">
            {Object.entries(report.data.byUser).map(([userId, data]) => (
              <div key={userId} className="border border-gray-200 rounded-lg">
                <div className="px-4 py-3 bg-gray-50 rounded-t-lg flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <h3 className="font-medium text-gray-900">{data.name}</h3>
                  <div className="flex gap-4 text-sm">
                    <span className="text-gray-600">Totalt: <strong>{formatMinutes(data.totalMinutes)}</strong></span>
                    <span className="text-gray-600">Debiterbart: <strong>{formatMinutes(data.billableMinutes)}</strong></span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead>
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Datum</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Ärende</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Klient</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Tid</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Beskrivning</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.entries.map((entry) => (
                        <tr key={entry.id}>
                          <td className="px-4 py-2 text-sm text-gray-500">{new Date(entry.date).toLocaleDateString("sv-SE")}</td>
                          <td className="px-4 py-2 text-sm text-gray-900">{entry.matter.matterNumber}</td>
                          <td className="px-4 py-2 text-sm text-gray-500">{entry.matter.contacts[0]?.contact.name ?? "—"}</td>
                          <td className="px-4 py-2 text-sm font-mono">{formatMinutes(entry.minutes)}</td>
                          <td className="px-4 py-2 text-sm text-gray-700">{entry.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

            {Object.keys(report.data.byUser).length === 0 && (
              <p className="text-sm text-gray-500">Ingen tid registrerad i vald period.</p>
            )}
          </div>
        )}
      </div>

      <WeeklyByUserReport />
      <WorkInProgressReport />
    </div>
  );
}

// ─── Weekly hours per lawyer ─────────────────────────────────────────

function WeeklyByUserReport() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const data = trpc.reports.weeklyByUser.useQuery({ year });

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
        <div>
          <h2 className="font-semibold text-gray-900">Timdebitering per vecka och advokat</h2>
          <p className="text-sm text-gray-500 mt-1">
            ISO-veckor. Debiterbar tid visas i fetstil.
          </p>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">År</label>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            {Array.from({ length: 6 }, (_, i) => currentYear - i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {data.isLoading && <p className="text-sm text-gray-500">Laddar...</p>}
      {data.data && data.data.users.length === 0 && (
        <p className="text-sm text-gray-500">Ingen tid registrerad under {year}.</p>
      )}

      {data.data && data.data.users.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">V</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Period</th>
                {data.data.users.map((u) => (
                  <th key={u.id} className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                    {u.name}
                  </th>
                ))}
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-700 uppercase whitespace-nowrap">Totalt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.data.weeks.map((w) => (
                <tr key={w.week} className={w.rowTotal > 0 ? "" : "text-gray-300"}>
                  <td className="px-3 py-1.5 text-sm font-mono">{w.week}</td>
                  <td className="px-3 py-1.5 text-xs text-gray-500 whitespace-nowrap">
                    {w.start.slice(5)} – {w.end.slice(5)}
                  </td>
                  {w.cells.map((c, i) => (
                    <td key={data.data!.users[i].id} className="px-3 py-1.5 text-right font-mono">
                      {c.total > 0 ? (
                        <>
                          <span className="text-gray-400">{formatMinutes(c.total - c.billable)}</span>
                          {c.billable > 0 && c.total !== c.billable && " / "}
                          {c.billable > 0 && <strong>{formatMinutes(c.billable)}</strong>}
                          {c.total === c.billable && c.total > 0 && <strong>{formatMinutes(c.billable)}</strong>}
                        </>
                      ) : "—"}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right font-mono font-medium">
                    {w.rowTotal > 0 ? formatMinutes(w.rowTotal) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-gray-300 bg-gray-50">
              <tr>
                <td colSpan={2} className="px-3 py-2 text-xs font-medium text-gray-700 uppercase">
                  Totalt året
                </td>
                {data.data.userTotals.map((t, i) => (
                  <td key={data.data!.users[i].id} className="px-3 py-2 text-right font-mono">
                    <strong>{formatMinutes(t.billable)}</strong>
                    {t.total !== t.billable && (
                      <span className="text-gray-400"> / {formatMinutes(t.total)}</span>
                    )}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-mono font-semibold">
                  {formatMinutes(data.data.grandBillable)}
                  {data.data.grandTotal !== data.data.grandBillable && (
                    <span className="text-gray-400 font-normal"> / {formatMinutes(data.data.grandTotal)}</span>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Work-in-progress (upparbetat, icke fakturerat) ──────────────────

function WorkInProgressReport() {
  const data = trpc.reports.workInProgressYearly.useQuery();

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
      <h2 className="font-semibold text-gray-900">Upparbetat, icke fakturerat</h2>
      <p className="text-sm text-gray-500 mt-1 mb-4">
        Per år: debiterbar tid och utlägg, minus fakturerat, minus kundförluster.
        Sista kolumnen visar ackumulerad WIP till och med året.
      </p>

      {data.isLoading && <p className="text-sm text-gray-500">Laddar...</p>}
      {data.data && (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">År</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Upparbetat</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Fakturerat</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Kundförlust</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-700 uppercase">Årets WIP</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-700 uppercase">Ack. WIP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.data.rows.map((r) => (
                <tr key={r.year}>
                  <td className="px-4 py-2 font-mono">{r.year}</td>
                  <td className="px-4 py-2 text-right font-mono">{formatCurrency(r.upparbetat)}</td>
                  <td className="px-4 py-2 text-right font-mono">{formatCurrency(r.fakturerat)}</td>
                  <td className="px-4 py-2 text-right font-mono text-red-600">
                    {r.kundforlust > 0 ? formatCurrency(r.kundforlust) : "—"}
                  </td>
                  <td className={`px-4 py-2 text-right font-mono ${r.yearWip < 0 ? "text-gray-500" : ""}`}>
                    {formatCurrency(r.yearWip)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono font-medium">
                    {formatCurrency(r.cumulativeWip)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-gray-300 bg-gray-50">
              <tr>
                <td className="px-4 py-2 text-xs font-medium text-gray-700 uppercase">Totalt</td>
                <td className="px-4 py-2 text-right font-mono font-semibold">{formatCurrency(data.data.totals.upparbetat)}</td>
                <td className="px-4 py-2 text-right font-mono font-semibold">{formatCurrency(data.data.totals.fakturerat)}</td>
                <td className="px-4 py-2 text-right font-mono font-semibold text-red-600">
                  {data.data.totals.kundforlust > 0 ? formatCurrency(data.data.totals.kundforlust) : "—"}
                </td>
                <td className="px-4 py-2 text-right font-mono font-semibold" colSpan={2}>
                  {formatCurrency(data.data.totals.wip)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
