/**
 * Containrarnas CPU och minne under lasttestet (#1366), via `docker stats`.
 *
 * Tolkningen är ren och testad; samplingen kör `docker stats --no-stream`
 * i en loop (ett anrop tar själv ~1–2 s, så takten blir därefter).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

const run = promisify(execFile);

/** En rad ur `docker stats --format '{{json .}}'` — bara fälten vi läser. */
const statsLine = z.object({
  Name: z.string(),
  CPUPerc: z.string(),
  MemUsage: z.string(),
});

/** En mätpunkt för en container. */
export interface ContainerSample {
  name: string;
  cpuPct: number;
  memMiB: number;
}

const UNIT_MIB: Readonly<Record<string, number>> = {
  B: 1 / (1024 * 1024),
  KB: 1000 / (1024 * 1024),
  KIB: 1 / 1024,
  MB: 1_000_000 / (1024 * 1024),
  MIB: 1,
  GB: 1_000_000_000 / (1024 * 1024),
  GIB: 1024,
};

/** "123.4MiB" → 123.4 (MiB). Okänd enhet → NaN. */
export function toMiB(value: string): number {
  const m = /^\s*([\d.]+)\s*([a-zA-Z]+)\s*$/.exec(value);
  const factor = m ? UNIT_MIB[(m[2] ?? "").toUpperCase()] : undefined;
  return m && factor !== undefined ? Number(m[1]) * factor : Number.NaN;
}

/** En JSON-rad → mätpunkt, eller null om raden inte går att tolka. */
export function parseStatsLine(line: string): ContainerSample | null {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return null;
  }
  const parsed = statsLine.safeParse(json);
  if (!parsed.success) return null;
  const used = parsed.data.MemUsage.split("/")[0] ?? "";
  const cpuPct = Number(parsed.data.CPUPerc.replace("%", ""));
  const memMiB = toMiB(used);
  return Number.isFinite(cpuPct) && Number.isFinite(memMiB) ? { name: parsed.data.Name, cpuPct, memMiB } : null;
}

/** Sammanfattning per container. */
export interface ContainerSummary {
  samples: number;
  cpuAvgPct: number;
  cpuMaxPct: number;
  memMaxMiB: number;
}

const r1 = (x: number): number => Math.round(x * 10) / 10;

/** Mätpunkter → sammanfattning per container. */
export function summarizeContainers(samples: readonly ContainerSample[]): Record<string, ContainerSummary> {
  const byName = new Map<string, ContainerSample[]>();
  for (const s of samples) byName.set(s.name, [...(byName.get(s.name) ?? []), s]);
  return Object.fromEntries([...byName.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, list]) => [name, {
    samples: list.length,
    cpuAvgPct: r1(list.reduce((sum, s) => sum + s.cpuPct, 0) / list.length),
    cpuMaxPct: r1(Math.max(...list.map((s) => s.cpuPct))),
    memMaxMiB: r1(Math.max(...list.map((s) => s.memMiB))),
  }]));
}

/** Samplar `docker stats` tills `stop()` anropas. Inga containrar → gör ingenting. */
export class DockerStatsSampler {
  private readonly samples: ContainerSample[] = [];
  private running = false;
  private loop: Promise<void> = Promise.resolve();

  constructor(private readonly containers: readonly string[]) {}

  start(): void {
    if (this.containers.length === 0) return;
    this.running = true;
    this.loop = this.sample();
  }

  private async sample(): Promise<void> {
    while (this.running) {
      const out = await run("docker", ["stats", "--no-stream", "--format", "{{json .}}", ...this.containers]).then((r) => r.stdout, () => "");
      for (const line of out.split("\n")) {
        const s = parseStatsLine(line);
        if (s) this.samples.push(s);
      }
    }
  }

  async stop(): Promise<Record<string, ContainerSummary>> {
    this.running = false;
    await this.loop;
    return summarizeContainers(this.samples);
  }
}
