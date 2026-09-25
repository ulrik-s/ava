"use client";

/**
 * Fortnox OAuth-callback (#1172). Fortnox skickar hit `?code=…&state=…` efter
 * godkännandet; sidan växlar in koden på servern och visar utfallet.
 * Registrera exakt den här URL:en som redirect-URI i Fortnox Developer Portal.
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { trpc } from "@/lib/client/trpc";

function Callback() {
  const params = useSearchParams();
  const code = params.get("code");
  const state = params.get("state");
  const denied = params.get("error");
  const complete = trpc.ledger.completeConnect.useMutation();
  const started = useRef(false);

  useEffect(() => {
    // En gång: koden är engångs, och StrictMode kör effekter två gånger i dev.
    if (started.current || !code || !state) return;
    started.current = true;
    complete.mutate({ code, state });
  }, [code, state, complete]);

  if (denied || !code || !state) return <p className="text-red-700">Anslutningen avbröts{denied ? ` (${denied})` : ""}.</p>;
  if (complete.error) return <p role="alert" className="text-red-700">Kunde inte ansluta: {complete.error.message}</p>;
  if (complete.isSuccess) return <p className="text-green-700">Fortnox är anslutet ✓</p>;
  return <p className="text-gray-500">Ansluter till Fortnox…</p>;
}

export default function FortnoxCallbackPage() {
  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-semibold mb-4">Fortnox</h1>
      <Suspense fallback={<p className="text-gray-500">Laddar…</p>}>
        <Callback />
      </Suspense>
      <Link href="/settings" className="mt-4 inline-block text-sm text-blue-600 hover:underline">← Till Inställningar</Link>
    </div>
  );
}
