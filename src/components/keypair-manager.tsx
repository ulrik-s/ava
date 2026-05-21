"use client";

/**
 * `KeypairManager` — UI för att generera ett Ed25519-nyckelpar i
 * browser:n och visa publika nyckeln i SSH-format.
 *
 * Privata nyckeln lagras i IndexedDB med `extractable: false` —
 * den lämnar aldrig den här enheten, inte ens via vår egen kod.
 *
 * Användarflöde:
 *   1. Klicka "Generera nytt nyckelpar" → WebCrypto skapar par
 *   2. Vi visar publika nyckeln + fingerprint + kommentar-fält
 *   3. Användaren kopierar publika nyckeln, registrerar den i
 *      sin profil ovanför OCH på GitHub (länk hjälper)
 *   4. För att radera: knapp "Glöm den här enheten"
 */

import { useEffect, useState } from "react";
import { KeyRound, Copy, ExternalLink, Trash2, RefreshCw } from "lucide-react";
import {
  generateKeypair, saveKeypair, loadKeypair, deleteKeypair,
  isEd25519Supported, type StoredKeypair,
} from "@/lib/keys/ed25519-keypair";
import { buildSshPublicKey, sshFingerprint } from "@/lib/keys/ssh-format";
import { registerSshKeyOnGithub } from "@/lib/github/register-ssh-key";
import { loadFirmaConfig } from "@/lib/firma/firma-config";

interface Props {
  /** Callback när användaren bekräftar att de vill addera nyckeln till profilen. */
  onAddToProfile: (args: { sshPublicKey: string; fingerprint: string; comment: string }) => void;
  /** Sätts till true medan vi sparar via tRPC. */
  saving?: boolean;
}

