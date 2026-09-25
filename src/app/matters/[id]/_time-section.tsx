"use client";

import { useState } from "react";
import {
  TimeForm, applyStandardAtgard, emptyForm, toEditForm, useStandardAtgarder, type EditForm,
} from "@/components/time/time-entry-form";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import { sectionHeaderClass } from "@/components/ui/section-tone";
import { TIME_ENTRY_KIND_SHORT } from "@/lib/client/labels";
import { trpc } from "@/lib/client/trpc";
import { formatMinutes } from "@/lib/client/utils";
import { isPerDayKind } from "@/lib/shared/brottmalstaxa";
import type { MatterStatus, PaymentMethod, TimeEntryKind } from "@/lib/shared/schemas/enums";
import type { InvoiceId, MatterId, TimeEntryId } from "@/lib/shared/schemas/ids";
import type { StandardAtgard } from "@/lib/shared/standard-atgard";
import { StandardAtgardSuggestions } from "./_standard-atgard-suggestions";

interface Props {
  matterId: MatterId;
  isTaxeArende?: boolean;
  /** Styr kategori-hjälptexten: rättshjälp/rättsskydd ersätts på Domstolsverkets
   *  normer per kategori, inte på byråns timpris (#953). */
  paymentMethod?: PaymentMethod | undefined;
  /** Driver förslagen om avslutande standardåtgärder (#958) — ett stängt ärende
   *  är i sitt avslutningsskede även utan kostnadsräkning. */
  matterStatus?: MatterStatus | undefined;
}

/** Ärenden där kategorin styr vilken ÅRSNORM slutregleringen värderar posten på. */
const COVERAGE_METHODS = new Set<PaymentMethod>(["RATTSHJALP", "RATTSSKYDD"]);

function isCoverageMethod(method: PaymentMethod | undefined): boolean {
  return method !== undefined && COVERAGE_METHODS.has(method);
}

