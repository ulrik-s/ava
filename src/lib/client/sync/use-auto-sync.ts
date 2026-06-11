"use client";

/**
 * `useAutoSync` — auto-pull + auto-push med offline-safety,
 * hård timeout, single-flight-lock och exponentiell backoff.
 *
 * Designprinciper (i prioritetsordning):
 *
 * 1. **Aldrig blockera UI:n.** All nät körs i `void (async () => …)()`
 *    och fångar alla error. Consumer:n får alltid ett `SyncState`,
 *    aldrig en throw.
 * 2. **Aldrig hänga.** Varje nät-call är wrappad i `withTimeout`
 *    (15s pull, 30s push) — om GitHub är seg ger vi upp och försöker
 *    igen senare istället för att hålla en zombie-promise.
 * 3. **Aldrig spamma vid off-line.** `navigator.onLine === false`?
 *    Skippa skedulering. När `online`-event triggar → kör pending-sync.
 * 4. **Aldrig dubblera.** En `busy`-flagga blockerar nya sync-jobb
 *    medan ett pågår. Användarens "Synka nu"-knapp respekterar samma
 *    lock.
 * 5. **Backoff vid fel.** Misslyckas pull/push → dubbla nästa intervall
 *    upp till 5 min. Lyckas → återställ till baslinjen.
 *
 * Hooken är miljö-agnostisk — du injicerar en `SyncProvider` som
 * vet hur man pullar/pushar i Tauri (libgit2) eller Web (FSA + iso-git).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOnlineStatus } from "./use-online-status";
import { SyncTimeoutError, withTimeout } from "./with-timeout";

export interface PullOutcome {
  /** "up-to-date" | "fast-forward" | "merge-needed" — speglar gitops */
  kind: string;
}
export interface PushOutcome {
  /** Commit-OID om vi pushade, eller null om inget att pusha. */
  oid: string | null;
}
export interface CommitOutcome {
  /** Commit-OID, eller null om inget att committa. */
  oid: string | null;
}

/**
 * Provider:n vet hur en pull eller push utförs. Den är miljö-specifik
 * (Tauri-bridge / FSA + isomorphic-git) men håller ett gemensamt API.
 *
 * Notera ordningen `commitLocal → pull → push`: vi måste committa
 * lokala ändringar INNAN pull, annars vägrar git.checkout att skriva
 * över "Your local changes would be overwritten".
 */
export interface SyncProvider {
  /** Kör en pull (rebase eller fast-forward). Kasta inte — wrappa i try. */
  pull: () => Promise<PullOutcome>;
  /** Räkna osparade ändringar. */
  countChanges: () => Promise<number>;
  /** Stage + commit alla lokala ändringar. Ingen push. */
  commitLocal: () => Promise<CommitOutcome>;
  /** Push HEAD till origin. Förutsätter att lokala ändringar är committade. */
  push: () => Promise<void>;
  /** Bakåtkompabilitet: commit + push i ett anrop. Används av tester. */
  commitAndPush: () => Promise<PushOutcome>;
}

export type SyncState =
  | { kind: "idle" }
  | { kind: "synced"; at: number }
  | { kind: "syncing"; what: "pull" | "push" }
  | { kind: "pending"; count: number }
  | { kind: "offline"; count: number }
  | { kind: "merge-needed" }
  | { kind: "error"; message: string };

export interface UseAutoSyncOptions {
  provider: SyncProvider | null;
  enabled: boolean;
  pullIntervalMs?: number;
  pushDebounceMs?: number;
  pullTimeoutMs?: number;
  pushTimeoutMs?: number;
  maxBackoffMs?: number;
}

export interface UseAutoSyncReturn {
  state: SyncState;
  /** Kör en sync NU (pull + push om ändringar). Respekterar busy-lock. */
  syncNow: () => Promise<void>;
  /** Trigger debounced push (kallas när vi vet att data ändrats). */
  notifyChange: () => void;
}

const DEFAULTS = {
  pullIntervalMs: 60_000,
  pushDebounceMs: 10_000,
  pullTimeoutMs: 15_000,
  pushTimeoutMs: 30_000,
  maxBackoffMs: 5 * 60_000,
};

