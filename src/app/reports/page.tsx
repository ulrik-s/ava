"use client";

import { useId, useState } from "react";
import { EntityLink } from "@/lib/client/demo/entity-link";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "@/lib/client/trpc";
import { formatMinutes, formatCurrency } from "@/lib/client/utils";
import { labelForPaymentMethod, creditRiskFor, CREDIT_RISK_LABELS, type CreditRisk } from "@/lib/client/labels";
import type { AppRouter } from "@/lib/server/routers/_app";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ArSummarySection } from "./_ar-summary";
import { omitUndefined } from "@/lib/shared/omit-undefined";

const RISK_BADGE_CLASSES: Record<CreditRisk, string> = {
  LOW: "bg-green-50 text-green-700 border-green-200",
  MEDIUM: "bg-yellow-50 text-yellow-700 border-yellow-200",
  HIGH: "bg-red-50 text-red-700 border-red-200",
  UNKNOWN: "bg-gray-100 text-gray-600 border-gray-200",
};

function PaymentBadge({ method }: { method: string }) {
  const risk = creditRiskFor(method);
  return (
    <div className="inline-flex flex-col gap-0.5 items-start">
      <span className="text-xs text-gray-700">{labelForPaymentMethod(method)}</span>
      <span className={`text-[10px] rounded-full px-1.5 py-0 border ${RISK_BADGE_CLASSES[risk]}`}>
        Risk: {CREDIT_RISK_LABELS[risk]}
      </span>
    </div>
  );
}

