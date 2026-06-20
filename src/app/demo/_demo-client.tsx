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
import { z } from "zod";
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

// `DemoSource`-fälten är medvetet otypad JSON (`Record<string, unknown>`).
// Vi zod-parsar varje rad vid konsumtions-gränsen (extern data → strikt
// parsning) och härleder vy-typerna via `z.infer` i stället för handskrivna
// interfaces. Okända fält strippas; en rad som inte matchar droppas (se
// `narrowRows`) i stället för att krascha hela demon.
const matterRowSchema = z.object({
  id: z.string(),
  matterNumber: z.string(),
  title: z.string(),
  status: z.string(),
});
const contactRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  contactType: z.string(),
  email: z.string().nullish().transform((v) => v ?? null),
});
const userRowSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.string(),
});

type MatterLike = z.infer<typeof matterRowSchema>;
type ContactLike = z.infer<typeof contactRowSchema>;
type UserLike = z.infer<typeof userRowSchema>;

/** Parsa varje rad; behåll bara de som matchar schemat (drop-on-mismatch). */
function narrowRows<T>(
  rows: readonly Record<string, unknown>[] | undefined,
  schema: z.ZodType<T>,
): readonly T[] {
  return (rows ?? []).flatMap((row) => {
    const parsed = schema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

export function DemoClient({
  loader = loadBundledSeed,
  defaultRepo = DEFAULT_DEMO_REPO,
}: DemoClientProps) {
  const { status, error, source, loadDemo } = useDemoSeed(loader);
  const [url, setUrl] = useState(defaultRepo);
  // Ref istället för state — vi vill inte trigga rerender när flaggan sätts.
  const autoLoadAttempted = useRef(false);

  // Narrowa de otypade JSON-raderna till vy-typerna via zod (se schemana ovan).
  const matters = narrowRows(source.matters, matterRowSchema);
  const contacts = narrowRows(source.contacts, contactRowSchema);
  const users = narrowRows(source.users, userRowSchema);

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
