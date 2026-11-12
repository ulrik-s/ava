"use client";

import { FileDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DocumentBrowser } from "@/components/documents/document-browser";
import { PanelPage } from "@/components/layout/panel-page";
import { EventsPanel } from "@/components/matter/events-panel";
import { SuggestionsPanel } from "@/components/matter/suggestions-panel";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { useRouteId } from "@/lib/client/demo/use-route-id";
import { useEagerCacheMatterDocuments } from "@/lib/client/firma/use-eager-cache-matter-documents";
import { trpc } from "@/lib/client/trpc";
import type { MatterRole, MatterStatus, PaymentMethod } from "@/lib/shared/schemas/enums";
import { asId } from "@/lib/shared/schemas/ids";
import { BillingPanel } from "./_billing-panel";
import { ContactsSection } from "./_contacts-section";
import { CourtCaseNumberField } from "./_court-case-number-field";
import { ExpectedReceivablesSection } from "./_expected-receivables-section";
import { ExpenseSection } from "./_expense-section";
import { GenerateModal } from "./_generate-modal";
import { InsuranceReferenceField } from "./_insurance-reference-field";
import { matterDefaultLayout, matterPanels } from "./_matter-panels";
import { MatterPaymentEdit, type PaymentEditMatter } from "./_matter-payment-edit";
import { MatterPaymentLine, type NamedMatterContact } from "./_matter-payment-line";
import { MatterTypeField } from "./_matter-type-field";
import { RattshjalpCapWarning } from "./_rattshjalp-cap-warning";
import { ServiceNotesSection } from "./_service-notes-section";
import { TimeSection } from "./_time-section";
import { WatchSection } from "./_watch-section";

type ReferenceKey = "courtCaseNumber" | "previousCourtCaseNumber" | "insuranceReference";

/** Ärendets referensfält (målnummer, tidigare målnummer, försäkringsreferens)
 *  som sträng (getById-typen saknar fälten i select-typen). */
function referenceOf(m: unknown, key: ReferenceKey = "courtCaseNumber"): string {
  return (m as Partial<Record<ReferenceKey, string | null>>)[key] ?? "";
}

/**
 * Domstolsärende = domstolen betalar dig utan AVA-faktura (offentligt uppdrag
 * eller taxeärende). Styr om Domstolsbetalnings-panelen visas — i andra ärenden
 * är den bara förvirrande.
 */
function isCourtMatter(m: { paymentMethod?: PaymentMethod | null; isTaxeArende?: boolean | null }): boolean {
  return m.paymentMethod === "OFFENTLIGT_UPPDRAG" || m.isTaxeArende === true;
}