// eslint-disable-next-line complexity, max-lines-per-function -- JSX-tung sid-komponent: filterrad + flera rapport-sektioner (perLawyer + billed #90).
export default function ReportsPage() {
  const now = new Date();
  // split("T") ger alltid minst ett element → [0] är aldrig undefined.
  const firstOfYear = new Date(now.getFullYear(), 0, 1).toISOString().split("T")[0]!;
  const today = now.toISOString().split("T")[0]!;

  const [from, setFrom] = useState(firstOfYear);
  const [to, setTo] = useState(today);
  const [explicitUserId, setExplicitUserId] = useState<string>("");
  const fromId = useId();
  const toId = useId();
  const lawyerId = useId();

  const users = trpc.user.list.useQuery({});

  // Förvald advokat = första i listan (om ingen vald ännu). Derivat istället
  // för effekt + setState så vi undviker kaskaderenderingar.
  const userId = explicitUserId || users.data?.users[0]?.id || "";
  const setUserId = setExplicitUserId;

  const report = trpc.reports.perLawyer.useQuery(
    { from, to, userId },
    { enabled: !!userId },
  );

  async function handleExport() {
    const params = new URLSearchParams({ from, to });
    if (userId) params.set("userIds", userId);
    const res = await fetch(`/api/reports/excel?${params}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tidsrapport_${from}_${to}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-none mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Rapporter</h1>

        {/* Period + advokat */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 sm:items-end">
          <div>
            <label htmlFor={fromId} className="block text-sm text-gray-500 mb-1">Från</label>
            <input
              id={fromId}
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full sm:w-auto rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor={toId} className="block text-sm text-gray-500 mb-1">Till</label>
            <input
              id={toId}
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full sm:w-auto rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex-1">
            <label htmlFor={lawyerId} className="block text-sm text-gray-500 mb-1">Advokat</label>
            <select
              id={lawyerId}
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="w-full sm:w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              {!users.data && <option value="">Laddar...</option>}
              {users.data?.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => void handleExport()}
            disabled={!userId || !report.data}
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Exportera Excel
          </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8">
        <div className="mb-6">
          <ArSummarySection
            from={from}
            to={to}
            userId={userId}
            {...omitUndefined({ lawyerName: users.data?.users.find((u) => u.id === userId)?.name })}
          />
        </div>

        {report.isLoading && (
          <p className="text-sm text-gray-500">Laddar rapport...</p>
        )}

        {report.data && (
          <>
            <SummaryCard report={report.data} />
            <MattersTable report={report.data} />
            <WeeklyTable report={report.data} />
            <UnbilledTable report={report.data} />
          </>
        )}
      </div>
    </div>
  );
}

// ─── Typer ───────────────────────────────────────────────────────────

type Report = NonNullable<inferRouterOutputs<AppRouter>["reports"]["perLawyer"]>;

// ─── Toppkort: sammanfattning ────────────────────────────────────────

function SummaryCard({ report }: { report: Report }) {
  const { totals, user } = report;
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
      <div className="flex flex-wrap gap-6 text-sm">
        <div>
          <div className="text-gray-500 text-xs uppercase">Advokat</div>
          <div className="font-medium text-gray-900">{user.name}</div>
        </div>
        <div>
          <div className="text-gray-500 text-xs uppercase">Totalt tid</div>
          <div className="font-mono font-medium">{formatMinutes(totals.totalMinutes)}</div>
        </div>
        <div>
          <div className="text-gray-500 text-xs uppercase">Debiterbart</div>
          <div className="font-mono font-medium">{formatMinutes(totals.billableMinutes)}</div>
        </div>
        <div>
          <div className="text-gray-500 text-xs uppercase">Arbetsvärde</div>
          <div className="font-mono font-medium">{formatCurrency(totals.workValueOre)}</div>
        </div>
        <div>
          <div className="text-gray-500 text-xs uppercase">Utlägg</div>
          <div className="font-mono font-medium">{formatCurrency(totals.expenseOre)}</div>
        </div>
      </div>
    </div>
  );
}

// ─── 1. Ärenden i perioden ───────────────────────────────────────────

type MatterRow = Report["matters"][number];

const mattersTableColumns: Column<MatterRow>[] = [
  { key: "matter", label: "Ärende", sortable: true, sortValue: (m) => m.matterNumber,
    render: (m) => <EntityLink route="matters" id={m.matterId} className="text-blue-600 hover:underline">{m.matterNumber} — {m.title}</EntityLink> },
  { key: "client", label: "Klient", sortable: true, sortValue: (m) => m.client ?? "",
    render: (m) => <span className="text-gray-600">{m.client ?? "—"}</span> },
  { key: "payment", label: "Betalning", sortable: true, sortValue: (m) => labelForPaymentMethod(m.paymentMethod),
    render: (m) => <PaymentBadge method={m.paymentMethod} /> },
  { key: "totalMinutes", label: "Tid", sortable: true, align: "right", sortValue: (m) => m.totalMinutes,
    summary: (rs) => <span className="font-mono">{formatMinutes(rs.reduce((s, r) => s + r.totalMinutes, 0))}</span>,
    render: (m) => <span className="font-mono">{formatMinutes(m.totalMinutes)}</span> },
  { key: "billableMinutes", label: "Deb. tid", sortable: true, align: "right", sortValue: (m) => m.billableMinutes,
    summary: (rs) => <strong className="font-mono">{formatMinutes(rs.reduce((s, r) => s + r.billableMinutes, 0))}</strong>,
    render: (m) => <strong className="font-mono">{formatMinutes(m.billableMinutes)}</strong> },
  { key: "workValueOre", label: "Arbetsvärde", sortable: true, align: "right", sortValue: (m) => m.workValueOre,
    summary: (rs) => <span className="font-mono">{formatCurrency(rs.reduce((s, r) => s + r.workValueOre, 0))}</span>,
    render: (m) => <span className="font-mono">{formatCurrency(m.workValueOre)}</span> },
  { key: "expenseOre", label: "Utlägg", sortable: true, align: "right", sortValue: (m) => m.expenseOre,
    summary: (rs) => {
      const t = rs.reduce((s, r) => s + r.expenseOre, 0);
      return <span className="font-mono">{t > 0 ? formatCurrency(t) : "—"}</span>;
    },
    render: (m) => <span className="font-mono">{m.expenseOre > 0 ? formatCurrency(m.expenseOre) : "—"}</span> },
];

function MattersTable({ report }: { report: Report }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
      <h2 className="font-semibold text-gray-900 mb-1">Ärenden under perioden</h2>
      <p className="text-sm text-gray-500 mb-4">
        Ärenden där {report.user.name} har registrerat tid eller utlägg.
      </p>

      {report.matters.length === 0 ? (
        <p className="text-sm text-gray-500">Inga ärenden i vald period.</p>
      ) : (
        <DataTable
          prefKey="list.reports-matters"
          columns={mattersTableColumns}
          data={report.matters}
          rowKey={(m) => m.matterId}
          emptyMessage="Inga ärenden i vald period."
        />
      )}
    </div>
  );
}

// ─── 2. Timdebitering per vecka ──────────────────────────────────────

type WeekRow = Report["weeklyRows"][number];

const weeklyColumns: Column<WeekRow>[] = [
  { key: "week", label: "Vecka", sortable: true, sortValue: (r) => `${r.isoYear}-${String(r.week).padStart(2, "0")}`,
    render: (r) => <span className="font-mono">{r.isoYear}-v{String(r.week).padStart(2, "0")}</span> },
  { key: "period", label: "Period", sortable: true, sortValue: (r) => r.start,
    render: (r) => <span className="text-xs text-gray-500 whitespace-nowrap">{r.start.slice(5)} – {r.end.slice(5)}</span> },
  { key: "totalMinutes", label: "Tid", sortable: true, align: "right", sortValue: (r) => r.totalMinutes,
    summary: (rs) => <span className="font-mono">{formatMinutes(rs.reduce((s, r) => s + r.totalMinutes, 0))}</span>,
    render: (r) => <span className="font-mono">{r.totalMinutes > 0 ? formatMinutes(r.totalMinutes) : "—"}</span> },
  { key: "billableMinutes", label: "Deb. tid", sortable: true, align: "right", sortValue: (r) => r.billableMinutes,
    summary: (rs) => <strong className="font-mono">{formatMinutes(rs.reduce((s, r) => s + r.billableMinutes, 0))}</strong>,
    render: (r) => <span className="font-mono">{r.billableMinutes > 0 ? <strong>{formatMinutes(r.billableMinutes)}</strong> : "—"}</span> },
  { key: "workValueOre", label: "Arbetsvärde", sortable: true, align: "right", sortValue: (r) => r.workValueOre,
    summary: (rs) => <span className="font-mono">{formatCurrency(rs.reduce((s, r) => s + r.workValueOre, 0))}</span>,
    render: (r) => <span className="font-mono">{r.workValueOre > 0 ? formatCurrency(r.workValueOre) : "—"}</span> },
];

function WeeklyTable({ report }: { report: Report }) {
  const anyActivity = report.weeklyRows.some((r) => r.totalMinutes > 0);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
      <h2 className="font-semibold text-gray-900 mb-1">Timdebitering per vecka</h2>
      <p className="text-sm text-gray-500 mb-4">
        ISO-veckor som överlappar perioden. Debiterbar tid i fetstil.
      </p>

      {!anyActivity ? (
        <p className="text-sm text-gray-500">Ingen tid registrerad i vald period.</p>
      ) : (
        <DataTable
          prefKey="list.reports-weekly"
          columns={weeklyColumns}
          data={report.weeklyRows}
          rowKey={(r) => `${r.isoYear}-${r.week}`}
          emptyMessage="Inga veckor."
        />
      )}
    </div>
  );
}

// ─── 3. Upparbetat, icke fakturerat ──────────────────────────────────

type UnbilledRow = Report["unbilled"]["rows"][number];

const unbilledColumns: Column<UnbilledRow>[] = [
  { key: "matter", label: "Ärende", sortable: true, sortValue: (r) => r.matterNumber,
    render: (r) => <EntityLink route="matters" id={r.matterId} className="text-blue-600 hover:underline">{r.matterNumber} — {r.title}</EntityLink> },
  { key: "client", label: "Klient", sortable: true, sortValue: (r) => r.client ?? "",
    render: (r) => <span className="text-gray-600">{r.client ?? "—"}</span> },
  { key: "payment", label: "Betalning", sortable: true, sortValue: (r) => labelForPaymentMethod(r.paymentMethod),
    render: (r) => <PaymentBadge method={r.paymentMethod} /> },
  { key: "timeOre", label: "Tid", sortable: true, align: "right", sortValue: (r) => r.timeOre,
    summary: (rs) => <span className="font-mono">{formatCurrency(rs.reduce((s, r) => s + r.timeOre, 0))}</span>,
    render: (r) => <span className="font-mono">{r.timeOre > 0 ? formatCurrency(r.timeOre) : "—"}</span> },
  { key: "expenseOre", label: "Utlägg", sortable: true, align: "right", sortValue: (r) => r.expenseOre,
    summary: (rs) => <span className="font-mono">{formatCurrency(rs.reduce((s, r) => s + r.expenseOre, 0))}</span>,
    render: (r) => <span className="font-mono">{r.expenseOre > 0 ? formatCurrency(r.expenseOre) : "—"}</span> },
  { key: "total", label: "Summa", sortable: true, align: "right", sortValue: (r) => r.total,
    summary: (rs) => <span className="font-mono font-medium">{formatCurrency(rs.reduce((s, r) => s + r.total, 0))}</span>,
    render: (r) => <span className="font-mono font-medium">{formatCurrency(r.total)}</span> },
];

function UnbilledTable({ report }: { report: Report }) {
  const { rows } = report.unbilled;

  // Summera per kreditrisk — visar hur stor andel av ofakturerat arbete
  // som ligger under respektive risknivå.
  const riskTotals: Record<CreditRisk, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, UNKNOWN: 0 };
  for (const r of rows) riskTotals[creditRiskFor(r.paymentMethod)] += r.total;
  const hasHighRisk = riskTotals.HIGH + riskTotals.UNKNOWN > 0;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
      <h2 className="font-semibold text-gray-900 mb-1">Upparbetat, icke fakturerat</h2>
      <p className="text-sm text-gray-500 mb-4">
        Debiterbar tid och utlägg för {report.user.name} inom perioden som
        ännu inte är knutna till en faktura.
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">Inget ofakturerat i vald period.</p>
      ) : (
        <>
          {/* Kreditrisk-sammanfattning */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            {(["LOW", "MEDIUM", "HIGH", "UNKNOWN"] as const).map((risk) => (
              <div
                key={risk}
                className={`rounded-lg border px-3 py-2 ${RISK_BADGE_CLASSES[risk]}`}
              >
                <div className="text-[10px] uppercase font-medium opacity-80">
                  Risk: {CREDIT_RISK_LABELS[risk]}
                </div>
                <div className="font-mono font-semibold text-sm">
                  {formatCurrency(riskTotals[risk])}
                </div>
              </div>
            ))}
          </div>

          {hasHighRisk && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              ⚠ {formatCurrency(riskTotals.HIGH + riskTotals.UNKNOWN)} av det ofakturerade
              arbetet ligger under hög eller okänd kreditrisk. Kontrollera
              betalningssätt på berörda ärenden innan du fakturerar.
            </div>
          )}

          <DataTable
            prefKey="list.reports-unbilled"
            columns={unbilledColumns}
            data={rows}
            rowKey={(r) => r.matterId}
            emptyMessage="Inget ofakturerat."
          />
        </>
      )}
    </div>
  );
}
