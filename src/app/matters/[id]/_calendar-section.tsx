"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/client/trpc";
import { Calendar } from "lucide-react";
import { EventDetailModal, type EventDetail } from "@/app/calendar/_event-detail-modal";
import { DataTable, type Column } from "@/components/ui/data-table";

interface Props {
  matterId: string;
}

interface Event {
  id: string;
  title: string;
  startAt: string | Date;
  endAt?: string | Date | null;
  location?: string | null;
  description?: string | null;
  userId: string;
  matterId?: string | null;
  kind?: string;
  allDay?: boolean;
}

const eventColumns: Column<Event>[] = [
  { key: "datetime", label: "Datum / tid", sortable: true, sortValue: (e) => new Date(e.startAt),
    render: (e) => {
      const start = new Date(e.startAt);
      const dateStr = start.toLocaleDateString("sv-SE", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
      const timeStr = e.allDay ? "Hela dagen" : start.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
      return (
        <span className="text-sm text-gray-700 whitespace-nowrap">
          <span className="block">{dateStr}</span>
          <span className="block text-xs text-gray-500">{timeStr}</span>
        </span>
      );
    },
  },
  { key: "kind", label: "Typ", sortable: true, sortValue: (e) => e.kind === "deadline" ? "Frist" : "Möte",
    render: (e) => (
      <span className={`inline-flex px-1.5 py-0.5 rounded-full text-xs ${e.kind === "deadline" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"}`}>
        {e.kind === "deadline" ? "Frist" : "Möte"}
      </span>
    ),
  },
  { key: "title", label: "Titel", sortable: true, sortValue: (e) => e.title,
    render: (e) => <span className="text-sm text-gray-900">{e.title}</span> },
  { key: "location", label: "Plats", sortable: true, sortValue: (e) => e.location ?? "",
    render: (e) => <span className="text-sm text-gray-500">{e.location ?? "—"}</span> },
];

export function CalendarSection({ matterId }: Props): React.ReactElement {
  const router = useRouter();
  const events = trpc.calendar.listForMatter.useQuery({ matterId });
  const users = trpc.user.list.useQuery();
  const [selected, setSelected] = useState<EventDetail | null>(null);
  const userName = (uid: string): string =>
    users.data?.users.find((u: { id: string; name: string }) => u.id === uid)?.name ?? "?";

  function onSelect(e: Event): void {
    setSelected({
      id: e.id, title: e.title, location: e.location,
      startAt: e.startAt, endAt: e.endAt, allDay: e.allDay ?? false,
      userId: e.userId, matterId: e.matterId, description: e.description ?? null,
      kind: (e.kind === "deadline" ? "deadline" : "appointment"),
    });
  }

  const columns: Column<Event>[] = [
    ...eventColumns,
    { key: "open", label: "", sortable: false, align: "right", hideable: false,
      render: (e) => (
        <button type="button" onClick={() => onSelect(e)} className="text-xs text-blue-600 hover:underline">
          Visa
        </button>
      ),
    },
  ];

  return (
    <div className="bg-white rounded-lg border border-gray-200 lg:col-span-2">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <Calendar size={16} className="text-gray-500" /> Kalender-händelser
          {events.data && events.data.length > 0 && (
            <span className="ml-1 text-sm font-normal text-gray-500">({events.data.length})</span>
          )}
        </h2>
        <Link href="/calendar" className="text-sm text-blue-600 hover:underline">
          Öppna kalendern →
        </Link>
      </div>

      <div className="p-4">
        {events.isLoading ? (
          <p className="text-sm text-gray-500">Laddar…</p>
        ) : (
          <DataTable
            prefKey={`list.matter-calendar.${matterId}`}
            columns={columns}
            data={(events.data ?? []) as Event[]}
            rowKey={(e) => e.id}
            emptyMessage="Inga kalender-händelser kopplade till detta ärende."
          />
        )}
      </div>

      <EventDetailModal
        event={selected}
        userName={selected ? userName(selected.userId) : ""}
        onClose={() => setSelected(null)}
        gotoCalendar={(ev) => {
          const d = new Date(ev.startAt);
          const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          router.push(`/calendar?date=${ymd}`);
        }}
      />
    </div>
  );
}
