"use client";

/**
 * Dashboard — översikt för inloggad användare:
 *   - "Frister" överst — frister i rött när de är inne (#1167) och
 *     "Bör faktureras" (#1062, #1735)
 *   - Tidrapportering för vald dag (summa + lista)
 *   - Senaste 5 ärenden man jobbat i (timeEntry order desc, dedup)
 *
 * Dagsval: Igår / Idag / Imorgon / fritt datum, och pilarna ‹ › som stegar en
 * dag i taget från den valda dagen (#2095).
 *
 * Användaren väljer själv vilka rutor som syns (#1612): alla kan tas bort
 * med × och läggas tillbaka med "Lägg till ruta". Kalendern är borttagen
 * (#1623) — byråerna använder en egen kalender.
 */

import { Plus, Clock } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PanelPage } from "@/components/layout/panel-page";
import { DayStepper } from "@/components/ui/day-stepper";
import { SECTION_FILL_CLASS, sectionHeaderClass } from "@/components/ui/section-tone";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useCompleteWatch } from "@/components/watchlist/use-watch-actions";
import { WatchlistList } from "@/components/watchlist/watchlist-list";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { trpc } from "@/lib/client/trpc";
import { dayLabel } from "@/lib/shared/iso-date";
import { formatDecimalHoursWithUnit } from "@/lib/shared/kr-format";
import { DASHBOARD_CLOSABLE, dashboardLayout } from "./_dashboard-layout";

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function offsetDayYmd(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rangeForDay(ymd: string): { from: Date; to: Date } {
  const from = new Date(`${ymd}T00:00:00`);
  const to = new Date(`${ymd}T23:59:59.999`);
  return { from, to };
}

export default function Dashboard() {
  const [ymd, setYmd] = useState<string>(todayYmd());
  const panels = [
    { id: "watch", title: "Frister", render: () => <WatchlistCard />, fill: true },
    { id: "time", title: "Tidrapportering", render: () => <TimeCard ymd={ymd} />, fill: true },
    { id: "recent", title: "Senaste ärenden", render: () => <RecentMattersCard />, fill: true },
  ];

  return (
    <PanelPage
      page="dashboard"
      panels={panels}
      defaultLayout={dashboardLayout}
      closable={DASHBOARD_CLOSABLE}
      header={(
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Startsida</h1>
            <p className="text-sm text-gray-500 capitalize">{ymd && dayLabel(ymd, new Date())}</p>
          </div>
          <DaySwitcher ymd={ymd} onChange={setYmd} />
        </div>
      )}
    />
  );
}

/** Hur många poster som ryms på startsidan innan man skickas vidare. */
const DASHBOARD_LIMIT = 5;

/**
 * Startsidans "Frister". Visar de mest brådskande posterna och länkar
 * vidare — kortet ska tala om ATT något behöver uppmärksamhet, inte ersätta
 * hela listan. Self-gating: har man inga frister renderas ingenting, så
 * kortet aldrig blir tomt utfyllnad.
 */
function WatchlistCard() {
  const q = trpc.watchlist.list.useQuery({ mine: true });
  const complete = useCompleteWatch();
  const items = q.data?.items ?? [];
  // En panel ska inte stå tom och tyst — säg att det är lugnt (#1184).
  if (items.length === 0) return <p className="p-2 text-sm text-gray-500">Inga frister just nu.</p>;

  const passed = items.filter((i) => i.severity === "passed").length;
  return (
    <div className={SECTION_FILL_CLASS}>
      <div className={sectionHeaderClass("amber")}>
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          🔔 Frister
          <span className="text-xs font-normal text-gray-600">
            ({items.length}{passed > 0 ? `, ${passed} passerade` : ""})
          </span>
        </h2>
        <Link href="/watchlist" className="text-sm text-blue-700 hover:underline">
          Visa alla →
        </Link>
      </div>
      <div className="p-2">
        <WatchlistList items={items.slice(0, DASHBOARD_LIMIT)} emptyText="" onComplete={complete} showClient />
      </div>
    </div>
  );
}

function DaySwitcher({ ymd, onChange }: { ymd: string; onChange: (y: string) => void }) {
  const options = [
    { value: offsetDayYmd(1), label: "Igår" },
    { value: todayYmd(), label: "Idag" },
    { value: offsetDayYmd(-1), label: "Imorgon" },
  ];
  return (
    <DayStepper ymd={ymd} onChange={onChange}>
      <SegmentedControl options={options} value={ymd} onChange={onChange} ariaLabel="Dag" />
      <input type="date" value={ymd} onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-gray-200 px-2 py-1 text-xs" />
    </DayStepper>
  );
}

interface TimeEntryRow { id: string; minutes: number; description: string; billable: boolean; matter: { id: string; matterNumber: string; title: string } }
interface TimeQueryLike { data?: { entries: TimeEntryRow[]; totalMinutes: number } | undefined; isLoading: boolean }

function TimeCard({ ymd }: { ymd: string }) {
  const range = useMemo(() => rangeForDay(ymd), [ymd]);
  const me = trpc.user.current.useQuery();
  const entries = trpc.timeEntry.list.useQuery(
    { userId: me.data?.id, from: range.from, to: range.to, pageSize: 50 },
    { enabled: !!me.data?.id },
  ) as TimeQueryLike;

  return (
    <div className={SECTION_FILL_CLASS}>
      <div className={sectionHeaderClass("indigo")}>
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <Clock size={16} className="text-gray-500" /> Tidrapportering
          {entries.data && (
            <span>({formatDecimalHoursWithUnit(entries.data.totalMinutes)})</span>
          )}
        </h2>
        <Link href="/time" className="text-sm text-blue-700 hover:underline inline-flex items-center gap-1">
          <Plus size={12} /> Ny tid
        </Link>
      </div>
      <TimeList entries={entries} ymd={ymd} />
    </div>
  );
}

/** Tidslistan: laddar / tomt / rader. */
function TimeList({ entries, ymd }: { entries: TimeQueryLike; ymd: string }) {
  return (
    <div className="divide-y divide-gray-100">
      {entries.isLoading && <p className="px-2 py-3 text-sm text-gray-500">Laddar…</p>}
      {entries.data && entries.data.entries.length === 0 && (
        <p className="px-2 py-4 text-sm text-gray-500">Ingen tid registrerad {ymd === todayYmd() ? "idag" : "denna dag"} — <Link href="/time" className="text-blue-600 hover:underline">registrera tid</Link></p>
      )}
      {entries.data?.entries.map((e) => (
        <EntityLink key={e.id} route="matters" id={e.matter.id}
          className="block px-2 py-3 hover:bg-gray-50 flex items-center gap-3">
          <span className="text-sm font-mono text-gray-700 w-16 text-right">{formatDecimalHoursWithUnit(e.minutes)}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-900 truncate">{e.description}</p>
            <p className="text-xs text-gray-500 truncate">{e.matter.matterNumber} — {e.matter.title}</p>
          </div>
          {!e.billable && <span className="text-[10px] text-gray-400 uppercase">Ej deb.</span>}
        </EntityLink>
      ))}
    </div>
  );
}

function RecentMattersCard() {
  const me = trpc.user.current.useQuery();
  // Senaste 50 tidsposter, sortera bort till unika ärenden, ta första 5.
  const entries = trpc.timeEntry.list.useQuery(
    { userId: me.data?.id, pageSize: 50 },
    { enabled: !!me.data?.id },
  );
  const recent = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ id: string; matterNumber: string; title: string; lastDate: Date }> = [];
    for (const e of entries.data?.entries ?? []) {
      if (seen.has(e.matter.id)) continue;
      seen.add(e.matter.id);
      out.push({ id: e.matter.id, matterNumber: e.matter.matterNumber, title: e.matter.title, lastDate: new Date(e.date) });
      if (out.length >= 5) break;
    }
    return out;
  }, [entries.data]);

  return (
    <div className={SECTION_FILL_CLASS}>
      <div className={sectionHeaderClass("gray")}>
        <h2 className="font-semibold text-gray-900">Senaste ärenden du jobbat i</h2>
        <Link href="/matters" className="text-sm text-blue-700 hover:underline">Alla ärenden →</Link>
      </div>
      <div className="divide-y divide-gray-100">
        {entries.isLoading && <p className="px-2 py-3 text-sm text-gray-500">Laddar…</p>}
        {entries.data && recent.length === 0 && (
          <p className="px-2 py-4 text-sm text-gray-500">Du har inte registrerat tid på något ärende ännu.</p>
        )}
        {recent.map((m) => (
          <EntityLink key={m.id} route="matters" id={m.id} className="block px-2 py-3 hover:bg-gray-50 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-gray-900">{m.matterNumber} — {m.title}</p>
              <p className="text-xs text-gray-500">Senast: {m.lastDate.toLocaleDateString("sv-SE")}</p>
            </div>
          </EntityLink>
        ))}
      </div>
    </div>
  );
}
