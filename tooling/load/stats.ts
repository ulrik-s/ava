/**
 * Mätvärden för lasttestet (#1366): svarstider per anrop och fel per kod.
 *
 * Ren logik utan I/O — testas för sig. Percentilen är "nearest rank" på den
 * sorterade listan, samma definition som de flesta lastverktyg rapporterar.
 */

/** Sammanfattning av en serie svarstider (ms). */
export interface LatencySummary {
  count: number;
  errors: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

/** Nearest-rank-percentil ur en STIGANDE sorterad lista; 0 för en tom lista. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((Math.min(Math.max(p, 0), 100) / 100) * sorted.length);
  return sorted[Math.max(rank, 1) - 1] ?? 0;
}

const round = (ms: number): number => Math.round(ms * 10) / 10;

/** Sammanfatta svarstider (osorterade) och antalet fel bland dem. */
export function summarize(samples: readonly number[], errors = 0): LatencySummary {
  const sorted = [...samples].sort((a, b) => a - b);
  const total = sorted.reduce((sum, x) => sum + x, 0);
  return {
    count: sorted.length,
    errors,
    mean: sorted.length > 0 ? round(total / sorted.length) : 0,
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted[sorted.length - 1] ?? 0),
  };
}

/** Ett utfall att registrera: hur länge anropet tog och, om det gick fel, felkoden. */
export interface Sample {
  op: string;
  ms: number;
  /** HTTP-status eller tRPC-felkod; utelämnad = lyckat. */
  error?: string;
  /** HTTP-statusen (0 = nätfel). */
  status: number;
}

/**
 * Samlar svarstider per fas och anrop. Fasen (scenariot) hålls isär, så att
 * stormens köer inte späder ut eller blåser upp det vanliga arbetets p95.
 */
export class LatencyRecorder {
  private readonly samples = new Map<string, number[]>();
  private readonly errorsByOp = new Map<string, number>();
  private readonly errorCodes = new Map<string, number>();
  private serverErrors = 0;
  phase = "setup";

  record(sample: Sample): void {
    const key = `${this.phase}:${sample.op}`;
    const list = this.samples.get(key) ?? [];
    list.push(sample.ms);
    this.samples.set(key, list);
    if (sample.status >= 500) this.serverErrors++;
    if (sample.error === undefined) return;
    this.errorsByOp.set(key, (this.errorsByOp.get(key) ?? 0) + 1);
    const code = `${this.phase}:${sample.error}`;
    this.errorCodes.set(code, (this.errorCodes.get(code) ?? 0) + 1);
  }

  /** Antal svar med HTTP 5xx över hela körningen. */
  get count5xx(): number {
    return this.serverErrors;
  }

  /** `fas:anrop` → sammanfattning, sorterat på nyckel. */
  summaries(): Record<string, LatencySummary> {
    const keys = [...this.samples.keys()].sort();
    return Object.fromEntries(keys.map((k) => [k, summarize(this.samples.get(k) ?? [], this.errorsByOp.get(k) ?? 0)]));
  }

  /** `fas:kod` → antal. */
  errors(): Record<string, number> {
    return Object.fromEntries([...this.errorCodes.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }
}

/**
 * Fördröjning mellan två tick i klientprocessens event loop, per fas — visar
 * om lastgeneratorn själv blev flaskhalsen (då är fasens svarstider för höga).
 */
export class EventLoopLag {
  private readonly lags = new Map<string, number[]>();
  private timer: ReturnType<typeof setInterval> | null = null;

  start(phase: () => string, intervalMs = 100, now: () => number = () => performance.now()): void {
    let expected = now() + intervalMs;
    this.timer = setInterval(() => {
      const t = now();
      const key = phase();
      const list = this.lags.get(key) ?? [];
      list.push(Math.max(0, t - expected));
      this.lags.set(key, list);
      expected = t + intervalMs;
    }, intervalMs);
  }

  /** Stoppa och sammanfatta per fas. */
  stop(): Record<string, LatencySummary> {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    return Object.fromEntries([...this.lags.entries()].map(([k, v]) => [k, summarize(v)]));
  }
}
