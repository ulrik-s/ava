"use client";

/**
 * `DemoClient` — Client Component som visar AVA i read-only demo-läge.
 *
 * Designval (Single responsibility):
 *   - Bara UI. Ingen affärslogik här — all state hanteras av
 *     `useDemoRuntime`-hooken.
 *
 * Designval (DI):
 *   - `runtimeFactory` propas in → tester kan injicera en fake utan att
 *     röra browserns isomorphic-git/http. Produktion använder
 *     `cloneFromGithub()`.
 *
 * UI: enkel landing — input för URL + Ladda-knapp + listor per entitet.
 * Stylas senare; just nu plain Tailwind-klasser för läsbarhet.
 */

import { useState } from "react";
import type { DemoRuntime } from "@/server/local-first/demo-runtime";
import { useDemoRuntime } from "@/lib/use-demo-runtime";

export interface DemoClientProps {
  runtimeFactory: () => DemoRuntime;
}

interface MatterLike { id: string; matterNumber: string; title: string; status: string }
interface ContactLike { id: string; name: string; contactType: string; email?: string | null }
interface UserLike { id: string; email: string; name: string; role: string }

export function DemoClient({ runtimeFactory }: DemoClientProps) {
  const { status, error, entities, loadDemo } = useDemoRuntime(runtimeFactory);
  const [url, setUrl] = useState("");

  const matters = (entities.matter ?? []) as MatterLike[];
  const contacts = (entities.contact ?? []) as ContactLike[];
  const users = (entities.user ?? []) as UserLike[];

  async function handleLoad(): Promise<void> {
    if (!url.trim()) return;
    try { await loadDemo(url.trim()); } catch { /* error visas via state */ }
  }

  return (
    <div className="mx-auto max-w-4xl p-8">
      <h1 className="text-3xl font-bold mb-2">AVA Demo</h1>
      <p className="mb-6 text-gray-600">
        Klistra in en publik GitHub-repo-url med AVA-demo-data. Allt körs
        lokalt i din webbläsare — ingen data lämnar din enhet.
      </p>

      <div className="flex gap-2 mb-6">
        <input
          type="url"
          aria-label="GitHub-url"
          placeholder="https://github.com/användare/ava-demo.git"
          className="flex-1 px-3 py-2 border rounded"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void handleLoad(); }}
        />
        <button
          type="button"
          onClick={() => void handleLoad()}
          disabled={status === "loading"}
          className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
        >
          Ladda demo
        </button>
      </div>

      {status === "loading" && (
        <div className="p-4 bg-blue-50 border-l-4 border-blue-400 mb-4">
          Laddar demo-data…
        </div>
      )}

      {status === "error" && error && (
        <div className="p-4 bg-red-50 border-l-4 border-red-400 mb-4">
          <strong>Kunde inte ladda demon:</strong> {error.message}
        </div>
      )}

      {status === "loaded" && (
        <div className="space-y-6">
          <SummaryRow
            counts={{
              ärenden: matters.length,
              kontakter: contacts.length,
              användare: users.length,
            }}
          />
          {matters.length > 0 && (
            <Section title="Ärenden">
              <ul className="divide-y border rounded">
                {matters.map((m) => (
                  <li key={m.id} className="p-3 flex justify-between">
                    <span>
                      <span className="font-mono text-sm text-gray-500 mr-2">{m.matterNumber}</span>
                      {m.title}
                    </span>
                    <span className="text-sm text-gray-500">{m.status}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {contacts.length > 0 && (
            <Section title="Kontakter">
              <ul className="divide-y border rounded">
                {contacts.map((c) => (
                  <li key={c.id} className="p-3">
                    {c.name}
                    {c.email && <span className="ml-2 text-sm text-gray-500">{c.email}</span>}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {users.length > 0 && (
            <Section title="Användare">
              <ul className="divide-y border rounded">
                {users.map((u) => (
                  <li key={u.id} className="p-3 flex justify-between">
                    <span>{u.name}</span>
                    <span className="text-sm text-gray-500">{u.email} · {u.role}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold mb-2">{title}</h2>
      {children}
    </section>
  );
}

function SummaryRow({ counts }: { counts: Record<string, number> }) {
  return (
    <div className="flex gap-4 text-sm">
      {Object.entries(counts).map(([label, n]) => (
        <span key={label} className="px-3 py-1 bg-gray-100 rounded">
          {n} {label}
        </span>
      ))}
    </div>
  );
}
