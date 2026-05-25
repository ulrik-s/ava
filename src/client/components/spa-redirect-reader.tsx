"use client";

/**
 * `SpaRedirectReader` — läs sessionStorage._spa_redirect och routera dit.
 *
 * Funkar tillsammans med `out/404.html` (genererad av build-demo.sh):
 * GH Pages serverar 404.html för okända URL:er → det HTML:et skriver
 * intended path till sessionStorage och redirectar till /ava/ →
 * appen bootar på roten, läser sessionStorage, kör router.replace(path).
 *
 * Resultat: webappen funkar som SPA — direktlänkar till runtime-skapade
 * entity-id:n (t.ex. /matters/<nytt-id>/) router:as klientsidigt utan
 * att kräva pre-renderad HTML.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const STORAGE_KEY = "_spa_redirect";

export function SpaRedirectReader(): null {
  const router = useRouter();
  useEffect(() => {
    if (typeof window === "undefined") return;
    const target = sessionStorage.getItem(STORAGE_KEY);
    if (!target) return;
    sessionStorage.removeItem(STORAGE_KEY);
    // Bara routera om target inte redan är aktuell path (annars loop).
    // basePath är redan strippad av 404.html innan target sparades.
    if (target && target !== "/" && target !== "") {
      router.replace(target);
    }
  }, [router]);
  return null;
}
