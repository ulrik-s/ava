"use client";

/**
 * /conflicts finns kvar för gamla bokmärken och länkar. Ärendelistan kör nu
 * jävskontrollen själv (#1642), så sidomenyn har ett menyval för båda (#1643).
 */

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function ConflictsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/matters"); }, [router]);
  return <p className="text-sm text-gray-500">Jävskontrollen finns nu i Ärenden / jävskontroll — skickar dig vidare…</p>;
}