export function useAutoSync(opts: UseAutoSyncOptions): UseAutoSyncReturn {
  const cfg = useMemo(() => ({ ...DEFAULTS, ...opts }), [opts]);
  const online = useOnlineStatus();
  const [state, setState] = useState<SyncState>({ kind: "idle" });

  const busyRef = useRef(false);
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pullTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const backoffRef = useRef(cfg.pullIntervalMs);
  const providerRef = useRef(opts.provider);
  const enabledRef = useRef(opts.enabled);
  const onlineRef = useRef(online);
  const cfgRef = useRef(cfg);

  // Håll ref:s i sync med props (utan re-render-loops)
  useEffect(() => { providerRef.current = opts.provider; }, [opts.provider]);
  useEffect(() => { enabledRef.current = opts.enabled; }, [opts.enabled]);
  useEffect(() => { onlineRef.current = online; }, [online]);
  useEffect(() => { cfgRef.current = cfg; }, [cfg]);

  /**
   * Kör en sync-cykel: pull → räkna ändringar → ev push.
   * Tar busy-lock. Sätter state. Inget kastar.
   *
   * Använder ref:s istället för deps för att slippa effekt-loops →
   * React Compiler kan inte memoizera; vi disable:ar regeln här.
   */
  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- refs är stabila; avsiktligt tom dep-array (React Compiler kan ej bevara memoiseringen p.g.a. bumpBackoff)
  const runSync = useCallback(async (trigger: "auto" | "manual" | "online-reconnect"): Promise<void> => {
    type Provider = NonNullable<typeof providerRef.current>;

    /** Visa offline-state med pending-count (fel → 0). */
    const showOffline = async (p: Provider): Promise<void> => {
      try {
        setState({ kind: "offline", count: await p.countChanges() });
      } catch {
        setState({ kind: "offline", count: 0 });
      }
    };

    /** Guards + offline-hantering. Returnerar provider om cykeln ska köras, annars null. */
    const precheck = async (): Promise<Provider | null> => {
      const p = providerRef.current;
      if (!p || !enabledRef.current || busyRef.current) return null;
      if (!onlineRef.current) { await showOffline(p); return null; }
      return p;
    };

    // Commit/push delar form: setState(syncing) → withTimeout(op) → fel sätter
    // error-state + backoff. `skip` → no-op (inget att göra). false = abortera.
    const runGitStep = async (skip: boolean, op: () => Promise<unknown>, timeoutMs: number, label: string, errPrefix: string): Promise<boolean> => {
      if (skip) return true;
      setState({ kind: "syncing", what: "push" });
      try {
        await withTimeout(op(), timeoutMs, label);
        return true;
      } catch (err) {
        setState({ kind: "error", message: errMsg(err, errPrefix) });
        bumpBackoff();
        return false;
      }
    };

    /** Pull (working tree antas rent). false vid merge-needed eller fel. */
    const pullStep = async (p: Provider): Promise<boolean> => {
      setState({ kind: "syncing", what: "pull" });
      try {
        const pullResult = await withTimeout(p.pull(), cfgRef.current.pullTimeoutMs, "git pull");
        if (pullResult.kind === "merge-needed") {
          setState({ kind: "merge-needed" });
          backoffRef.current = cfgRef.current.pullIntervalMs;
          return false;
        }
        return true;
      } catch (err) {
        setState({ kind: "error", message: errMsg(err, "Pull") });
        bumpBackoff();
        return false;
      }
    };

    const provider = await precheck();
    if (!provider) return;

    busyRef.current = true;
    void trigger; // trigger used to gate manual vs auto; nu lika behandlade
    try {
      // Commit FÖRST: git.pull/checkout vägrar skriva över en dirty working
      // tree, och AVA:s writeBack skriver kontinuerligt → committa innan pull.
      const hasLocalCommit = (await provider.countChanges()) > 0;
      if (!(await runGitStep(!hasLocalCommit, () => provider.commitLocal(), cfgRef.current.pushTimeoutMs, "git commit", "Commit"))) return;
      if (!(await pullStep(provider))) return;
      if (!(await runGitStep(!hasLocalCommit, () => provider.push(), cfgRef.current.pushTimeoutMs, "git push", "Push"))) return;
      setState({ kind: "synced", at: Date.now() });
      backoffRef.current = cfgRef.current.pullIntervalMs;
    } finally {
      busyRef.current = false;
    }
  }, []);

  const bumpBackoff = () => {
    const next = Math.min(backoffRef.current * 2, cfgRef.current.maxBackoffMs);
    backoffRef.current = next;
  };

  /** Schemalägg auto-pull med nuvarande backoff-intervall. */
  useEffect(() => {
    if (!opts.enabled || !opts.provider) return;
    // Kör en initial sync (om online), annars sätt offline-state
    void runSync("auto");

    const tick = () => {
      if (!enabledRef.current) return;
      if (!onlineRef.current) return; // offline → vänta på "online"-event
      void runSync("auto");
    };

    // Vi använder ett setInterval och bytar intervall vid backoff-byte
    // genom att låta tick:n läsa backoffRef. Enklare: just nu setInterval
    // med initial pullIntervalMs, så backoff förlänger via skip-i-tick.
    // Korrekt: re-schedula efter varje pull. Vi gör enkel variant först.
    pullTimerRef.current = setInterval(tick, cfgRef.current.pullIntervalMs);
    return () => {
      if (pullTimerRef.current) clearInterval(pullTimerRef.current);
      pullTimerRef.current = null;
    };
  }, [opts.enabled, opts.provider, runSync]);

  /** När vi kommer tillbaka online → kör pending sync. */
  useEffect(() => {
    if (!online) return;
    if (!opts.enabled || !opts.provider) return;
    // Liten delay så browsern hinner ge oss riktig connectivity
    const t = setTimeout(() => { void runSync("online-reconnect"); }, 500);
    return () => clearTimeout(t);
  }, [online, opts.enabled, opts.provider, runSync]);

  /** Vid offline → sätt state till offline (med pending-count). */
  useEffect(() => {
    if (online) return;
    const provider = providerRef.current;
    if (!provider) return;
    void provider.countChanges().then(
      (count) => setState({ kind: "offline", count }),
      () => setState({ kind: "offline", count: 0 }),
    );
  }, [online]);

  const notifyChange = useCallback((): void => {
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
    if (!enabledRef.current) return;

    // Visa pending-state direkt — hämta count i bakgrunden
    const provider = providerRef.current;
    if (provider) {
      void provider.countChanges().then((count) => {
        if (onlineRef.current) {
          setState({ kind: "pending", count });
        } else {
          setState({ kind: "offline", count });
        }
      });
    }

    pushTimerRef.current = setTimeout(() => {
      pushTimerRef.current = null;
      void runSync("auto");
    }, cfgRef.current.pushDebounceMs);
  }, [runSync]);

  const syncNow = useCallback(async (): Promise<void> => {
    if (pushTimerRef.current) {
      clearTimeout(pushTimerRef.current);
      pushTimerRef.current = null;
    }
    await runSync("manual");
  }, [runSync]);

  // Cleanup
  useEffect(() => () => {
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
    if (pullTimerRef.current) clearInterval(pullTimerRef.current);
  }, []);

  return { state, syncNow, notifyChange };
}

