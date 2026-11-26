"use client";

/**
 * Tidslistans tillstånd och fråga (#2096): dagen (startar alltid på idag),
 * perioden Från/Till och sidan, och `timeEntry.list` med gränserna ur
 * `listRange`. Varje ändring av dag eller period går till första sidan.
 */

import { useState } from "react";
import { listRange } from "@/lib/client/time-filter";
import { trpc } from "@/lib/client/trpc";
import { stockholmDay } from "@/lib/shared/stockholm-time";

/** Listans storlek per sida. */
const PAGE_SIZE = 50;

/** Tidslistans tillstånd, fråga och ändrare. */
export function useTimeList() {
  const [page, setPage] = useState(1);
  const [day, setDay] = useState(() => stockholmDay(new Date()));
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const query = trpc.timeEntry.list.useQuery({ page, pageSize: PAGE_SIZE, ...listRange(day, from, to) });
  return {
    query, page, setPage, day, from, to,
    onDay: (v: string) => { setDay(v); setPage(1); },
    onFrom: (v: string) => { setFrom(v); setPage(1); },
    onTo: (v: string) => { setTo(v); setPage(1); },
    onClear: () => { setFrom(""); setTo(""); setPage(1); },
  };
}

/** Det {@link useTimeList} ger. */
export type TimeList = ReturnType<typeof useTimeList>;
