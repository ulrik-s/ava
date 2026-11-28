"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useActiveMatterOptions } from "@/components/matter/use-active-matter-options";
import { MoveTimeEntriesButton, useTimeEntrySelection } from "@/components/time/move-time-entries";
import {
  TimeForm, applyStandardAtgard, emptyForm, timeEntryInput, toEditForm, useStandardAtgarder, type EditForm,
} from "@/components/time/time-entry-form";
import { useSaveTimeEntry } from "@/components/time/use-save-time-entry";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import { SECTION_FILL_CLASS, sectionHeaderClass } from "@/components/ui/section-tone";
import { invalidateUnbilledWork } from "@/lib/client/billing/invalidate-billing-side-effects";
import { useBillingQueryUtils } from "@/lib/client/billing/use-billing-query-utils";
import { TIME_ENTRY_KIND_SHORT } from "@/lib/client/labels";
import { useTRPC } from "@/lib/client/trpc";
import { isCoverageMethod } from "@/lib/shared/billing/billing-flow";
import { isPerDayKind } from "@/lib/shared/billing/brottmalstaxa";
import { formatDecimalHours, formatDecimalHoursWithUnit } from "@/lib/shared/kr-format";
import type { MatterStatus, PaymentMethod, TimeEntryKind } from "@/lib/shared/schemas/enums";
import type { BillingRunId, InvoiceId, MatterId, TimeEntryId } from "@/lib/shared/schemas/ids";
import type { StandardAtgard } from "@/lib/shared/standard-atgard";
import { isLockedEntry, LOCKED_ENTRY_HINT } from "@/lib/shared/time-entry-lock";
import { useMarkRadgivning, type MarkRadgivning } from "./_radgivning-entry";
import { RattshjalpCapWarning } from "./_rattshjalp-cap-warning";
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
  /** Rättshjälpens timtak — takvarningen vid tidsregistreringen (#1520). */
  rattshjalpMaxTimmar?: number | null | undefined;
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
  /** Satt när posten ingick i en slutfaktura eller kostnadsräkning — låst. */
  frozenAt?: Date | string | null;
  frozenByBillingRunId?: BillingRunId | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

function fmtDateTime(v: Date | string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  return d.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
}