export function KeypairManager({ onAddToProfile, saving }: Props) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [keypair, setKeypair] = useState<StoredKeypair | null>(null);
  const [sshString, setSshString] = useState<string>("");
  const [fingerprint, setFingerprint] = useState<string>("");
  const [comment, setComment] = useState<string>(typeof navigator !== "undefined" ? defaultComment() : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [registeredOk, setRegisteredOk] = useState(false);

  const refreshDerived = async (kp: StoredKeypair) => {
    setSshString(buildSshPublicKey(kp.rawPublicKey, comment || undefined));
    setFingerprint(await sshFingerprint(kp.rawPublicKey));
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ok = await isEd25519Supported();
      if (cancelled) return;
      setSupported(ok);
      if (!ok) return;
      const existing = await loadKeypair();
      if (cancelled || !existing) return;
      setKeypair(existing);
      setSshString(buildSshPublicKey(existing.rawPublicKey, comment || undefined));
      setFingerprint(await sshFingerprint(existing.rawPublicKey));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onGenerate = async () => {
    setBusy(true); setErr(null);
    try {
      const kp = await generateKeypair();
      await saveKeypair(kp);
      setKeypair(kp);
      await refreshDerived(kp);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onForget = async () => {
    if (!confirm("Glöm den här enhetens privata nyckel? Du kan generera en ny när som helst, men nuvarande privata nyckel kan inte återställas.")) return;
    await deleteKeypair();
    setKeypair(null);
    setSshString(""); setFingerprint("");
  };

  const onCopy = async () => {
    if (!sshString) return;
    await navigator.clipboard.writeText(sshString);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const onAdd = () => {
    if (!sshString || !fingerprint) return;
    onAddToProfile({ sshPublicKey: sshString, fingerprint, comment: comment || "enhet" });
  };

  const onRegisterOnGithub = async () => {
    if (!sshString) return;
    const cfg = loadFirmaConfig();
    if (!cfg.token) {
      setErr("Saknar GitHub-token i Inställningar. Lägg till en PAT med scope 'admin:public_key' eller 'write:public_key'.");
      return;
    }
    setRegistering(true);
    setErr(null);
    setRegisteredOk(false);
    try {
      await registerSshKeyOnGithub({
        token: cfg.token,
        title: `AVA — ${comment || "enhet"}`,
        key: sshString,
      });
      setRegisteredOk(true);
      setTimeout(() => setRegisteredOk(false), 4000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRegistering(false);
    }
  };

  // Uppdatera SSH-string när comment ändras
  useEffect(() => {
    if (!keypair) return;
    queueMicrotask(() => {
      setSshString(buildSshPublicKey(keypair.rawPublicKey, comment || undefined));
    });
  }, [comment, keypair]);

  if (supported === null) {
    return <p className="text-xs text-gray-400">Kontrollerar webbläsarstöd…</p>;
  }
  if (!supported) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-900">
        Webbläsaren stöder inte WebCrypto Ed25519. Kräver Chrome 113+, Safari 17+ eller Firefox 130+.
        Du kan ändå klistra in en manuellt skapad SSH-nyckel ovan.
      </div>
    );
  }

  return (
    <div className="bg-gray-50 border border-gray-200 rounded p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <KeyRound size={14} /> Generera nyckel i browser
        </h3>
        {!keypair && (
          <button
            type="button"
            onClick={() => void onGenerate()}
            disabled={busy}
            className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 inline-flex items-center gap-1"
          >
            <RefreshCw size={12} className={busy ? "animate-spin" : ""} />
            {busy ? "Genererar…" : "Generera nytt nyckelpar"}
          </button>
        )}
      </div>

      <p className="text-xs text-gray-600">
        Vi skapar ett Ed25519-nyckelpar lokalt. Den privata nyckeln lagras i
        IndexedDB med <code className="bg-white px-1 rounded">extractable: false</code> —
        den lämnar aldrig den här enheten, inte ens via vår egen kod.
      </p>

      {err && <p className="text-xs text-red-700">✗ {err}</p>}

      {keypair && (
        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-gray-500 block mb-1">Kommentar (visas i SSH-strängen)</label>
            <input
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="anna@macbook"
              className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-gray-500">Publik nyckel (SSH-format)</span>
              <button
                type="button"
                onClick={() => void onCopy()}
                className="text-[11px] text-blue-600 hover:underline inline-flex items-center gap-1"
              >
                <Copy size={11} /> {copied ? "Kopierat!" : "Kopiera"}
              </button>
            </div>
            <textarea
              readOnly
              value={sshString}
              rows={3}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-[11px] font-mono bg-white"
            />
          </div>

          <div className="text-xs text-gray-600">
            <strong>Fingerprint:</strong> <code className="bg-white px-1 rounded">{fingerprint}</code>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onAdd}
              disabled={saving}
              className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300"
            >
              {saving ? "Lägger till…" : "Lägg till i min profil"}
            </button>
            <button
              type="button"
              onClick={() => void onRegisterOnGithub()}
              disabled={registering}
              className="text-xs px-3 py-1.5 bg-gray-900 text-white rounded hover:bg-gray-800 disabled:bg-gray-400 inline-flex items-center gap-1"
              title="POSTar direkt till api.github.com/user/keys"
            >
              {registering ? "Registrerar…" : registeredOk ? "✓ Registrerad" : "Registrera på GitHub (auto)"}
            </button>
            <a
              href="https://github.com/settings/ssh/new"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50 inline-flex items-center gap-1"
              title="Öppna GitHub manuellt"
            >
              <ExternalLink size={12} /> Manuellt
            </a>
            <button
              type="button"
              onClick={() => void onForget()}
              className="ml-auto text-xs text-gray-500 hover:text-red-600 inline-flex items-center gap-1"
            >
              <Trash2 size={12} /> Glöm enheten
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function defaultComment(): string {
  const ua = navigator.userAgent;
  if (/Mac/.test(ua)) return "anna@mac";
  if (/Windows/.test(ua)) return "anna@windows";
  if (/Linux/.test(ua)) return "anna@linux";
  return "anna@enhet";
}
