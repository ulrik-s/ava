"use client";

/**
 * `CalendarSection` — listar kalender-events kopplade till ärendet på
 * matter-detalj-sidan. Visar tid, titel, ägare och plats.
 */

import Link from "next/link";
import { trpc } from "@/lib/client/trpc";
import { Calendar } from "lucide-react";

interface Props {
  matterId: string;
}

interface Event {
  id: string;
  title: string;
  startAt: string | Date;
  endAt?: string | Date | null;
  location?: string | null;
  userId: string;
  kind?: string;
  allDay?: boolean;
}

export function CalendarSection({ matterId }: Props): React.ReactElement {
  const events = trpc.calendar.listForMatter.useQuery({ matterId });

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

      <div className="overflow-x-auto">
        {events.isLoading && (
          <p className="px-6 py-3 text-sm text-gray-500">Laddar…</p>
        )}
        {events.data && events.data.length === 0 && (
          <p className="px-6 py-3 text-sm text-gray-500">Inga kalender-händelser kopplade till detta ärende.</p>
        )}
        {events.data && events.data.length > 0 && (
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Datum / tid</th>
                <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Typ</th>
                <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Titel</th>
                <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Plats</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(events.data as Event[]).map((e) => {
                const start = new Date(e.startAt);
                const dateStr = start.toLocaleDateString("sv-SE", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
                const timeStr = e.allDay ? "Hela dagen" : start.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
                return (
                  <tr key={e.id}>
                    <td className="px-6 py-2 text-sm text-gray-700 whitespace-nowrap">
                      <div>{dateStr}</div>
                      <div className="text-xs text-gray-500">{timeStr}</div>
                    </td>
                    <td className="px-6 py-2 text-xs">
                      <span className={`inline-flex px-1.5 py-0.5 rounded-full ${e.kind === "deadline" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"}`}>
                        {e.kind === "deadline" ? "Frist" : "Möte"}
                      </span>
                    </td>
                    <td className="px-6 py-2 text-sm text-gray-900">{e.title}</td>
                    <td className="px-6 py-2 text-sm text-gray-500">{e.location ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
