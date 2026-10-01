/**
 * Samtidigheten i simuleringen (#1358): flera flikar kör sina steg samtidigt,
 * och nätet bestämmer — seedat — i vilken ordning deras anrop når servern.
 *
 * Varje anrop en flik gör läggs i nätets kö i stället för att skickas direkt.
 * En våg startar några steg samtidigt (på olika flikar) och driver dem sedan:
 * vänta tills varje pågående steg står still — antingen på ett anrop i kön
 * eller på synklåset — och leverera då ETT anrop, valt med seeden bland de
 * väntande. Valet görs alltså bara när läget är stilla och kön sorterad, så
 * samma seed ger samma sammanflätning, oavsett hur snabbt något går.
 *
 * Servern behandlar ett anrop i taget. pglite är en enda anslutning (allt i
 * en transaktion i taget), så det som går att flätas samman är anropen —
 * en pull från en flik mellan två pushar från en annan, en lokal ändring mitt
 * i en annan fliks synk, två flikar som spelar upp samma kö.
 */
import type { SyncLocks } from "@/lib/client/sync/sync-lock";
import type { Rng } from "../../../helpers/seeded-rng";

interface Pending {
  readonly actor: string;
  readonly seq: number;
  readonly deliver: () => Promise<void>;
}

/** Hur många makrouppgifter en våg får vänta på ett stilla läge innan den ger upp. */
const MAX_IDLE_TICKS = 200_000;

const tick = (): Promise<void> => new Promise((resolve) => { setImmediate(resolve); });

/** Webbläsarens synklås (Web Locks): en flik i taget skickar kön (#1332). */
export class SimLock {
  private tail: Promise<void> = Promise.resolve();
  /** Flikar som väntar på låset — de står still, inte på nätet. */
  readonly waiting = new Set<string>();

  /** Låset som `withSyncLock` ser för en flik. */
  locksFor(actor: string): SyncLocks {
    return { request: (_name, callback) => this.run(actor, callback) };
  }

  private async run<T>(actor: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release: () => void = () => undefined;
    this.tail = new Promise((resolve) => { release = resolve; });
    this.waiting.add(actor);
    await previous;
    this.waiting.delete(actor);
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export class SimNetwork {
  private readonly pending: Pending[] = [];
  private seq = 0;
  /** Lås som flikar kan stå och vänta på (en per webbläsare). */
  private readonly locks: SimLock[] = [];
  /** Antal levererade anrop (statistik). */
  delivered = 0;

  /** `r` = null: anropen levereras direkt, utan schemaläggning (enkla tester). */
  constructor(private readonly r: Rng | null) {}

  watch(lock: SimLock): void {
    this.locks.push(lock);
  }

  /** Lägg anropet i kön. Svaret kommer när simuleringen levererar det. */
  send(actor: string, serve: () => Promise<Response>): Promise<Response> {
    if (!this.r) return serve();
    return new Promise((resolve, reject) => {
      this.pending.push({ actor, seq: this.seq++, deliver: () => serve().then(resolve, reject) });
    });
  }

  private stalled(actor: string): boolean {
    return this.pending.some((p) => p.actor === actor) || this.locks.some((l) => l.waiting.has(actor));
  }

  /** Vänta tills varje pågående steg står still (eller är klart). */
  private async settle(running: ReadonlySet<string>): Promise<void> {
    for (let i = 0; i < MAX_IDLE_TICKS; i++) {
      if ([...running].every((a) => this.stalled(a))) return;
      await tick();
    }
    throw new Error(`simuleringen står still: ${[...running].join(", ")} varken klara eller väntande`);
  }

  /** Leverera ett väntande anrop, valt med seeden ur kön sorterad på flik och ordning. */
  private async deliverOne(): Promise<void> {
    const sorted = [...this.pending].sort((a, b) => a.actor.localeCompare(b.actor) || a.seq - b.seq);
    const next = sorted[Math.floor((this.r?.next() ?? 0) * sorted.length)];
    if (!next) return;
    this.pending.splice(this.pending.indexOf(next), 1);
    this.delivered++;
    await next.deliver();
  }

  /** Kör stegen samtidigt och driv nätet tills alla är klara. */
  async wave(steps: ReadonlyArray<{ actor: string; run: () => Promise<unknown> }>): Promise<void> {
    const running = new Set(steps.map((s) => s.actor));
    const done = steps.map((s) => s.run().finally(() => { running.delete(s.actor); }));
    for (;;) {
      await this.settle(running);
      if (running.size === 0) break;
      await this.deliverOne();
    }
    await Promise.all(done);
  }
}
