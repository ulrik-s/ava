"use client";

import { useId, useState } from "react";
import { PanelPage } from "@/components/layout/panel-page";
import { DataTable, type Column } from "@/components/ui/data-table";
import { SECTION_FILL_CLASS } from "@/components/ui/section-tone";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { labelForPaymentMethod, creditRiskFor, CREDIT_RISK_LABELS, type CreditRisk } from "@/lib/client/labels";
import { trpc } from "@/lib/client/trpc";
import { formatCurrency } from "@/lib/client/utils";
import { formatDecimalHours, formatDecimalHoursWithUnit } from "@/lib/shared/kr-format";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import type { PaymentMethod } from "@/lib/shared/schemas/enums";
import { asId, type UserId } from "@/lib/shared/schemas/ids";
import { stockholmDay } from "@/lib/shared/stockholm-time";
import { ArSummarySection } from "./_ar-summary";
import { COLUMN_LABELS as L, exportReportCsv, matterLabel, type Report, SECTION_TITLES, sumOf, weekLabel } from "./_report-csv";
import { reportsLayout } from "./_reports-layout";

const RISK_BADGE_CLASSES: Record<CreditRisk, string> = {
  LOW: "bg-green-50 text-green-700 border-green-200",
  MEDIUM: "bg-yellow-50 text-yellow-700 border-yellow-200",
  HIGH: "bg-red-50 text-red-700 border-red-200",
  UNKNOWN: "bg-gray-100 text-gray-600 border-gray-200",
};

