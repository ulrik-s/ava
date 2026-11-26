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

/** `timeEntry.list` för sidan och dagen eller perioden (perioden går före). */
function useListQuery(page: number, day: string, from: string, to: string) {
  return trpc.timeEntry.list.useQuery({ page, pageSize: PAGE_SIZE, ...listRange(day, from, to) });
}

/** Tidslistans tillstånd, fråga och ändrare: det {@link useTimeList} ger. */
export interface TimeList {
  /** `timeEntry.list` för dagen eller perioden, på sidan `page`. */
  query: ReturnType<typeof useListQuery>;
  /** Sidan som visas (1-baserad). */
  page: number;
  setPage: (page: number) => void;
  /** Dagen som visas utan period, "YYYY-MM-DD" (startar på idag). */
  day: string;
  /** Periodens Från, "YYYY-MM-DD" eller tom. */
  from: string;
  /** Periodens Till, "YYYY-MM-DD" eller tom. */
  to: string;
  /** Byt dag och gå till sida 1. */
  onDay: (v: string) => void;
  /** Ändra Från och gå till sida 1. */
  onFrom: (v: string) => void;
  /** Ändra Till och gå till sida 1. */
  onTo: (v: string) => void;
  /** Töm Från/Till (dagen lämnas orörd) och gå till sida 1. */
  onClear: () => void;
}

/** Tidslistans tillstånd, fråga och ändrare. */
export function useTimeList(): TimeList {
  const [page, setPage] = useState(1);
  const [day, setDay] = useState(() => stockholmDay(new Date()));
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const query = useListQuery(page, day, from, to);
  return {
    query, page, setPage, day, from, to,
    onDay: (v: string) => { setDay(v); setPage(1); },
    onFrom: (v: string) => { setFrom(v); setPage(1); },
    onTo: (v: string) => { setTo(v); setPage(1); },
    onClear: () => { setFrom(""); setTo(""); setPage(1); },
  };
}
