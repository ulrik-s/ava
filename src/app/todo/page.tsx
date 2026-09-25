"use client";

/**
 * /todo finns kvar för gamla bokmärken och länkar. "Att göra" och "Att bevaka"
 * visade samma poster och förvirrade (#1167) — uppgifter och frister finns nu
 * bara i "Att bevaka", möten och förhandlingar i Kalendern.
 */

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function TodoRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/watchlist"); }, [router]);
  return <p className="text-sm text-gray-500">Att göra heter nu Att bevaka — skickar dig vidare…</p>;
}