// eslint-disable-next-line max-lines-per-function -- TODO: refactor (struktur är tabular: kolumndefs + 2 modaler)
export function TimeSection({ matterId, isTaxeArende, paymentMethod, matterStatus, rattshjalpMaxTimmar }: Props) {
  const isCoverage = isCoverageMethod(paymentMethod);
  const atgarder = useStandardAtgarder(paymentMethod);
  const radgivning = useMarkRadgivning(matterId, paymentMethod);
  const t = useTRPC();
  const queryClient = useQueryClient();
  const billingUtils = useBillingQueryUtils();
  const timeEntries = useQuery(t.timeEntry.list.queryOptions({ matterId }));
  // EN källa för både tabellen och förslagsraden (#958) — annars kunde de visa
  // olika bild av vilka standardåtgärder som redan är registrerade.
  const rows = (timeEntries.data?.entries ?? []) as TimeEntryRow[];
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<TimeEntryId | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  /** Ärendet som valts i Ändra tidregistrering (#2042) — förvalt det här ärendet. */
  const [editMatterId, setEditMatterId] = useState<MatterId>(matterId);
  const [createForm, setCreateForm] = useState<EditForm>(emptyForm);
  const matterOptions = useActiveMatterOptions();
  const marking = useTimeEntrySelection<TimeEntryRow>();

  /** Tidslistan + upparbetat mot taket (#1520) + fakturaförslaget (#2201). */
  function refreshMatters(matterIds: MatterId[]): void {
    for (const id of matterIds) {
      void queryClient.invalidateQueries(t.timeEntry.list.queryFilter({ matterId: id }));
      void queryClient.invalidateQueries(t.matter.coverageUsage.queryFilter({ matterId: id }));
    }
    invalidateUnbilledWork(billingUtils, matterIds);
  }
  const refreshTime = (): void => refreshMatters([matterId]);

  const createTimeEntry = useMutation(t.timeEntry.create.mutationOptions({
    onSuccess: () => {
      refreshTime();
      setShowCreate(false);
      setCreateForm(emptyForm());
    },
  }));

  const saver = useSaveTimeEntry({
    refresh: refreshMatters,
    done: () => { setEditingId(null); setEditForm(null); },
  });

  const deleteTimeEntry = useMutation(t.timeEntry.delete.mutationOptions({
    onSuccess: refreshTime,
    onError: (e) => { console.error("[timeEntry.delete] misslyckades:", e); alert(`Kunde inte ta bort: ${e.message}`); },
  }));

  function startEdit(entry: TimeEntryRow): void {
    setEditingId(entry.id);
    setEditForm(toEditForm(entry));
    setEditMatterId(matterId);
  }

  function saveEdit(): void {
    if (!editingId || !editForm) return;
    saver.save({ id: editingId, fromMatterId: matterId, toMatterId: editMatterId }, editForm);
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
    { key: "minutes", label: "Tid (h)", sortable: true, align: "right", sortValue: (e) => e.minutes,
      summary: (rows) => <span className="font-mono">{formatDecimalHours(rows.reduce((sum, r) => sum + r.minutes, 0))}</span>,
      render: (e) => (
        <span className="text-sm text-gray-900">
          {isPerDayKind(e.kind) ? "1 dygn" : formatDecimalHours(e.minutes)}
        </span>
      ) },
    { key: "description", label: "Beskrivning", sortable: true, sortValue: (e) => e.description ?? "", wrap: true,
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
      render: (e) => <TimeRowActions entry={e} onEdit={startEdit} onDelete={confirmDelete} radgivning={radgivning} />,
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
    <div className={SECTION_FILL_CLASS}>
      <div className={sectionHeaderClass("indigo")}>
        <h2 className="font-semibold text-gray-900">
          Tidregistrering
          {timeEntries.data && (
            <span className="ml-2 text-sm font-normal text-gray-600">(totalt {formatDecimalHoursWithUnit(timeEntries.data.totalMinutes)})</span>
          )}
        </h2>
        <button onClick={() => setShowCreate(true)} className="text-sm text-blue-700 hover:underline">
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

      <div className="p-2">
        <RattshjalpCapWarning matterId={matterId} paymentMethod={paymentMethod} rattshjalpMaxTimmar={rattshjalpMaxTimmar} />
        <MoveTimeEntriesButton selected={marking.selection.selected} excludeMatterId={matterId}
          onMoved={marking.clear} refresh={(to) => refreshMatters([matterId, to])} />
        <DataTable
          prefKey={`list.matter-time.${matterId}`}
          columns={columns}
          data={rows}
          rowKey={(e) => e.id}
          emptyMessage="Inga tidsposter."
          selection={marking.selection}
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
          onSubmit={() => createTimeEntry.mutate({ ...timeEntryInput(createForm), matterId })}
          onCancel={() => setShowCreate(false)}
        />
      </Modal>

      <Modal open={editingId !== null && editForm !== null} title="Ändra tidregistrering" onClose={() => { setEditingId(null); setEditForm(null); }}>
        {editForm && (
          <TimeForm
            form={editForm}
            matter={{ matters: matterOptions, value: editMatterId, onChange: setEditMatterId }}
            setForm={(f) => setEditForm(f)}
            submitLabel={saver.isPending ? "Sparar..." : "Spara"}
            isPending={saver.isPending}
            isTaxeArende={isTaxeArende}
            isCoverage={isCoverage}
            atgarder={atgarder}
            onSubmit={saveEdit}
            onCancel={() => { setEditingId(null); setEditForm(null); }}
          />
        )}
        <SaveError error={saver.error} />
      </Modal>
    </div>
  );
}

/** "Markera som rådgivning" (#1207) — bara där regeln tillåter markeringen. */
function MarkRadgivningButton({ entry, radgivning }: { entry: TimeEntryRow; radgivning: MarkRadgivning }) {
  if (!radgivning.canMark(entry)) return null;
  return (
    <button onClick={() => radgivning.mark(entry.id)} className="text-xs text-blue-600 hover:underline mr-3"
      title="Koppla posten till rättshjälpens rådgivningsfaktura (#1207)">
      Markera som rådgivning
    </button>
  );
}

/**
 * Ändra/Ta bort — eller låst (#1170, #1863): servern avvisar ändring av en post
 * som är låst (`isLockedEntry`: fakturerad eller fryst). Förr visades Ändra ändå och
 * sparandet föll tyst — "inget händer". En låst ej debiterbar post kan ändå
 * markeras som rådgivning (#1235).
 */
function TimeRowActions({ entry, onEdit, onDelete, radgivning }: {
  entry: TimeEntryRow; onEdit: (e: TimeEntryRow) => void; onDelete: (id: TimeEntryId) => void; radgivning: MarkRadgivning;
}) {
  if (isLockedEntry(entry)) {
    return (
      <span className="whitespace-nowrap">
        <MarkRadgivningButton entry={entry} radgivning={radgivning} />
        <span className="text-xs text-gray-500" title={LOCKED_ENTRY_HINT}>
          🔒 Låst
        </span>
      </span>
    );
  }
  return (
    <span className="whitespace-nowrap">
      <MarkRadgivningButton entry={entry} radgivning={radgivning} />
      <button onClick={() => onEdit(entry)} className="text-xs text-gray-500 hover:text-blue-600 hover:underline mr-3">Ändra</button>
      <button onClick={() => onDelete(entry.id)} className="text-xs text-red-500 hover:underline">Ta bort</button>
    </span>
  );
}

/** Varför sparandet misslyckades — aldrig tyst (#1170). */
function SaveError({ error }: { error: { message: string } | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
      Kunde inte spara: {error.message}
    </p>
  );
}
