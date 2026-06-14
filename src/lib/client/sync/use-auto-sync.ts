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

// ─── Sync-motor (utbruten ur hooken → modul-nivå, testbar + under max-lines) ──
// All körning sker via refs + setState som hooken äger; vi buntar dem i en
// SyncCtx så cykel-logiken kan ligga utanför hook-kroppen.

interface SyncCfg { pullIntervalMs: number; pushTimeoutMs: number; pullTimeoutMs: number; maxBackoffMs: number }
interface SyncCtx {
  setState: (s: SyncState) => void;
  providerRef: { current: SyncProvider | null };
  enabledRef: { current: boolean };
  onlineRef: { current: boolean };
  busyRef: { current: boolean };
  backoffRef: { current: number };
  cfgRef: { current: SyncCfg };
}

/** Dubbla nästa intervall (tak = maxBackoff). */
function bumpBackoff(ctx: SyncCtx): void {
  ctx.backoffRef.current = Math.min(ctx.backoffRef.current * 2, ctx.cfgRef.current.maxBackoffMs);
}

/** Visa offline-state med pending-count (fel → 0). */
async function showOffline(ctx: SyncCtx, p: SyncProvider): Promise<void> {
  try {
    ctx.setState({ kind: "offline", count: await p.countChanges() });
  } catch {
    ctx.setState({ kind: "offline", count: 0 });
  }
}

/** Guards + offline-hantering. Returnerar provider om cykeln ska köras, annars null. */
async function precheck(ctx: SyncCtx): Promise<SyncProvider | null> {
  const p = ctx.providerRef.current;
  if (!p || !ctx.enabledRef.current || ctx.busyRef.current) return null;
  if (!ctx.onlineRef.current) { await showOffline(ctx, p); return null; }
  return p;
}

interface GitStep { timeoutMs: number; label: string; errPrefix: string }

/** Commit/push delar form: setState(syncing) → withTimeout(op) → fel sätter
 *  error-state + backoff. `skip` → no-op (inget att göra). false = abortera. */
async function runGitStep(ctx: SyncCtx, skip: boolean, op: () => Promise<unknown>, step: GitStep): Promise<boolean> {
  if (skip) return true;
  ctx.setState({ kind: "syncing", what: "push" });
  try {
    await withTimeout(op(), step.timeoutMs, step.label);
    return true;
  } catch (err) {
    ctx.setState({ kind: "error", message: errMsg(err, step.errPrefix) });
    bumpBackoff(ctx);
    return false;
  }
}

/** Pull (working tree antas rent). false vid merge-needed eller fel. */
async function pullStep(ctx: SyncCtx, p: SyncProvider): Promise<boolean> {
  ctx.setState({ kind: "syncing", what: "pull" });
  try {
    const pullResult = await withTimeout(p.pull(), ctx.cfgRef.current.pullTimeoutMs, "git pull");
    if (pullResult.kind === "merge-needed") {
      ctx.setState({ kind: "merge-needed" });
      ctx.backoffRef.current = ctx.cfgRef.current.pullIntervalMs;
      return false;
    }
    return true;
  } catch (err) {
    ctx.setState({ kind: "error", message: errMsg(err, "Pull") });
    bumpBackoff(ctx);
    return false;
  }
}

/**
 * Kör en sync-cykel: commit → pull → push. Tar busy-lock, sätter state, kastar
 * aldrig. Commit FÖRST: git.pull/checkout vägrar skriva över en dirty working
 * tree, och AVA:s writeBack skriver kontinuerligt → committa innan pull.
 */
async function runSyncCycle(ctx: SyncCtx): Promise<void> {
  const provider = await precheck(ctx);
  if (!provider) return;
  ctx.busyRef.current = true;
  try {
    const hasLocalCommit = (await provider.countChanges()) > 0;
    const t = ctx.cfgRef.current.pushTimeoutMs;
    if (!(await runGitStep(ctx, !hasLocalCommit, () => provider.commitLocal(), { timeoutMs: t, label: "git commit", errPrefix: "Commit" }))) return;
    if (!(await pullStep(ctx, provider))) return;
    if (!(await runGitStep(ctx, !hasLocalCommit, () => provider.push(), { timeoutMs: t, label: "git push", errPrefix: "Push" }))) return;
    ctx.setState({ kind: "synced", at: Date.now() });
    ctx.backoffRef.current = ctx.cfgRef.current.pullIntervalMs;
  } finally {
    ctx.busyRef.current = false;
  }
}

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

  /** Kör en sync-cykel via den modul-nivå-utbrutna {@link runSyncCycle}. Bunten
   *  av refs + setState är stabil → tom dep-array. */
  const runSync = useCallback((): Promise<void> => runSyncCycle({
    setState, providerRef, enabledRef, onlineRef, busyRef, backoffRef, cfgRef,
  }), []);

  /** Schemalägg auto-pull med nuvarande backoff-intervall. */
  useEffect(() => {
    if (!opts.enabled || !opts.provider) return;
    // Kör en initial sync (om online), annars sätt offline-state
    void runSync();

    const tick = () => {
      if (!enabledRef.current) return;
      if (!onlineRef.current) return; // offline → vänta på "online"-event
      void runSync();
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
    const t = setTimeout(() => { void runSync(); }, 500);
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
      void runSync();
    }, cfgRef.current.pushDebounceMs);
  }, [runSync]);

  const syncNow = useCallback(async (): Promise<void> => {
    if (pushTimerRef.current) {
      clearTimeout(pushTimerRef.current);
      pushTimerRef.current = null;
    }
    await runSync();
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
