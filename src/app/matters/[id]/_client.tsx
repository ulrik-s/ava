"use client";

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/client/lib/trpc";
import { DocumentBrowser } from "@/client/components/document-browser";
import { SuggestionsPanel } from "@/client/components/suggestions-panel";
import { EventsPanel } from "@/client/components/events-panel";
import { InvoicesSection } from "@/client/components/invoices-section";
import { PaymentMethodCard } from "@/client/components/payment-method-card";
import { FileDown } from "lucide-react";
import { ContactsSection } from "./_contacts-section";
import { TimeSection } from "./_time-section";
import { ExpenseSection } from "./_expense-section";
import { GenerateModal } from "./_generate-modal";
import { useRouteId } from "@/client/lib/demo/use-route-id";

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
  const klient = m.contacts.filter((c) => c.role === "KLIENT");

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
          paymentMethodNote={m.paymentMethodNote}
          paymentMethodDecidedAt={m.paymentMethodDecidedAt}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <EventsPanel matterId={id} />
        <SuggestionsPanel matterId={id} />
        <ContactsSection matterId={id} contacts={m.contacts} />
        <DocumentBrowser matterId={id} />
        <TimeSection matterId={id} />
        <ExpenseSection matterId={id} />
        <InvoicesSection matterId={id} />
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
    matterType?: string | null;
    description?: string | null;
    status: string;
  };
  klient: MatterContact[];
  onOpenGenerate: () => void;
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
          <p className="text-sm text-gray-500 mt-1">
            {klient.length > 0 && (
              <>Klient: <Link href={`/contacts/${klient[0].contact.id}`} className="text-blue-600 hover:underline">{klient[0].contact.name}</Link></>
            )}
            {m.matterType && <>{klient.length > 0 ? " · " : ""}{m.matterType}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
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
