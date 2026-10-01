/**
 * Keepalive:n (#1425): medan appen är öppen frågas `/oauth2/userinfo` med
 * jämna mellanrum (och när fliken blir synlig eller får nätet tillbaka), så
 * att proxyns förnyade cookie når webbläsaren via `/oauth2/*`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest-compat";
import {
  electLeader, SESSION_KEEPALIVE_DEBOUNCE_MS, SESSION_KEEPALIVE_INTERVAL_MS, SESSION_KEEPALIVE_LOCK_NAME,
  startBrowserSessionKeepalive, startSessionKeepalive, type KeepaliveEnv, type KeepaliveLocks,
} from "@/lib/client/auth/session-keepalive";
import type { SessionNotice } from "@/lib/client/auth/session-notice";
import { OIDC_USERINFO_PATH, type SessionProbe } from "@/lib/client/auth/session-probe";

const AUTHENTICATED: SessionProbe = { kind: "authenticated", claims: { email: "anna@byra.se", subject: "", issuer: "", name: "Anna" } };

/** Web Locks som i webbläsaren: en innehavare i taget, väntande i kö, avbrytbar väntan. */
class FakeLocks implements KeepaliveLocks {
  held = false;
  readonly names: string[] = [];
  private queue: Array<() => void> = [];

  async request(name: string, options: { signal: AbortSignal }, callback: () => Promise<void>): Promise<void> {
    this.names.push(name);
    if (this.held) await this.wait(options.signal);
    this.held = true;
    try {
      await callback();
    } finally {
      this.held = false;
      this.queue.shift()?.();
    }
  }

  private wait(signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const grant = (): void => { resolve(); };
      this.queue.push(grant);
      signal.addEventListener("abort", () => {
        this.queue = this.queue.filter((g) => g !== grant);
        reject(new DOMException("avbruten", "AbortError"));
      });
    });
  }
}