function PaymentBadge({ method }: { method: PaymentMethod }) {
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

type UserList = { users: Array<{ id: UserId; name: string }> } | undefined;

/** Förvald advokat = explicit vald, annars första i listan. Derivat istället
 *  för effekt + setState (undviker kaskaderenderingar). */
function resolveUserId(explicit: UserId, users: UserList): UserId {
  return explicit || users?.users[0]?.id || asId<"UserId">("");
}

/** Namnet på vald advokat (för AR-summary-rubriken). */
function lawyerNameFor(users: UserList, userId: UserId): string | undefined {
  return users?.users.find((u) => u.id === userId)?.name;
}

/**
 * Vad rapportpanelerna visar när rapporten saknas. Fel och en advokat som inte
 * hittas sägs rakt ut — förr visade båda "Välj jurist och period." (#1303).
 */
function reportStatusText(report: { isLoading: boolean; error: { message: string } | null; data: unknown }): string {
  if (report.isLoading) return "Laddar rapport…";
  if (report.error) return `Rapporten kunde inte hämtas: ${report.error.message}`;
  if (report.data === null) return "Advokaten hittades inte.";
  return "Välj jurist och period.";
}

interface FilterBarProps {
  from: string;
  to: string;
  userId: UserId;
  users: UserList;
  canExport: boolean;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  onUser: (v: UserId) => void;
  onExport: () => void;
}

function ReportsFilterBar({ from, to, userId, users, canExport, onFrom, onTo, onUser, onExport }: FilterBarProps) {
  const fromId = useId();
  const toId = useId();
  const lawyerId = useId();
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 sm:items-end">
        <div>
          <label htmlFor={fromId} className="block text-sm text-gray-500 mb-1">Från</label>
          <input id={fromId} type="date" value={from} onChange={(e) => onFrom(e.target.value)}
            className="w-full sm:w-auto rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor={toId} className="block text-sm text-gray-500 mb-1">Till</label>
          <input id={toId} type="date" value={to} onChange={(e) => onTo(e.target.value)}
            className="w-full sm:w-auto rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div className="flex-1">
          <label htmlFor={lawyerId} className="block text-sm text-gray-500 mb-1">Advokat</label>
          <select id={lawyerId} value={userId} onChange={(e) => onUser(asId<"UserId">(e.target.value))}
            className="w-full sm:w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm">
            {!users && <option value="">Laddar...</option>}
            {users?.users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
        <button onClick={onExport} disabled={!canExport} title="Laddar ner rapporten som en CSV-fil som öppnas i Excel"
          className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50">
          Exportera Excel
        </button>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  // Svensk kalenderdag (#1677): årets första dag ur dagens svenska år.
  const today = stockholmDay(new Date());
  const firstOfYear = `${today.slice(0, 4)}-01-01`;

  const [from, setFrom] = useState(firstOfYear);
  const [to, setTo] = useState(today);
  const [explicitUserId, setExplicitUserId] = useState<UserId>(asId<"UserId">(""));

  const users = trpc.user.list.useQuery({});
  const userId = resolveUserId(explicitUserId, users.data);

  const report = trpc.reports.perLawyer.useQuery(
    { from, to, userId },
    { enabled: !!userId },
  );

  const loading = <p className="text-sm text-gray-500">{reportStatusText(report)}</p>;
  const r = report.data;
  const panels = [
    { id: "ar", title: "Kundfordringar", render: () => (
      <ArSummarySection from={from} to={to} userId={userId} {...omitUndefined({ lawyerName: lawyerNameFor(users.data, userId) })} />
    ) },
    { id: "summary", title: "Sammanfattning", render: () => (r ? <SummaryCard report={r} /> : loading) },
    { id: "matters", title: "Ärenden", render: () => (r ? <MattersTable report={r} /> : loading) },
    { id: "weekly", title: "Veckor", render: () => (r ? <WeeklyTable report={r} /> : loading) },
    { id: "unbilled", title: "Ofakturerat", render: () => (r ? <UnbilledTable report={r} /> : loading) },
  ];

  return (
    <PanelPage
      page="reports"
      panels={panels}
      defaultLayout={reportsLayout}
      header={(
        <div className="mb-3">
          <h1 className="text-2xl font-bold text-gray-900 mb-3">Rapporter</h1>
          <ReportsFilterBar
            from={from} to={to} userId={userId} users={users.data}
            canExport={!!userId && !!report.data}
            onFrom={setFrom} onTo={setTo} onUser={setExplicitUserId}
            onExport={() => exportReportCsv(r, from, to)}
          />
        </div>
      )}
    />
  );
}

// ─── Toppkort: sammanfattning ────────────────────────────────────────

function SummaryCard({ report }: { report: Report }) {
  const { totals, user } = report;
  return (
    <div className={`${SECTION_FILL_CLASS} p-2`}>
      <div className="flex flex-wrap gap-6 text-sm">
        <div>
          <div className="text-gray-500 text-xs uppercase">Advokat</div>
          <div className="font-medium text-gray-900">{user.name}</div>
        </div>
        <div>
          <div className="text-gray-500 text-xs uppercase">Totalt tid</div>
          <div className="font-mono font-medium">{formatDecimalHoursWithUnit(totals.totalMinutes)}</div>
        </div>
        <div>
          <div className="text-gray-500 text-xs uppercase">Debiterbart</div>
          <div className="font-mono font-medium">{formatDecimalHoursWithUnit(totals.billableMinutes)}</div>
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
  { key: "matter", label: L.matter, sortable: true, sortValue: (m) => m.matterNumber,
    render: (m) => <EntityLink route="matters" id={m.matterId} className="text-blue-600 hover:underline">{matterLabel(m)}</EntityLink> },
  { key: "client", label: L.client, sortable: true, sortValue: (m) => m.client ?? "",
    render: (m) => <span className="text-gray-600">{m.client ?? "—"}</span> },
  { key: "payment", label: L.payment, sortable: true, sortValue: (m) => labelForPaymentMethod(m.paymentMethod),
    render: (m) => <PaymentBadge method={m.paymentMethod} /> },
  { key: "totalMinutes", label: L.totalMinutes, sortable: true, align: "right", sortValue: (m) => m.totalMinutes,
    summary: (rs) => <span className="font-mono">{formatDecimalHours(sumOf(rs, (r) => r.totalMinutes))}</span>,
    render: (m) => <span className="font-mono">{formatDecimalHours(m.totalMinutes)}</span> },
  { key: "billableMinutes", label: L.billableMinutes, sortable: true, align: "right", sortValue: (m) => m.billableMinutes,
    summary: (rs) => <strong className="font-mono">{formatDecimalHours(sumOf(rs, (r) => r.billableMinutes))}</strong>,
    render: (m) => <strong className="font-mono">{formatDecimalHours(m.billableMinutes)}</strong> },
  { key: "workValueOre", label: L.workValueOre, sortable: true, align: "right", sortValue: (m) => m.workValueOre,
    summary: (rs) => <span className="font-mono">{formatCurrency(sumOf(rs, (r) => r.workValueOre))}</span>,
    render: (m) => <span className="font-mono">{formatCurrency(m.workValueOre)}</span> },
  { key: "expenseOre", label: L.expenseOre, sortable: true, align: "right", sortValue: (m) => m.expenseOre,
    summary: (rs) => {
      const t = sumOf(rs, (r) => r.expenseOre);
      return <span className="font-mono">{t > 0 ? formatCurrency(t) : "—"}</span>;
    },
    render: (m) => <span className="font-mono">{m.expenseOre > 0 ? formatCurrency(m.expenseOre) : "—"}</span> },
];

function MattersTable({ report }: { report: Report }) {
  return (
    <div className={`${SECTION_FILL_CLASS} p-2`}>
      <h2 className="font-semibold text-gray-900 mb-1">{SECTION_TITLES.matters}</h2>
      <p className="text-sm text-gray-500 mb-2">
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
  { key: "week", label: L.week, sortable: true, sortValue: (r) => `${r.isoYear}-${String(r.week).padStart(2, "0")}`,
    render: (r) => <span className="font-mono">{weekLabel(r)}</span> },
  { key: "period", label: L.period, sortable: true, sortValue: (r) => r.start,
    render: (r) => <span className="text-xs text-gray-500 whitespace-nowrap">{r.start.slice(5)} – {r.end.slice(5)}</span> },
  { key: "totalMinutes", label: L.totalMinutes, sortable: true, align: "right", sortValue: (r) => r.totalMinutes,
    summary: (rs) => <span className="font-mono">{formatDecimalHours(sumOf(rs, (r) => r.totalMinutes))}</span>,
    render: (r) => <span className="font-mono">{r.totalMinutes > 0 ? formatDecimalHours(r.totalMinutes) : "—"}</span> },
  { key: "billableMinutes", label: L.billableMinutes, sortable: true, align: "right", sortValue: (r) => r.billableMinutes,
    summary: (rs) => <strong className="font-mono">{formatDecimalHours(sumOf(rs, (r) => r.billableMinutes))}</strong>,
    render: (r) => <span className="font-mono">{r.billableMinutes > 0 ? <strong>{formatDecimalHours(r.billableMinutes)}</strong> : "—"}</span> },
  { key: "workValueOre", label: L.workValueOre, sortable: true, align: "right", sortValue: (r) => r.workValueOre,
    summary: (rs) => <span className="font-mono">{formatCurrency(sumOf(rs, (r) => r.workValueOre))}</span>,
    render: (r) => <span className="font-mono">{r.workValueOre > 0 ? formatCurrency(r.workValueOre) : "—"}</span> },
];

function WeeklyTable({ report }: { report: Report }) {
  const anyActivity = report.weeklyRows.some((r) => r.totalMinutes > 0);

  return (
    <div className={`${SECTION_FILL_CLASS} p-2`}>
      <h2 className="font-semibold text-gray-900 mb-1">{SECTION_TITLES.weekly}</h2>
      <p className="text-sm text-gray-500 mb-2">
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
  { key: "matter", label: L.matter, sortable: true, sortValue: (r) => r.matterNumber,
    render: (r) => <EntityLink route="matters" id={r.matterId} className="text-blue-600 hover:underline">{matterLabel(r)}</EntityLink> },
  { key: "client", label: L.client, sortable: true, sortValue: (r) => r.client ?? "",
    render: (r) => <span className="text-gray-600">{r.client ?? "—"}</span> },
  { key: "payment", label: L.payment, sortable: true, sortValue: (r) => labelForPaymentMethod(r.paymentMethod),
    render: (r) => <PaymentBadge method={r.paymentMethod} /> },
  { key: "timeOre", label: L.timeOre, sortable: true, align: "right", sortValue: (r) => r.timeOre,
    summary: (rs) => <span className="font-mono">{formatCurrency(sumOf(rs, (r) => r.timeOre))}</span>,
    render: (r) => <span className="font-mono">{r.timeOre > 0 ? formatCurrency(r.timeOre) : "—"}</span> },
  { key: "expenseOre", label: L.expenseOre, sortable: true, align: "right", sortValue: (r) => r.expenseOre,
    summary: (rs) => <span className="font-mono">{formatCurrency(sumOf(rs, (r) => r.expenseOre))}</span>,
    render: (r) => <span className="font-mono">{r.expenseOre > 0 ? formatCurrency(r.expenseOre) : "—"}</span> },
  { key: "total", label: L.total, sortable: true, align: "right", sortValue: (r) => r.total,
    summary: (rs) => <span className="font-mono font-medium">{formatCurrency(sumOf(rs, (r) => r.total))}</span>,
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
    <div className={`${SECTION_FILL_CLASS} p-2`}>
      <h2 className="font-semibold text-gray-900 mb-1">{SECTION_TITLES.unbilled}</h2>
      <p className="text-sm text-gray-500 mb-2">
        Debiterbar tid och utlägg för {report.user.name} inom perioden som
        ännu inte är knutna till en faktura.
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">Inget ofakturerat i vald period.</p>
      ) : (
        <>
          {/* Kreditrisk-sammanfattning */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
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
            <div className="mb-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
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
