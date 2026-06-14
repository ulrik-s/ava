"use client";

import { FileDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DocumentBrowser } from "@/components/documents/document-browser";
import { EventsPanel } from "@/components/matter/events-panel";
import { PaymentMethodCard } from "@/components/matter/payment-method-card";
import { SuggestionsPanel } from "@/components/matter/suggestions-panel";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { useRouteId } from "@/lib/client/demo/use-route-id";
import { trpc } from "@/lib/client/trpc";
import { BillingPanel } from "./_billing-panel";
import { ContactsSection } from "./_contacts-section";
import { ExpectedReceivablesSection } from "./_expected-receivables-section";
import { ExpenseSection } from "./_expense-section";
import { GenerateModal } from "./_generate-modal";
import { TimeSection } from "./_time-section";

 
/** Ärendets målnummer som sträng (getById-typen saknar fältet i select-typen). */
function courtCaseOf(m: unknown): string {
  return (m as { courtCaseNumber?: string | null }).courtCaseNumber ?? "";
}

export default function MatterDetailClient({ id: paramId }: { id: string }) {
  // Static export serverar en sentinel-shell för nya id:n → läs riktiga
  // id:t ur URL:en (faller tillbaka till build-time-param i server-mode).
  const id = useRouteId() ?? paramId;
  const matter = trpc.matter.getById.useQuery({ id });
  const [showGenerateModal, setShowGenerateModal] = useState(false);

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
        <PaymentMethodCard
          matterId={id}
          paymentMethod={m.paymentMethod}
          paymentMethodNote={m.paymentMethodNote ?? null}
          paymentMethodDecidedAt={m.paymentMethodDecidedAt ?? null}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <EventsPanel matterId={id} />
        <SuggestionsPanel matterId={id} />
        <ContactsSection matterId={id} contacts={m.contacts} />
        <DocumentBrowser matterId={id} />
        <BillingPanel matterId={id} matter={m} />
        <ExpectedReceivablesSection matterId={id} courtCaseNumber={courtCaseOf(m)} />
        <TimeSection matterId={id} isTaxeArende={m.isTaxeArende} />
        <ExpenseSection matterId={id} isTaxeArende={m.isTaxeArende} />
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

type MatterContact = {
  id: string;
  role: string;
  contact: { id: string; name: string };
};

interface HeaderProps {
  matter: {
    id: string;
    matterNumber: string;
    title: string;
    matterType?: string | null | undefined;
    description?: string | null | undefined;
    status: string;
    isTaxeArende?: boolean | undefined;
  };
  klient: MatterContact[];
  onOpenGenerate: () => void;
}

// eslint-disable-next-line complexity -- JSX-conditionals (klient-länk + matterType + isTaxeArende + status-actions)
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
          <p className="text-sm text-gray-500 mt-1">
            {klient[0]?.contact && (
              <>Klient: <EntityLink route="contacts" id={klient[0].contact.id} className="text-blue-600 hover:underline">{klient[0].contact.name}</EntityLink></>
            )}
            {m.matterType && <>{klient.length > 0 ? " · " : ""}{m.matterType}</>}
          </p>
        </div>
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
              onClick={onCloseMatter}
              disabled={updateStatus.isPending}
              className="px-3 py-1 text-xs font-medium bg-white border border-gray-300 rounded-full hover:bg-gray-50 text-gray-700 disabled:opacity-50"
            >
              Avsluta ärende
            </button>
          ) : m.status === "CLOSED" ? (
            <button
              onClick={onReopenMatter}
              disabled={updateStatus.isPending}
              className="px-3 py-1 text-xs font-medium bg-white border border-gray-300 rounded-full hover:bg-gray-50 text-gray-700 disabled:opacity-50"
            >
              Återöppna
            </button>
          ) : null}
          <button
            onClick={onOpenGenerate}
            className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-white border border-gray-300 rounded-full hover:bg-gray-50 text-gray-700"
          >
            <FileDown size={13} /> Generera dokument
          </button>
        </div>
      </div>
      {m.description && <p className="text-sm text-gray-700 mt-3">{m.description}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
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
