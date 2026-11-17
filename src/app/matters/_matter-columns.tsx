/**
 * Ärendelistans kolumner (utbrutna ur `page.tsx`, filstorleksspärren), och
 * kolumnen "Träff" som visas efter en sammanslagen sökning (#1642).
 */

import type { Column } from "@/components/ui/data-table";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { coverageStatus } from "@/lib/shared/coverage-cap";
import type { MatterStatus, PaymentMethod } from "@/lib/shared/schemas/enums";

/** En rad i ärendelistan (`matter.list`); `hits` = texterna för "Träff" (#1642). */
export interface MatterRow {
  id: string;
  matterNumber: string;
  title: string;
  matterType?: string | null | undefined;
  status: MatterStatus;
  isTaxeArende?: boolean | undefined;
  paymentMethod?: PaymentMethod | null | undefined;
  rattsskyddMaxOre?: number | null | undefined;
  rattshjalpMaxTimmar?: number | null | undefined;
  coverageUsage?: { billableMinutes: number; billableValueOre: number } | undefined;
  courtCaseNumber?: string | null | undefined;
  previousCourtCaseNumber?: string | null | undefined;
  insuranceReference?: string | null | undefined;
  contacts: Array<{ contact: { name: string } }>;
  _count: { contacts: number };
  hits?: string[] | undefined;
}

/** Takstatus för ett listrad-ärende (rättshjälp/-skydd), eller null (#793). */
function rowCoverage(m: MatterRow) {
  return coverageStatus({
    method: m.paymentMethod,
    rattsskyddMaxOre: m.rattsskyddMaxOre ?? null,
    rattshjalpMaxTimmar: m.rattshjalpMaxTimmar ?? null,
    billableMinutes: m.coverageUsage?.billableMinutes ?? 0,
    billableValueOre: m.coverageUsage?.billableValueOre ?? 0,
  });
}

/** Filtrerbar/grupperbar etikett för täcknings-kolumnen. */
function coverageLabel(m: MatterRow): string {
  const s = rowCoverage(m);
  if (!s) return "—";
  if (s.overCap) return "Över tak";
  if (s.nearCap) return "Närmar sig tak";
  return "Inom tak";
}

/** Badge för täcknings-kolumnen: färgad procent + ⚠ när varningsgränsen nåtts. */
function CoverageCell({ m }: { m: MatterRow }) {
  const s = rowCoverage(m);
  if (!s) return <span className="text-sm text-gray-400">—</span>;
  const pct = Math.round(s.ratio * 100);
  const cls = s.overCap
    ? "bg-red-50 text-red-700 border-red-200"
    : s.nearCap
    ? "bg-amber-50 text-amber-800 border-amber-200"
    : "bg-gray-50 text-gray-600 border-gray-200";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs border ${cls}`} title={coverageLabel(m)}>
      {s.nearCap ? "⚠ " : ""}{pct} %
    </span>
  );
}

/** Ärendetypen som text — "—" när ärendet saknar typ. */
function matterTypeLabel(m: MatterRow): string {
  return m.matterType || "—";
}

function statusLabel(s: string): string {
  return s === "ACTIVE" ? "Aktivt" : s === "CLOSED" ? "Stängt" : "Arkiverat";
}

/**
 * Sorteringsnyckel för ärendenummer (#174). Format `<PREFIX?><YYYY>-<NNNN>`
 * → `${prefix}${year}${seq}` så prefixade och oprefixade nummer sorteras
 * stabilt (prefix-grupp, sedan år, sedan löpnummer). Okänt format faller
 * tillbaka på råsträngen.
 */
function matterNumberSortKey(matterNumber: string): string {
  const m = /^([A-ZÅÄÖ]{1,3})?(\d{4})-(\d{4})$/.exec(matterNumber);
  return m ? `${m[1] ?? ""}${m[2] ?? ""}${m[3] ?? ""}` : matterNumber;
}

/** Ärendelistans kolumner, som före sökning. */
export const matterColumns: Column<MatterRow>[] = [
  { key: "matterNumber", label: "Ärendenr", sortable: true, sortValue: (m) => matterNumberSortKey(m.matterNumber),
    render: (m) => <span className="text-sm font-mono text-gray-500">{m.matterNumber}</span> },
  { key: "title", label: "Titel", sortable: true, sortValue: (m) => m.title,
    render: (m) => (
      <span>
        <EntityLink route="matters" id={m.id} className="text-sm font-medium text-blue-600 hover:underline">{m.title}</EntityLink>
        {m.isTaxeArende && (
          <span
            className="ml-2 inline-flex items-center rounded-full bg-indigo-50 text-indigo-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            title="Taxeärende — ersättning enligt Domstolsverkets fastställda taxa">Taxa</span>
        )}
      </span>
    ),
  },
  // Byråns ärendetyp (organizations.matter_types); filtrera/gruppera på den.
  { key: "matterType", label: "Ärendetyp", sortable: true, filterable: true, groupable: true,
    sortValue: matterTypeLabel, filterValue: matterTypeLabel, groupValue: matterTypeLabel,
    render: (m) => <span className="text-sm text-gray-500">{matterTypeLabel(m)}</span> },
  { key: "klient", label: "Klient", sortable: true, sortValue: (m) => m.contacts[0]?.contact.name ?? "",
    render: (m) => <span className="text-sm text-gray-500">{m.contacts[0]?.contact.name || "—"}</span> },
  { key: "status", label: "Status", sortable: true, sortValue: (m) => statusLabel(m.status),
    render: (m) => (
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        m.status === "ACTIVE" ? "bg-green-50 text-green-700"
          : m.status === "CLOSED" ? "bg-gray-100 text-gray-600"
          : "bg-yellow-50 text-yellow-700"
      }`}>{statusLabel(m.status)}</span>
    ),
  },
  { key: "contactCount", label: "Kontakter", sortable: true, align: "right", sortValue: (m) => m._count.contacts,
    render: (m) => <span className="text-sm text-gray-500">{m._count.contacts}</span> },
  { key: "coverage", label: "Täckning (tak)", sortable: true, filterable: true, groupable: true,
    // Sortera ej-tillämpliga sist (negativ kvot); filtrera/gruppera på etiketten.
    sortValue: (m) => { const s = rowCoverage(m); return s ? s.ratio : -1; },
    filterValue: coverageLabel, groupValue: coverageLabel,
    render: (m) => <CoverageCell m={m} /> },
];


/** "Träff" (#1642): varför ärendet kom med i sökningen — en rad per träff. */
const hitColumn: Column<MatterRow> = {
  key: "hits", label: "Träff", sortable: true, sortValue: (m) => m.hits?.join(", ") ?? "",
  render: (m) => (m.hits && m.hits.length > 0
    ? <ul className="text-sm text-gray-700">{m.hits.map((h) => <li key={h}>{h}</li>)}</ul>
    : <span className="text-sm text-gray-400">—</span>),
};

/** Kolumnerna efter en sökning: "Träff" direkt efter titeln. */
export const matterColumnsWithHits: Column<MatterRow>[] = matterColumns.flatMap((c) => (c.key === "title" ? [c, hitColumn] : [c]));
