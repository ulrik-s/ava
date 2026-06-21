/**
 * `EngineSupervisor` (ADR 0029) — startar och övervakar den medföljande Bun-
 * helper-motorn som child-process. Startar om vid oväntad krasch (med en
 * broms: ger upp efter för många omstarter i ett fönster), och dödar den rent
 * vid `stop()`. Spawn/klocka/timer injiceras → testbart utan riktig process.
 *
 * Sökvägen till binären (Electron `resourcesPath`) löses i skalet (`main.ts`);
 * den här klassen bryr sig bara om livscykeln.
 */

export interface SpawnedProcess {
  kill(): void;
  /** Registrera exit-callback (anropas en gång när processen dör). */
  onExit(cb: () => void): void;
}

export interface EngineDeps {
  spawn: (binPath: string, args: readonly string[]) => SpawnedProcess;
  now: () => number;
  /** Schemalägg en omstart; returnerar en avbryt-funktion. */
  setTimer: (fn: () => void, ms: number) => () => void;
}

const RESTART_DELAY_MS = 1_000;
const MAX_RESTARTS = 5;
const WINDOW_MS = 60_000;

export class EngineSupervisor {
  private proc: SpawnedProcess | null = null;
  private wantRunning = false;
  private restartTimes: number[] = [];
  private gaveUp = false;

  constructor(
    private readonly binPath: string,
    private readonly args: readonly string[],
    private readonly deps: EngineDeps,
  ) {}

  start(): void {
    if (this.wantRunning) return;
    this.wantRunning = true;
    this.gaveUp = false;
    this.spawnOnce();
  }

  stop(): void {
    this.wantRunning = false;
    this.proc?.kill();
    this.proc = null;
  }

  isRunning(): boolean {
    return this.proc !== null;
  }

  /** Gav upp omstarter (för många kraschar) — skalet kan visa ett fel. */
  hasGivenUp(): boolean {
    return this.gaveUp;
  }

  private spawnOnce(): void {
    const proc = this.deps.spawn(this.binPath, this.args);
    this.proc = proc;
    proc.onExit(() => this.handleExit());
  }

  private handleExit(): void {
    this.proc = null;
    if (!this.wantRunning) return; // medvetet stoppad
    if (this.tooManyRestarts()) {
      this.gaveUp = true;
      return;
    }
    this.restartTimes.push(this.deps.now());
    this.deps.setTimer(() => {
      if (this.wantRunning) this.spawnOnce();
    }, RESTART_DELAY_MS);
  }

  private tooManyRestarts(): boolean {
    const cutoff = this.deps.now() - WINDOW_MS;
    this.restartTimes = this.restartTimes.filter((t) => t >= cutoff);
    return this.restartTimes.length >= MAX_RESTARTS;
  }
}
