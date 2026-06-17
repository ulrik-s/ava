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

import { useEffect, useRef, useState } from "react";
import { useDemoRuntime } from "@/lib/client/use-demo-runtime";
import { DemoRuntime } from "@/lib/server/local-first/demo-runtime";
import { createGhPagesCloneFn } from "@/lib/server/local-first/gh-pages-loader";
import { IndexedDbFsPersistence } from "@/lib/server/local-first/indexeddb-fs-persistence";

/**
 * Default demo-data-repo. Användare kan klistra in eget om de vill,
 * men 99% vill bara klicka in och se nåt. Override via
 * NEXT_PUBLIC_DEFAULT_DEMO_REPO vid build-time.
 */
const DEFAULT_DEMO_REPO =
  process.env.NEXT_PUBLIC_DEFAULT_DEMO_REPO ?? "ulrik-s/ava-demo";

export interface DemoClientProps {
  /**
   * Valfri runtime-factory. Default = GH Pages-loader + OPFS-persistens.
   * Tester injicerar en fake. Server Components MÅSTE INTE passa
   * funktioner till Client Components (Next 16/RSC) — därför är
   * prop:en optional och defaultas till client-side-konstruktion.
   */
  runtimeFactory?: () => DemoRuntime;
  /**
   * Default-repo som auto-laddas vid mount. Sätt till tom sträng
   * för att kräva användar-input (gamla beteendet). Override via
   * `NEXT_PUBLIC_DEFAULT_DEMO_REPO` vid build-time.
   */
  defaultRepo?: string;
}

function defaultRuntimeFactory(): DemoRuntime {
  // GH Pages som data-källa: inget CORS-proxy-beroende, ingen
  // isomorphic-git, ingen git-historik — bara filer-via-CDN. Se
  // `gh-pages-loader.ts` för detaljer. För full git-historik
  // (Tauri/Node-läget) använd `cloneFromGithub()` istället.
  // IndexedDB-persistens (#3): slab-snapshotten cachas i IndexedDB (samma nyckel
  // som förr) i st.f. OPFS — populerar demo-cachen utan OPFS-beroende.
  return DemoRuntime.create({
    cloneFn: createGhPagesCloneFn(),
    persistence: new IndexedDbFsPersistence("ava-demo"),
  });
}

interface MatterLike { id: string; matterNumber: string; title: string; status: string }
interface ContactLike { id: string; name: string; contactType: string; email?: string | null }
interface UserLike { id: string; email: string; name: string; role: string }

export function DemoClient({
  runtimeFactory = defaultRuntimeFactory,
  defaultRepo = DEFAULT_DEMO_REPO,
}: DemoClientProps) {
  const { status, error, entities, loadDemo, fromCache } = useDemoRuntime(runtimeFactory);
  const [url, setUrl] = useState(defaultRepo);
  // Ref istället för state — vi vill inte trigga rerender när flaggan
  // sätts (React 19:s set-state-in-effect-regel skulle annars klaga).
  const autoLoadAttempted = useRef(false);

  const matters = (entities.matter ?? []) as MatterLike[];
  const contacts = (entities.contact ?? []) as ContactLike[];
  const users = (entities.user ?? []) as UserLike[];

  async function handleLoad(): Promise<void> {
    if (!url.trim()) return;
    try { await loadDemo(url.trim()); } catch { /* error visas via state */ }
  }

  // Auto-load default-repo vid mount så användaren får en komplett
  // upplevelse direkt utan att behöva mecka med inställningar.
  // Triggar bara en gång och bara om vi inte redan har data (från
  // OPFS-cache via useDemoRuntime:s restoreFromCache).
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
      <DemoStatusBanners status={status} error={error} fromCache={fromCache} />
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

interface StatusBannersProps { status: string; error: { message: string } | null; fromCache: boolean }

/** Status-banners (laddar / fel / cachad data). */
function DemoStatusBanners({ status, error, fromCache }: StatusBannersProps) {
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
      {status === "loaded" && fromCache && (
        <div className="p-3 bg-green-50 border-l-4 border-green-400 mb-4 text-sm">
          Visar cachad data från senaste session. Klicka &quot;Ladda demo&quot;
          för att hämta senaste version från GitHub.
        </div>
      )}
    </>
  );
}

interface ResultsProps { matters: MatterLike[]; contacts: ContactLike[]; users: UserLike[] }

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