export default function MatterDetailClient({ id: paramId }: { id: string }) {
  // Static export serverar en sentinel-shell för nya id:n → läs riktiga
  // id:t ur URL:en (faller tillbaka till build-time-param i server-mode).
  const id = asId<"MatterId">(useRouteId() ?? paramId);
  const matter = trpc.matter.getById.useQuery({ id });
  // Samma query som panelen (react-query delar cachen): redan registrerade
  // fordringar håller panelen kvar även i ett icke-domstolsärende (#1213).
  const receivables = trpc.expectedReceivable.list.useQuery({ matterId: id });
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  // ADR 0028 §4a: öppna ärende → eager-cacha dess dokument-bytes (offline).
  useEagerCacheMatterDocuments(id);

  if (matter.isLoading) return <p className="text-gray-500">Laddar...</p>;
  if (matter.error) return <p className="text-red-600">Fel: {matter.error.message}</p>;
  if (!matter.data) return null;

  const m = matter.data;
  const klient = m.contacts.filter((c: { role: string }) => c.role === "KLIENT");

  const panels = matterPanels({
    time: () => <TimeSection matterId={id} isTaxeArende={m.isTaxeArende} paymentMethod={m.paymentMethod}
      rattshjalpMaxTimmar={m.rattshjalpMaxTimmar} matterStatus={m.status} />,
    expenses: () => <ExpenseSection matterId={id} isTaxeArende={m.isTaxeArende} />,
    billing: () => <BillingPanel matterId={id} matter={m} />,
    receivables: () => <ExpectedReceivablesSection matterId={id} isCourtMatter={isCourtMatter(m)} />,
    watch: () => <WatchSection matterId={id} />,
    contacts: () => <ContactsSection matterId={id} contacts={m.contacts} />,
    documents: () => <DocumentBrowser matterId={id} />,
    events: () => <EventsPanel matterId={id} />,
    suggestions: () => <SuggestionsPanel matterId={id} />,
    notes: () => <ServiceNotesSection matterId={id} />,
  }).filter((p) => p.id !== "receivables" || isCourtMatter(m) || (receivables.data?.length ?? 0) > 0);

  return (
    <>
      <PanelPage
        page="matter"
        panels={panels}
        defaultLayout={matterDefaultLayout}
        header={(
          <>
            <div className="mb-1">
              <Link href="/matters" className="text-xs text-blue-600 hover:underline">&larr; Tillbaka till ärenden</Link>
            </div>
            <MatterHeader matter={m} klient={klient} contacts={m.contacts} onOpenGenerate={() => setShowGenerateModal(true)} />
          </>
        )}
      />
      {showGenerateModal && (
        <GenerateModal matterId={id} contacts={m.contacts} onClose={() => setShowGenerateModal(false)} />
      )}
    </>
  );
}

type MatterContact = {
  id: string;
  role: MatterRole;
  contact: { id: string; name: string };
};

interface HeaderProps {
  matter: PaymentEditMatter & {
    id: string;
    matterNumber: string;
    title: string;
    matterType?: string | null | undefined;
    description?: string | null | undefined;
    status: MatterStatus;
    isTaxeArende?: boolean | undefined;
    clientShareBips?: number | null | undefined;
    /** Takvarningen i huvudet (#1520) — bara rättshjälp. */
    rattshjalpMaxTimmar?: number | null | undefined;
  };
  klient: MatterContact[];
  /** Alla ärendets kontakter — styr om försäkringsreferensen visas (#1511)
   *  och ger försäkringsbolaget i betalningsraden (#1518). */
  contacts: readonly NamedMatterContact[];
  onOpenGenerate: () => void;
}

/** Klient + ärendetyp-raden under titeln. Utbruten ur MatterHeader så dess
 *  optional-chain/&&-grenar inte räknas in i komponentkomplexiteten (#199). */
/** Klient + ärendetyp (fetstil, inline-redigerbar #1521) på raden under titeln. */
function MatterClientLine({ matterId, klient, matterType }: { matterId: string; klient: MatterContact[]; matterType?: string | null | undefined }) {
  return (
    <div className="flex items-center gap-1 text-sm text-gray-500">
      {klient[0]?.contact && (
        <span>Klient: <EntityLink route="contacts" id={klient[0].contact.id} className="text-blue-600 hover:underline">{klient[0].contact.name}</EntityLink> ·</span>
      )}
      <MatterTypeField key={`type-${matterType ?? ""}`} matterId={asId<"MatterId">(matterId)} value={matterType ?? ""} />
    </div>
  );
}

/** Taxa-badge + status-badge + status-/genererings-actions (höger sida av
 *  headern). Utbruten ur MatterHeader (status-ternarierna). */
