"use client";

import { FileDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DocumentBrowser } from "@/components/documents/document-browser";
import { CoverageCapWarning } from "@/components/matter/coverage-cap-warning";
import { EventsPanel } from "@/components/matter/events-panel";
import { PaymentMethodCard } from "@/components/matter/payment-method-card";
import { SuggestionsPanel } from "@/components/matter/suggestions-panel";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { useRouteId } from "@/lib/client/demo/use-route-id";
import { useEagerCacheMatterDocuments } from "@/lib/client/firma/use-eager-cache-matter-documents";
import { trpc } from "@/lib/client/trpc";
import type { MatterRole, MatterStatus, PaymentMethod } from "@/lib/shared/schemas/enums";
import { asId } from "@/lib/shared/schemas/ids";
import { BillingPanel } from "./_billing-panel";
import { ContactsSection } from "./_contacts-section";
import { ExpectedReceivablesSection } from "./_expected-receivables-section";
import { ExpenseSection } from "./_expense-section";
import { GenerateModal } from "./_generate-modal";
import { ServiceNotesSection } from "./_service-notes-section";
import { TimeSection } from "./_time-section";

 
/** Ärendets målnummer som sträng (getById-typen saknar fältet i select-typen). */
function courtCaseOf(m: unknown): string {
  return (m as { courtCaseNumber?: string | null }).courtCaseNumber ?? "";
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
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  // ADR 0028 §4a: öppna ärende → eager-cacha dess dokument-bytes (offline).
  useEagerCacheMatterDocuments(id);

  if (matter.isLoading) return <p className="text-gray-500">Laddar...</p>;
  if (matter.error) return <p className="text-red-600">Fel: {matter.error.message}</p>;
  if (!matter.data) return null;

  const m = matter.data;
  const klient = m.contacts.filter((c: { role: string }) => c.role === "KLIENT");

  return (
    <div>
      <div className="mb-6">
        <Link href="/matters" className="text-sm text-blue-600 hover:underline">&larr; Tillbaka till ärenden</Link>
      </div>

      <MatterHeader
        matter={m}
        klient={klient}
        onOpenGenerate={() => setShowGenerateModal(true)}
      />

      <div className="mb-6">
        <MatterPaymentMethod matterId={id} matter={m} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <EventsPanel matterId={id} />
        <SuggestionsPanel matterId={id} />
        <ContactsSection matterId={id} contacts={m.contacts} />
        <DocumentBrowser matterId={id} />
        <BillingPanel matterId={id} matter={m} />
        <ExpectedReceivablesSection matterId={id} courtCaseNumber={courtCaseOf(m)} isCourtMatter={isCourtMatter(m)} />
        <TimeSection matterId={id} isTaxeArende={m.isTaxeArende} />
        <ExpenseSection matterId={id} isTaxeArende={m.isTaxeArende} />
        <ServiceNotesSection matterId={id} />
      </div>

      {showGenerateModal && (
        <GenerateModal
          matterId={id}
          contacts={m.contacts}
          onClose={() => setShowGenerateModal(false)}
        />
      )}
    </div>
  );
}

/** Adapter: samlar nullish-coalescing för betalkortet så MatterDetailClient
 *  håller sig under komplexitetsgränsen (#199). */
function MatterPaymentMethod({ matterId, matter }: {
  matterId: ReturnType<typeof asId<"MatterId">>;
  matter: {
    paymentMethod: PaymentMethod;
    paymentMethodNote?: string | null | undefined;
    paymentMethodDecidedAt?: Date | string | null | undefined;
    clientShareBips?: number | null | undefined;
    rattsskyddMaxOre?: number | null | undefined;
    rattshjalpMaxTimmar?: number | null | undefined;
    tvistUppkomDatum?: Date | string | null | undefined;
    rattsskyddBeslutDatum?: Date | string | null | undefined;
  };
}) {
  const rattsskyddMaxOre = matter.rattsskyddMaxOre ?? null;
  const rattshjalpMaxTimmar = matter.rattshjalpMaxTimmar ?? null;
  return (
    <>
      <CoverageCapWarning
        matterId={matterId}
        paymentMethod={matter.paymentMethod}
        rattsskyddMaxOre={rattsskyddMaxOre}
        rattshjalpMaxTimmar={rattshjalpMaxTimmar}
      />
      <PaymentMethodCard
        matterId={matterId}
        paymentMethod={matter.paymentMethod}
        paymentMethodNote={matter.paymentMethodNote ?? null}
        paymentMethodDecidedAt={matter.paymentMethodDecidedAt ?? null}
        clientShareBips={matter.clientShareBips ?? null}
        rattsskyddMaxOre={rattsskyddMaxOre}
        rattshjalpMaxTimmar={rattshjalpMaxTimmar}
        tvistUppkomDatum={matter.tvistUppkomDatum ?? null}
        rattsskyddBeslutDatum={matter.rattsskyddBeslutDatum ?? null}
      />
    </>
  );
}

type MatterContact = {
  id: string;
  role: MatterRole;
  contact: { id: string; name: string };
};

interface HeaderProps {
  matter: {
    id: string;
    matterNumber: string;
    title: string;
    matterType?: string | null | undefined;
    description?: string | null | undefined;
    status: MatterStatus;
    isTaxeArende?: boolean | undefined;
  };
  klient: MatterContact[];
  onOpenGenerate: () => void;
}

/** Klient + ärendetyp-raden under titeln. Utbruten ur MatterHeader så dess
 *  optional-chain/&&-grenar inte räknas in i komponentkomplexiteten (#199). */
function MatterClientLine({ klient, matterType }: { klient: MatterContact[]; matterType?: string | null | undefined }) {
  return (
    <p className="text-sm text-gray-500 mt-1">
      {klient[0]?.contact && (
        <>Klient: <EntityLink route="contacts" id={klient[0].contact.id} className="text-blue-600 hover:underline">{klient[0].contact.name}</EntityLink></>
      )}
      {matterType && <>{klient.length > 0 ? " · " : ""}{matterType}</>}
    </p>
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

function MatterHeader({ matter: m, klient, onOpenGenerate }: HeaderProps) {
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
    <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6 mb-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <p className="text-sm font-mono text-gray-500">{m.matterNumber}</p>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">{m.title}</h1>
          <MatterClientLine klient={klient} matterType={m.matterType} />
        </div>
        <MatterHeaderActions
          m={m}
          isPending={updateStatus.isPending}
          onClose={onCloseMatter}
          onReopen={onReopenMatter}
          onGenerate={onOpenGenerate}
        />
      </div>
      {m.description && <p className="text-sm text-gray-700 mt-3">{m.description}</p>}
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