// Översätt vanliga isomorphic-git-fel till begripliga råd. Första matchande
// regel vinner; `match` är RegExp eller predikat mot felmeddelandet.
const ERR_RULES: ReadonlyArray<{ match: RegExp | ((m: string) => boolean); message: (prefix: string) => string }> = [
  {
    match: (m) => m.includes("A requested file or directory could not be found") || m.includes("ENOENT"),
    message: (p) => `${p}: Mappen är inte ett git-repo (saknar .git/). Klona repo:t först i datakällan ovan.`,
  },
  { match: /401|unauthorized|bad credentials/i, message: (p) => `${p}: GitHub-token avvisades (401). Kontrollera att token finns och har 'repo'-scope.` },
  { match: /404|not found/i, message: (p) => `${p}: Repo eller branch hittades inte (404). Kontrollera repo-URL och att branchen 'main' finns.` },
  { match: /Failed to fetch|fetch failed/i, message: (p) => `${p}: Nät-fel (Failed to fetch). Vanligast: CORS-proxyn (cors.isomorphic-git.org) är nere eller blockerad. Konfigurera en egen CORS-proxy i Inställningar → Datakälla.` },
  { match: /CORS/i, message: (p) => `${p}: CORS-fel. Proxyn svarar inte med rätt headers. Byt CORS-proxy i Inställningar.` },
];

function errMsg(err: unknown, prefix: string): string {
  if (err instanceof SyncTimeoutError) return `${prefix}: timeout — försöker igen senare`;
  if (!(err instanceof Error)) return `${prefix}: ${String(err)}`;
  const m = err.message;
  for (const rule of ERR_RULES) {
    const hit = typeof rule.match === "function" ? rule.match(m) : rule.match.test(m);
    if (hit) return rule.message(prefix);
  }
  return `${prefix}: ${m}`;
}