function MatterHeaderActions({ m, isPending, onClose, onReopen, onGenerate }: {
  m: HeaderProps["matter"]; isPending: boolean;
  onClose: () => void; onReopen: () => void; onGenerate: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {m.isTaxeArende && (
        <span
          className="inline-flex items-center rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
          title="Taxeärende — ersättning enligt Domstolsverkets fastställda taxa (DVFS) istället för löpande timdebitering. Domstolen kan frångå taxan när avsevärt mer arbete än normalt krävts."
        >
          Taxa
        </span>
      )}
      <StatusBadge status={m.status} />
      {m.status === "ACTIVE" ? (
        <button
          onClick={onClose}
          disabled={isPending}
          className="px-3 py-1 text-xs font-medium bg-white border border-gray-300 rounded-full hover:bg-gray-50 text-gray-700 disabled:opacity-50"
        >
          Avsluta ärende
        </button>
      ) : m.status === "CLOSED" ? (
        <button
          onClick={onReopen}
          disabled={isPending}
          className="px-3 py-1 text-xs font-medium bg-white border border-gray-300 rounded-full hover:bg-gray-50 text-gray-700 disabled:opacity-50"
        >
          Återöppna
        </button>
      ) : null}
      <button
        onClick={onGenerate}
        className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-white border border-gray-300 rounded-full hover:bg-gray-50 text-gray-700"
      >
        <FileDown size={13} /> Generera dokument
      </button>
    </div>
  );
}

function MatterHeader({ matter: m, klient, contacts, onOpenGenerate }: HeaderProps) {
  const utils = trpc.useUtils();
  const updateStatus = trpc.matter.update.useMutation({
    onSuccess: () => utils.matter.getById.invalidate({ id: m.id }),
  });

  const onCloseMatter = () => {
    if (!confirm(`Avsluta ärendet "${m.title}"? Det går att återöppna sen.`)) return;
    updateStatus.mutate({ id: m.id, status: "CLOSED" });
  };
  const onReopenMatter = () => {
    updateStatus.mutate({ id: m.id, status: "ACTIVE" });
  };

  return (
    // Kompakt (#1185): panelerna ska få höjden, inte huvudet.
    <div data-testid="matter-header" className="bg-white rounded-lg border border-gray-200 px-4 py-2 mb-2 shrink-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-gray-900 truncate">
            <span className="mr-2 font-mono text-sm font-normal text-gray-500">{m.matterNumber}</span>{m.title}
          </h1>
          <div className="flex flex-wrap items-center">
            <MatterClientLine matterId={m.id} klient={klient} matterType={m.matterType} />
            <MatterPaymentLine paymentMethod={m.paymentMethod} clientShareBips={m.clientShareBips}
              contacts={contacts} separated={klient.length > 0 || Boolean(m.matterType)} />
            <MatterPaymentEdit matterId={asId<"MatterId">(m.id)} matter={m} />
          </div>
        </div>
        <MatterHeaderActions
          m={m}
          isPending={updateStatus.isPending}
          onClose={onCloseMatter}
          onReopen={onReopenMatter}
          onGenerate={onOpenGenerate}
        />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
        <CourtCaseNumberField key={referenceOf(m)} matterId={asId<"MatterId">(m.id)} value={referenceOf(m)}
          previous={referenceOf(m, "previousCourtCaseNumber")} />
        <InsuranceReferenceField key={`ins-${referenceOf(m, "insuranceReference")}`} matterId={asId<"MatterId">(m.id)}
          value={referenceOf(m, "insuranceReference")} contacts={contacts} />
        {m.description && <p className="min-w-0 flex-1 truncate text-sm text-gray-600" title={m.description}>{m.description}</p>}
      </div>
      <RattshjalpCapWarning matterId={asId<"MatterId">(m.id)} paymentMethod={m.paymentMethod}
        rattshjalpMaxTimmar={m.rattshjalpMaxTimmar} layout="compact" />
    </div>
  );
}

function StatusBadge({ status }: { status: MatterStatus }) {
  const cls = status === "ACTIVE"
    ? "bg-green-50 text-green-700"
    : status === "CLOSED"
    ? "bg-gray-100 text-gray-600"
    : "bg-yellow-50 text-yellow-700";
  const label = status === "ACTIVE" ? "Aktivt" : status === "CLOSED" ? "Stängt" : "Arkiverat";
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}
