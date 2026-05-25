"use client";

/**
 * /setup — provisionerings-flöde för self-hosted AVA.
 *
 * Default-läge (tunnaste möjliga server, ingen kod): admin har skapat en
 * PAT via `tooling/scripts/add-user.sh` och delat den med användaren via
 * säker kanal. Användaren klistrar in den här.
 *
 * Avancerat-disclosure: om kunden valt att köra invite-server-profilen
 * (extra docker-tjänst) kan vi också utfärda PAT via /auth/bootstrap eller
 * /auth/redeem-invite. Default off så vi inte ber om det när det inte finns.
 *
 * Demo-mode (gh-pages): ingen auth — visa info-meddelande och länk till start.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { KeyRound, ShieldCheck, Info, AlertTriangle, Check, Loader2, Settings } from "lucide-react";
import { createAuthClient, type ProvisionedAccount } from "@/client/lib/auth/auth-client";
import { loadFirmaConfig, saveFirmaConfig } from "@/client/lib/firma/firma-config";

type Stage = "loading" | "done" | "paste" | "advanced" | "demo";

// eslint-disable-next-line complexity
export default function SetupPage() {
  const [stage, setStage] = useState<Stage>("loading");
  const [hasAuthServer, setHasAuthServer] = useState(false);

  // Klar-state
  const [success, setSuccess] = useState<ProvisionedAccount | null>(null);

  // Paste-PAT-form
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [pat, setPat] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cfg = loadFirmaConfig();
    if (cfg.token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStage("done");
      return;
    }
    if (cfg.tier === "demo") {
       
      setStage("demo");
      return;
    }
    // Self-hosted: paste-läge default. Kolla i bakgrunden om en
    // auth-server är aktiv → om så, exponera "Avancerat".
    setStage("paste");
    void probeAuthServer().then(setHasAuthServer).catch(() => {});
  }, []);

  function onPasteSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setError(null);
    if (!email || !pat) {
      setError("Email och PAT krävs.");
      return;
    }
    const cfg = loadFirmaConfig();
    saveFirmaConfig({
      ...cfg,
      token: pat,
      authorEmail: email,
      authorName: name || cfg.authorName,
    });
    setSuccess({ email, token: pat, role: "LAWYER" });
    setStage("done");
  }

  return (
    <div className="max-w-xl mx-auto py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2 flex items-center gap-2">
        <ShieldCheck size={22} /> AVA setup
      </h1>

      {stage === "loading" && (
        <p className="text-sm text-gray-500"><Loader2 className="inline animate-spin mr-1" size={14} /> Hämtar status…</p>
      )}

      {stage === "demo" && (
        <div className="bg-blue-50 border border-blue-200 rounded p-5 text-sm text-blue-900">
          <p className="flex items-center gap-1 mb-2"><Info size={14} /> <strong>Demo-läge</strong></p>
          <p>Du kör mot publik demo-data — ingen inloggning behövs. Ändringar gäller bara i den här fliken.</p>
          <Link href="/" className="inline-block mt-3 text-sm text-blue-700 hover:underline">→ Till startsidan</Link>
        </div>
      )}

      {stage === "paste" && (
        <>
          <p className="text-sm text-gray-500 mb-4">
            Din administratör har skapat ett konto åt dig och delat en PAT
            (Personal Access Token) via säker kanal. Klistra in den nedan.
          </p>
          <form onSubmit={onPasteSubmit} className="bg-white border border-gray-200 rounded-lg p-5 space-y-3">
            <label className="block">
              <span className="text-xs text-gray-700 mb-1 block">E-post</span>
              <input
                type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="anna@firma.se"
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-700 mb-1 block">Visningsnamn (för commit-signaturer)</span>
              <input
                type="text" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Anna Advokat"
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-700 mb-1 block">PAT (från admin)</span>
              <input
                type="password" required value={pat} onChange={(e) => setPat(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono"
              />
            </label>
            {error && <p className="text-xs text-red-600"><AlertTriangle size={12} className="inline" /> {error}</p>}
            <button type="submit"
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">
              <KeyRound size={14} className="inline mr-1" /> Spara och logga in
            </button>
          </form>

          {hasAuthServer && (
            <details className="mt-4 text-xs text-gray-500">
              <summary className="cursor-pointer flex items-center gap-1">
                <Settings size={12} /> Avancerat: bootstrap admin / lös in invite-token
              </summary>
              <p className="mt-2 italic">
                Den valbara invite-server-profilen är aktiv. Du kan provisionera dig
                själv via{" "}
                <Link href="/setup/advanced" className="text-blue-600 hover:underline">
                  /setup/advanced
                </Link>{" "}
                om du har en bootstrap-secret eller invite-token istället för PAT.
              </p>
            </details>
          )}
        </>
      )}

      {stage === "done" && (
        <div className="bg-green-50 border border-green-200 rounded p-5">
          <p className="text-sm text-green-900 flex items-center gap-1">
            <Check size={14} /> {success ? "Inloggad" : "Du är redan inloggad"}
          </p>
          {success && (
            <p className="text-xs text-green-700 mt-1">
              Email: <strong>{success.email}</strong>
            </p>
          )}
          <Link href="/" className="inline-block mt-3 text-sm text-blue-600 hover:underline">
            → Till startsidan
          </Link>
        </div>
      )}
    </div>
  );
}

/** Snabb-probe: finns auth-servern? Tystas vid nätverksfel. */
async function probeAuthServer(): Promise<boolean> {
  try {
    const c = createAuthClient();
    await c.status();
    return true;
  } catch {
    return false;
  }
}
