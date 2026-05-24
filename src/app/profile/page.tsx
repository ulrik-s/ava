"use client";

/**
 * `/profile` — egen profil. Gerrit-style: ingen "login", men du kan
 * uppdatera dina uppgifter och registrera SSH/GPG-nycklar som signerar
 * dina commits.
 *
 * Admin kan komma åt andra användares profiler via `/users` (men
 * inte deras nycklar — de är privata).
 */

import { useEffect, useState } from "react";
import { trpc } from "@/client/lib/trpc";
import { User, KeyRound, Plus, Trash2 } from "lucide-react";
import { IntegrationsSection } from "@/client/components/integrations-section";
import { KeypairManager } from "@/client/components/keypair-manager";

interface PublicKey {
  fingerprint: string;
  type: "ssh-ed25519" | "ssh-rsa" | "ssh-ecdsa" | "gpg";
  publicKey: string;
  comment?: string;
  addedAt: string;
}

export default function ProfilePage() {
  const me = trpc.user.current.useQuery();
  const utils = trpc.useUtils();
  const updateUser = trpc.user.update.useMutation({ onSuccess: () => utils.user.current.invalidate() });
  const addKey = trpc.user.addKey.useMutation({ onSuccess: () => utils.user.current.invalidate() });
  const removeKey = trpc.user.removeKey.useMutation({ onSuccess: () => utils.user.current.invalidate() });

  const [form, setForm] = useState({ name: "", title: "", email: "" });
  const [formReady, setFormReady] = useState(false);

  useEffect(() => {
    if (me.data && !formReady) {
      queueMicrotask(() => {
        if (!me.data) return;
        setForm({
          name: me.data.name ?? "",
          title: me.data.title ?? "",
          email: me.data.email ?? "",
        });
        setFormReady(true);
      });
    }
  }, [me.data, formReady]);

  if (me.isLoading) return <div className="p-6 text-sm text-gray-500">Laddar profil…</div>;
  if (!me.data) return <div className="p-6 text-sm text-red-600">Kunde inte ladda profil.</div>;

  const u = me.data as typeof me.data & { publicKeys?: PublicKey[] };
  const keys: PublicKey[] = Array.isArray(u.publicKeys) ? u.publicKeys : [];

  const saveProfile = () => {
    updateUser.mutate({ id: u.id, name: form.name, title: form.title || null, email: form.email });
  };

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <User size={22} /> Min profil
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Dina uppgifter syns för hela firman. Dina nycklar är privata och
          används för att signera dina commits.
        </p>
      </div>

      {/* Basinfo */}
      <section className="bg-white border border-gray-200 rounded-lg p-5 mb-5">
        <h2 className="font-semibold text-gray-900 mb-3">Dina uppgifter</h2>
        <div className="space-y-3 text-sm">
          <Field label="Namn">
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="Titel">
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="t.ex. Advokat / Biträdande jurist"
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="E-post">
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="Roll">
            <div className="text-sm text-gray-700">{u.role}
              <span className="text-xs text-gray-400 ml-2">(ändras av admin)</span>
            </div>
          </Field>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={saveProfile}
            disabled={updateUser.isPending}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {updateUser.isPending ? "Sparar…" : "Spara"}
          </button>
          {updateUser.error && <span className="text-xs text-red-600">{updateUser.error.message}</span>}
        </div>
      </section>

      {/* Publika nycklar */}
      <KeysSection
        keys={keys}
        onAdd={(k) => addKey.mutate(k)}
        onRemove={(fp) => removeKey.mutate({ fingerprint: fp })}
        addErr={addKey.error?.message ?? null}
        onAddGenerated={({ sshPublicKey, fingerprint: fp, comment }) =>
          addKey.mutate({
            fingerprint: fp,
            type: "ssh-ed25519",
            publicKey: sshPublicKey,
            comment,
            addedAt: new Date().toISOString(),
          })
        }
        addingGenerated={addKey.isPending}
      />

      {/* Anslutna tjänster (O365, Google, …) */}
      <IntegrationsSection />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-500 mb-1 block">{label}</span>
      {children}
    </label>
  );
}

interface KeysSectionProps {
  keys: PublicKey[];
  onAdd: (key: PublicKey) => void;
  onRemove: (fingerprint: string) => void;
  addErr: string | null;
  onAddGenerated: (args: { sshPublicKey: string; fingerprint: string; comment: string }) => void;
  addingGenerated: boolean;
}

