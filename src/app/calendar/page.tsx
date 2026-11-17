"use client";

/**
 * /calendar finns kvar för gamla bokmärken och länkar. Kalendern är borttagen
 * ur AVA (#1623) — byråerna använder en egen kalender. Kalenderdatan finns kvar.
 */

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function CalendarRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/"); }, [router]);
  return <p className="text-sm text-gray-500">Kalendern finns inte längre i AVA — skickar dig till Startsidan…</p>;
}