/** En flik: egna händelser, synlighet och svar från proxyn. */
function fakeTab(opts: { locks?: KeepaliveLocks; probe?: () => Promise<SessionProbe>; signedIn?: () => boolean } = {}) {
  const events = new EventTarget();
  const page = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState });
  const notices: SessionNotice[] = [];
  const probe = vi.fn(opts.probe ?? (async () => AUTHENTICATED));
  const env: KeepaliveEnv = {
    probe,
    notify: (n) => { notices.push(n); },
    signedIn: opts.signedIn ?? (() => true),
    events,
    page,
    locks: opts.locks,
  };
  const goOnline = (): void => { events.dispatchEvent(new Event("online")); };
  const show = (state: DocumentVisibilityState): void => {
    page.visibilityState = state;
    page.dispatchEvent(new Event("visibilitychange"));
  };
  return { env, probe, notices, goOnline, show };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("startSessionKeepalive — intervallet", () => {
  it("frågar proxyn var femte minut, inte vid start", async () => {
    const tab = fakeTab();
    const stop = startSessionKeepalive(tab.env);
    expect(tab.probe).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(SESSION_KEEPALIVE_INTERVAL_MS - 1);
    expect(tab.probe).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(tab.probe).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SESSION_KEEPALIVE_INTERVAL_MS);
    expect(tab.probe).toHaveBeenCalledTimes(2);
    stop();
  });

  it("intervallet går att korta (injicerbart)", async () => {
    const tab = fakeTab();
    const stop = startSessionKeepalive({ ...tab.env, intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(tab.probe).toHaveBeenCalledTimes(3);
    stop();
  });

  it("aldrig två frågor samtidigt", async () => {
    let answer: (p: SessionProbe) => void = () => undefined;
    const tab = fakeTab({ probe: () => new Promise<SessionProbe>((resolve) => { answer = resolve; }) });
    const stop = startSessionKeepalive({ ...tab.env, intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(tab.probe).toHaveBeenCalledTimes(1);
    answer(AUTHENTICATED);
    await vi.advanceTimersByTimeAsync(0); // svaret landar
    await vi.advanceTimersByTimeAsync(1_000);
    expect(tab.probe).toHaveBeenCalledTimes(2);
    stop();
  });
});

describe("startSessionKeepalive — synlig flik och nätet tillbaka", () => {
  it("online → en fråga efter debounce", async () => {
    const tab = fakeTab();
    const stop = startSessionKeepalive(tab.env);
    tab.goOnline();
    await vi.advanceTimersByTimeAsync(SESSION_KEEPALIVE_DEBOUNCE_MS - 1);
    expect(tab.probe).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(tab.probe).toHaveBeenCalledTimes(1);
    stop();
  });

  it("synlig igen → en fråga; dold → ingen", async () => {
    const tab = fakeTab();
    const stop = startSessionKeepalive(tab.env);
    tab.show("hidden");
    await vi.advanceTimersByTimeAsync(SESSION_KEEPALIVE_DEBOUNCE_MS);
    expect(tab.probe).toHaveBeenCalledTimes(0);
    tab.show("visible");
    await vi.advanceTimersByTimeAsync(SESSION_KEEPALIVE_DEBOUNCE_MS);
    expect(tab.probe).toHaveBeenCalledTimes(1);
    stop();
  });

  it("en skur av händelser (väckt laptop: online + synlig) ger EN fråga", async () => {
    const tab = fakeTab();
    const stop = startSessionKeepalive(tab.env);
    tab.goOnline();
    tab.show("visible");
    await vi.advanceTimersByTimeAsync(SESSION_KEEPALIVE_DEBOUNCE_MS / 2);
    tab.goOnline();
    await vi.advanceTimersByTimeAsync(SESSION_KEEPALIVE_DEBOUNCE_MS);
    expect(tab.probe).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe("startSessionKeepalive — utfallet går in i sessionsläget", () => {
  const once = async (probe: SessionProbe) => {
    const tab = fakeTab({ probe: async () => probe });
    const stop = startSessionKeepalive({ ...tab.env, intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    return { tab, stop };
  };

  it("inloggad → inget besked, frågar vidare", async () => {
    const { tab, stop } = await once(AUTHENTICATED);
    expect(tab.notices).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(tab.probe).toHaveBeenCalledTimes(2);
    stop();
  });

  it("utloggad → 'Logga in igen'-bannern, ingen omdirigering; frågar vidare (en inloggning i en annan flik syns)", async () => {
    const { tab, stop } = await once({ kind: "signed-out" });
    expect(tab.notices).toEqual(["signed-out"]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(tab.probe).toHaveBeenCalledTimes(2);
    stop();
  });

  it("proxyn nås inte → inget besked (nästa fråga försöker igen)", async () => {
    const { tab, stop } = await once({ kind: "unreachable", reason: "network" });
    expect(tab.notices).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(tab.probe).toHaveBeenCalledTimes(2);
    stop();
  });

  it("ingen OIDC i driften → inget att hålla vid liv: stopp", async () => {
    const { tab } = await once({ kind: "absent" });
    await vi.advanceTimersByTimeAsync(5_000);
    tab.goOnline();
    await vi.advanceTimersByTimeAsync(SESSION_KEEPALIVE_DEBOUNCE_MS);
    expect(tab.probe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ett svar som kommer efter stoppet ignoreras", async () => {
    let answer: (p: SessionProbe) => void = () => undefined;
    const tab = fakeTab({ probe: () => new Promise<SessionProbe>((resolve) => { answer = resolve; }) });
    const stop = startSessionKeepalive({ ...tab.env, intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    stop();
    answer({ kind: "signed-out" });
    await vi.advanceTimersByTimeAsync(0);
    expect(tab.notices).toEqual([]);
  });
});

describe("startSessionKeepalive — stopp", () => {
  it("avmontering stoppar timern, debouncen och lyssnarna", async () => {
    const tab = fakeTab();
    const stop = startSessionKeepalive(tab.env);
    tab.goOnline();
    stop();
    stop(); // idempotent
    tab.goOnline();
    tab.show("visible");
    await vi.advanceTimersByTimeAsync(SESSION_KEEPALIVE_INTERVAL_MS * 2);
    expect(tab.probe).toHaveBeenCalledTimes(0);
    // (bun räknar en rensad fejk-timer tills klockan flyttats)
    expect(vi.getTimerCount()).toBe(0);
  });

  it("utloggad (här eller i en annan flik) → stopp utan fler frågor", async () => {
    let signedIn = true;
    const tab = fakeTab({ signedIn: () => signedIn });
    startSessionKeepalive({ ...tab.env, intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(tab.probe).toHaveBeenCalledTimes(1);
    signedIn = false;
    await vi.advanceTimersByTimeAsync(1_000);
    tab.goOnline();
    await vi.advanceTimersByTimeAsync(SESSION_KEEPALIVE_DEBOUNCE_MS + 5_000);
    expect(tab.probe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("en flik frågar med jämna mellanrum (Web Locks)", () => {
  it("bara den valda fliken har timern; stängs den tar nästa över", async () => {
    const locks = new FakeLocks();
    const a = fakeTab({ locks });
    const b = fakeTab({ locks });
    const stopA = startSessionKeepalive({ ...a.env, intervalMs: 1_000 });
    const stopB = startSessionKeepalive({ ...b.env, intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(a.probe).toHaveBeenCalledTimes(3);
    expect(b.probe).toHaveBeenCalledTimes(0);
    expect(locks.names).toEqual([SESSION_KEEPALIVE_LOCK_NAME, SESSION_KEEPALIVE_LOCK_NAME]);

    stopA(); // fliken stängs → låset släpps
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(a.probe).toHaveBeenCalledTimes(3);
    expect(b.probe).toHaveBeenCalledTimes(2);
    stopB();
    await vi.advanceTimersByTimeAsync(0);
    expect(locks.held).toBe(false);
  });

  it("en flik som inte leder frågar ändå själv när den blir synlig", async () => {
    const locks = new FakeLocks();
    const a = fakeTab({ locks });
    const b = fakeTab({ locks });
    const stopA = startSessionKeepalive(a.env);
    const stopB = startSessionKeepalive(b.env);
    await vi.advanceTimersByTimeAsync(0);
    b.show("visible");
    await vi.advanceTimersByTimeAsync(SESSION_KEEPALIVE_DEBOUNCE_MS);
    expect(b.probe).toHaveBeenCalledTimes(1);
    expect(a.probe).toHaveBeenCalledTimes(0);
    stopA();
    stopB();
  });

  it("en väntande flik som stängs lämnar kön och leder aldrig", async () => {
    const locks = new FakeLocks();
    const lead = vi.fn(() => () => undefined);
    const stopA = electLeader(locks, () => () => undefined);
    const stopB = electLeader(locks, lead);
    await vi.advanceTimersByTimeAsync(0);
    stopB(); // väntan avbryts (AbortError fångas)
    stopA();
    await vi.advanceTimersByTimeAsync(0);
    expect(lead).toHaveBeenCalledTimes(0);
    expect(locks.held).toBe(false);
  });

  it("utan Web Locks leder varje flik (osäker sida)", async () => {
    const a = fakeTab();
    const b = fakeTab();
    const stopA = startSessionKeepalive({ ...a.env, intervalMs: 1_000 });
    const stopB = startSessionKeepalive({ ...b.env, intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(a.probe).toHaveBeenCalledTimes(1);
    expect(b.probe).toHaveBeenCalledTimes(1);
    stopA();
    stopB();
  });
});

describe("startBrowserSessionKeepalive", () => {
  const configure = (cfg: Record<string, unknown>): void => { localStorage.setItem("ava.firma", JSON.stringify(cfg)); };
  afterEach(() => { localStorage.removeItem("ava.firma"); });

  it("av i demon — ingen proxy att fråga", async () => {
    configure({ tier: "demo", principalId: "u-1" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const stop = startBrowserSessionKeepalive();
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(SESSION_KEEPALIVE_INTERVAL_MS);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    stop();
    fetchSpy.mockRestore();
  });

  it("self-hosted: frågar /oauth2/userinfo när nätet kommer tillbaka; stoppet tar bort lyssnaren", async () => {
    configure({ tier: "self-hosted", principalId: "u-1", authorEmail: "anna@byra.se" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}", { status: 401 }));
    const stop = startBrowserSessionKeepalive();
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(SESSION_KEEPALIVE_DEBOUNCE_MS);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(OIDC_USERINFO_PATH);
    stop();
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(SESSION_KEEPALIVE_DEBOUNCE_MS);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });
});
