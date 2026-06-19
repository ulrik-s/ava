"use client";

/**
 * `DemoClient` — Client Component som visar AVA i read-only demo-läge.
 *
 * Designval (Single responsibility):
 *   - Bara UI. All data-laddning sköts av `useDemoSeed`-hooken som fetchar
 *     en `DemoSource` direkt från GH Pages (ADR 0016, #420 — ingen MemFs/runtime).
 *
 * Designval (DI):
 *   - `loader` propas in → tester kan injicera en fake utan att röra
 *     `fetch`/GH Pages. Produktion använder `loadDemoSeed`.
 *
 * UI: enkel landing — input för URL + Ladda-knapp + listor per entitet.
 */

import { useEffect, useRef, useState } from "react";
import { loadBundledSeed } from "@/lib/client/demo/bundled-seed-loader";
import { useDemoSeed } from "@/lib/client/demo/use-demo-seed";
import type { DemoSource } from "@/lib/shared/demo-source";

/**
 * Default demo-data-repo. Användare kan klistra in eget om de vill,
 * men 99% vill bara klicka in och se nåt. Override via
 * NEXT_PUBLIC_DEFAULT_DEMO_REPO vid build-time.
 */
const DEFAULT_DEMO_REPO =
  process.env.NEXT_PUBLIC_DEFAULT_DEMO_REPO ?? "ulrik-s/ava-demo";

export interface DemoClientProps {
  /**
   * Valfri seed-loader. Default = bundlad `demo-seed.json` (`loadBundledSeed`,
   * ADR 0025). Tester injicerar en fake. Server Components MÅSTE INTE passa
   * funktioner till Client Components (Next 16/RSC) — därför är prop:en optional.
   */
  loader?: (repo: string) => Promise<DemoSource>;
  /**
   * Default-repo som auto-laddas vid mount. Sätt till tom sträng för att
   * kräva användar-input. Override via `NEXT_PUBLIC_DEFAULT_DEMO_REPO`.
   */
  defaultRepo?: string;
}

interface MatterLike { id: string; matterNumber: string; title: string; status: string }
interface ContactLike { id: string; name: string; contactType: string; email?: string | null }
interface UserLike { id: string; email: string; name: string; role: string }

export function DemoClient({
  loader = loadBundledSeed,
  defaultRepo = DEFAULT_DEMO_REPO,
}: DemoClientProps) {
  const { status, error, source, loadDemo } = useDemoSeed(loader);
  const [url, setUrl] = useState(defaultRepo);
  // Ref istället för state — vi vill inte trigga rerender när flaggan sätts.
  const autoLoadAttempted = useRef(false);

  // `DemoSource`-fälten är medvetet otypad JSON (`Record<string, unknown>`) —
  // narrowa varje fält till vy-typen vid konsumtions-gränsen.
  const matters: readonly MatterLike[] = (source.matters ?? []).map((m) => ({
    id: m.id as string,
    matterNumber: m.matterNumber as string,
    title: m.title as string,
    status: m.status as string,
  }));
  const contacts: readonly ContactLike[] = (source.contacts ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    contactType: c.contactType as string,
    email: (c.email ?? null) as string | null,
  }));
  const users: readonly UserLike[] = (source.users ?? []).map((u) => ({
    id: u.id as string,
    email: u.email as string,
    name: u.name as string,
    role: u.role as string,
  }));

  async function handleLoad(): Promise<void> {
    if (!url.trim()) return;
    try { await loadDemo(url.trim()); } catch { /* error visas via state */ }
  }

  // Auto-load default-repo vid mount så användaren får en komplett upplevelse
  // direkt. Triggar bara en gång och bara om vi inte redan laddat.
  useEffect(() => {
    if (autoLoadAttempted.current) return;
    if (status !== "idle") return;
    if (!defaultRepo) return;
    autoLoadAttempted.current = true;
    void loadDemo(defaultRepo).catch(() => { /* error visas via state */ });
  }, [status, defaultRepo, loadDemo]);

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6 md:p-8">
      <h1 className="text-2xl sm:text-3xl font-bold mb-2">AVA Demo</h1>
      <p className="mb-4 sm:mb-6 text-sm sm:text-base text-gray-600">
        Allt körs lokalt i din webbläsare — ingen data lämnar din enhet.
        Demo-datan laddas automatiskt från standard-repo:t. Vill du
        prova din egen demo-data? Klistra in en annan publik
        GitHub-repo-URL nedan.
      </p>

      <DemoLoadForm url={url} onUrlChange={setUrl} onLoad={() => void handleLoad()} loading={status === "loading"} />
      <DemoStatusBanners status={status} error={error} />
      {status === "loaded" && <DemoResults matters={matters} contacts={contacts} users={users} />}
    </div>
  );
}

interface LoadFormProps { url: string; onUrlChange: (v: string) => void; onLoad: () => void; loading: boolean }

/** URL-input + Ladda-knapp (stackar på mobil, touch-target min-h-12). */
function DemoLoadForm({ url, onUrlChange, onLoad, loading }: LoadFormProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-2 mb-6">
      <input
        type="url"
        inputMode="url"
        autoComplete="off"
        autoCapitalize="off"
        aria-label="GitHub-url"
        placeholder="användare/ava-demo"
        className="flex-1 min-h-12 px-3 border rounded text-base"
        value={url}
        onChange={(e) => onUrlChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onLoad(); }}
      />
      <button
        type="button"
        onClick={onLoad}
        disabled={loading}
        className="min-h-12 px-6 bg-blue-600 text-white rounded font-medium disabled:opacity-50 active:bg-blue-700"
      >
        Ladda demo
      </button>
    </div>
  );
}

interface StatusBannersProps { status: string; error: { message: string } | null }

/** Status-banners (laddar / fel). */
function DemoStatusBanners({ status, error }: StatusBannersProps) {
  return (
    <>
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
    </>
  );
}

interface ResultsProps { matters: readonly MatterLike[]; contacts: readonly ContactLike[]; users: readonly UserLike[] }

/** Resultat-vyn när demon laddats: summering + listor per entitet. */
function DemoResults({ matters, contacts, users }: ResultsProps) {
  return (
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