interface TimeEntryRow {
  id: TimeEntryId;
  date: Date | string;
  minutes: number;
  description: string | null;
  billable: boolean;
  kind?: TimeEntryKind | null;
  standardAtgardId?: string | null;
  hourlyRate?: number | null;
  user?: { name?: string | null } | null;
  invoiceId?: InvoiceId | null;
  invoice?: { id: InvoiceId; invoiceNumber?: string | null } | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

function fmtDateTime(v: Date | string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  return d.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
}

// eslint-disable-next-line max-lines-per-function -- TODO: refactor (struktur är tabular: kolumndefs + 2 modaler)
export function TimeSection({ matterId, isTaxeArende, paymentMethod, matterStatus }: Props) {
  const isCoverage = isCoverageMethod(paymentMethod);
  const atgarder = useStandardAtgarder(paymentMethod);
  const utils = trpc.useUtils();
  const timeEntries = trpc.timeEntry.list.useQuery({ matterId });
  // EN källa för både tabellen och förslagsraden (#958) — annars kunde de visa
  // olika bild av vilka standardåtgärder som redan är registrerade.
  const rows = (timeEntries.data?.entries ?? []) as TimeEntryRow[];
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<TimeEntryId | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [createForm, setCreateForm] = useState<EditForm>(emptyForm);

  const createTimeEntry = trpc.timeEntry.create.useMutation({
    onSuccess: () => {
      void utils.timeEntry.list.invalidate({ matterId });
      setShowCreate(false);
      setCreateForm(emptyForm());
    },
  });

  const updateTimeEntry = trpc.timeEntry.update.useMutation({
    onSuccess: () => {
      void utils.timeEntry.list.invalidate({ matterId });
      setEditingId(null);
      setEditForm(null);
    },
  });

  const deleteTimeEntry = trpc.timeEntry.delete.useMutation({
    onSuccess: () => utils.timeEntry.list.invalidate({ matterId }),
  });

  function startEdit(entry: TimeEntryRow): void {
    setEditingId(entry.id);
    setEditForm(toEditForm(entry));
  }

  function saveEdit(): void {
    if (!editingId || !editForm) return;
    updateTimeEntry.mutate({ id: editingId, ...editForm });
  }

  function confirmDelete(id: TimeEntryId): void {
    if (confirm("Ta bort tidregistreringen?")) deleteTimeEntry.mutate({ id });
  }

  /** Föreslagen standardåtgärd (#958) → öppna formuläret FÖRIFYLLT. Sparar inget:
   *  datumet är handläggarens val och styr postens årsnorm. */
  function pickStandardAtgard(atgard: StandardAtgard): void {
    setCreateForm(applyStandardAtgard(emptyForm(), atgard));
    setShowCreate(true);
  }

  const columns: Column<TimeEntryRow>[] = [
    { key: "date", label: "Datum", sortable: true, sortValue: (e) => new Date(e.date),
      render: (e) => <span className="text-sm text-gray-500">{new Date(e.date).toLocaleDateString("sv-SE")}</span> },
    { key: "user", label: "Advokat", sortable: true, sortValue: (e) => e.user?.name ?? "",
      render: (e) => <span className="text-sm text-gray-900">{e.user?.name ?? "—"}</span> },
    { key: "minutes", label: "Tid", sortable: true, align: "right", sortValue: (e) => e.minutes,
      summary: (rows) => <span className="font-mono">{formatMinutes(rows.reduce((sum, r) => sum + r.minutes, 0))}</span>,
      render: (e) => (
        <span className="text-sm text-gray-900">
          {isPerDayKind(e.kind) ? "1 dygn" : formatMinutes(e.minutes)}
        </span>
      ) },
    { key: "description", label: "Beskrivning", sortable: true, sortValue: (e) => e.description ?? "",
      render: (e) => <span className="text-sm text-gray-700">{e.description}</span> },
    // Kategorin styr vilken av Domstolsverkets normer posten värderas på vid
    // slutreglering (#950/#953) — den påverkar beloppet och hör därför i default-vyn.
    { key: "kind", label: "Kategori", sortable: true, sortValue: (e) => e.kind ?? "ARBETE",
      render: (e) => <span className="text-sm text-gray-700">{TIME_ENTRY_KIND_SHORT[e.kind ?? "ARBETE"]}</span> },
    { key: "billable", label: "Deb.", sortable: true, sortValue: (e) => (e.billable ? 1 : 0),
      render: (e) => <span className="text-sm">{e.billable ? "Ja" : "Nej"}</span> },
    // Notera: kolumnerna "Fakturerad" + "Faktura" finns INTE här. Rättshjälp/
    // rättsskydd-flödet bryter 1:1-kopplingen mellan tidsrad och faktura —
    // samma rad kan ingå i acconto till klient + slutfaktura till myndighet.
    // Vid framtida rättshjälp-stöd hanteras kopplingen via separat invoice-
    // line-modell, inte invoiceId på timeEntry.
    { key: "actions", label: "", sortable: false, align: "right", hideable: false,
      render: (e) => (
        <span className="whitespace-nowrap">
          <button onClick={() => startEdit(e)} className="text-xs text-gray-500 hover:text-blue-600 hover:underline mr-3">Ändra</button>
          <button onClick={() => confirmDelete(e.id)} className="text-xs text-red-500 hover:underline">Ta bort</button>
        </span>
      ),
    },
    // Katalog-fält — finns på posten men visas inte i default-vyn. Användaren
    // aktiverar via "+ Visa kolumn → Tillgängliga fält".
    { key: "hourlyRate", label: "Timpris", sortable: true, defaultHidden: true, align: "right",
      sortValue: (e) => e.hourlyRate ?? 0,
      render: (e) => <span className="text-sm font-mono text-gray-500">{e.hourlyRate ? `${e.hourlyRate / 100} kr/h` : "—"}</span> },
    { key: "createdAt", label: "Skapad", sortable: true, defaultHidden: true,
      sortValue: (e) => e.createdAt ? new Date(e.createdAt) : null,
      render: (e) => <span className="text-sm text-gray-500">{fmtDateTime(e.createdAt)}</span> },
    { key: "updatedAt", label: "Uppdaterad", sortable: true, defaultHidden: true,
      sortValue: (e) => e.updatedAt ? new Date(e.updatedAt) : null,
      render: (e) => <span className="text-sm text-gray-500">{fmtDateTime(e.updatedAt)}</span> },
    { key: "id", label: "ID", sortable: true, defaultHidden: true,
      sortValue: (e) => e.id,
      render: (e) => <span className="text-xs font-mono text-gray-400">{e.id.slice(0, 8)}</span> },
  ];

  return (
    <div className="bg-white rounded-lg border border-gray-200 lg:col-span-2">
      <div className={sectionHeaderClass("indigo")}>
        <h2 className="font-semibold text-gray-900">
          Tidregistrering
          {timeEntries.data && (
            <span className="ml-2 text-sm font-normal text-gray-500">(totalt {formatMinutes(timeEntries.data.totalMinutes)})</span>
          )}
        </h2>
        <button onClick={() => setShowCreate(true)} className="text-sm text-blue-600 hover:underline">
          + Registrera tid
        </button>
      </div>

      <StandardAtgardSuggestions
        matterId={matterId}
        paymentMethod={paymentMethod}
        matterStatus={matterStatus}
        entries={rows}
        onPick={pickStandardAtgard}
      />

      <div className="p-4">
        <DataTable
          prefKey={`list.matter-time.${matterId}`}
          columns={columns}
          data={rows}
          rowKey={(e) => e.id}
          emptyMessage="Inga tidsposter."
        />
      </div>

      <Modal open={showCreate} title="Registrera tid" onClose={() => setShowCreate(false)}>
        <TimeForm
          form={createForm}
          setForm={setCreateForm}
          submitLabel={createTimeEntry.isPending ? "Sparar..." : "Spara"}
          isPending={createTimeEntry.isPending}
          isTaxeArende={isTaxeArende}
          isCoverage={isCoverage}
          atgarder={atgarder}
          onSubmit={() => createTimeEntry.mutate({ ...createForm, matterId })}
          onCancel={() => setShowCreate(false)}
        />
      </Modal>

      <Modal open={editingId !== null && editForm !== null} title="Ändra tidregistrering" onClose={() => { setEditingId(null); setEditForm(null); }}>
        {editForm && (
          <TimeForm
            form={editForm}
            setForm={(f) => setEditForm(f)}
            submitLabel={updateTimeEntry.isPending ? "Sparar..." : "Spara"}
            isPending={updateTimeEntry.isPending}
            isTaxeArende={isTaxeArende}
            isCoverage={isCoverage}
            atgarder={atgarder}
            onSubmit={saveEdit}
            onCancel={() => { setEditingId(null); setEditForm(null); }}
          />
        )}
      </Modal>
    </div>
  );
}