function KeysSection({ keys, onAdd, onRemove, addErr, onAddGenerated, addingGenerated }: KeysSectionProps) {
  const [adding, setAdding] = useState(false);
  const [input, setInput] = useState("");
  const [comment, setComment] = useState("");

  const tryAdd = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    const parsed = await parseSshPublicKey(trimmed);
    if (!parsed) {
      alert("Kunde inte tolka nyckeln. Förväntar format som\n  ssh-ed25519 AAAA… kommentar");
      return;
    }
    onAdd({
      fingerprint: parsed.fingerprint,
      type: parsed.type,
      publicKey: trimmed,
      comment: comment || parsed.comment,
      addedAt: new Date().toISOString(),
    });
    setInput("");
    setComment("");
    setAdding(false);
  };

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-5 mb-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <KeyRound size={16} /> Publika nycklar
        </h2>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-xs px-2 py-1 bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50 inline-flex items-center gap-1"
          >
            <Plus size={12} /> Lägg till nyckel
          </button>
        )}
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Lägg till SSH-nycklar (ed25519 rekommenderas) för att signera dina
        commits. Nycklarna är privata — bara du ser dem.
      </p>

      {keys.length === 0 && !adding && (
        <p className="text-sm text-gray-400 italic mb-4">Inga nycklar registrerade ännu.</p>
      )}

      <KeypairManager onAddToProfile={onAddGenerated} saving={addingGenerated} />

      <div className="mt-4 text-xs text-gray-500">
        eller klistra in en nyckel som genererats utanför AVA (
        <code>ssh-keygen -t ed25519</code>):
      </div>

      <ul className="space-y-2">
        {keys.map((k) => (
          <li key={k.fingerprint} className="flex items-start justify-between gap-3 py-2 border-b border-gray-100 last:border-0">
            <div className="min-w-0">
              <div className="text-sm font-mono text-gray-900">{k.fingerprint}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                {k.type} {k.comment && `· ${k.comment}`}
                <span className="ml-2 text-gray-400">tillagd {new Date(k.addedAt).toLocaleDateString("sv-SE")}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => { if (confirm(`Ta bort nyckeln ${k.fingerprint}?`)) onRemove(k.fingerprint); }}
              className="text-xs text-gray-400 hover:text-red-600 inline-flex items-center gap-1"
              title="Ta bort"
            >
              <Trash2 size={12} /> Ta bort
            </button>
          </li>
        ))}
      </ul>

      {adding && (
        <div className="mt-4 bg-blue-50 border border-blue-200 rounded p-3 space-y-2">
          <label className="block">
            <span className="text-xs text-blue-900 mb-1 block">Publik nyckel (innehåll från ~/.ssh/id_ed25519.pub)</span>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="ssh-ed25519 AAAA... du@dator"
              rows={3}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs font-mono"
            />
          </label>
          <label className="block">
            <span className="text-xs text-blue-900 mb-1 block">Kommentar (valfri, t.ex. enhetens namn)</span>
            <input
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="MacBook Pro 2024"
              className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
            />
          </label>
          {addErr && <p className="text-xs text-red-700">{addErr}</p>}
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => { setAdding(false); setInput(""); setComment(""); }}
              className="text-xs text-gray-500 hover:underline"
            >
              Avbryt
            </button>
            <button
              type="button"
              onClick={() => void tryAdd()}
              className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Lägg till
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Lätt SSH-pubkey-parsing — extraherar typ, base64-body, kommentar.
 * Beräknar SHA-256-fingerprint i ssh-keygen-format via WebCrypto.
 */
async function parseSshPublicKey(raw: string): Promise<{ type: PublicKey["type"]; fingerprint: string; comment: string } | null> {
  const parts = raw.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const typeMap: Record<string, PublicKey["type"]> = {
    "ssh-ed25519": "ssh-ed25519",
    "ssh-rsa": "ssh-rsa",
    "ecdsa-sha2-nistp256": "ssh-ecdsa",
    "ecdsa-sha2-nistp384": "ssh-ecdsa",
    "ecdsa-sha2-nistp521": "ssh-ecdsa",
  };
  const type = typeMap[parts[0]];
  if (!type) return null;
  // Riktig SHA-256-fingerprint via crypto.subtle på den base64-decodade
  // wire-format-blob:n. För Ed25519 är decodad blob 51 bytes (4+11+4+32).
  const blob = base64ToBytes(parts[1]);
  const digest = await crypto.subtle.digest("SHA-256", blob.buffer as ArrayBuffer);
  const fp = "SHA256:" + bytesToBase64(new Uint8Array(digest)).replace(/=+$/, "");
  const comment = parts.slice(2).join(" ");
  return { type, fingerprint: fp, comment };
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
