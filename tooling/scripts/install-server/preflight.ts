/**
 * Preflight-kontroller för install-server (#258, uppföljning #232) — fångar
 * vanliga fällor FÖRE `--start` och ger tydliga fel i stället för kryptiska
 * docker-fel: (1) docker tillgängligt, (2) web-porten ledig.
 *
 * `interpretPreflight` är ren + testbar; I/O-runnerna injicerar sina beroenden
 * (spawn/net) så även de kan testas utan en riktig docker/ledig port.
 */

export interface PreflightCheck {
  name: string;
  ok: boolean;
  /** Åtgärdsförslag när !ok. */
  hint?: string;
}

/** Sammanställ checkar → {ok, errors}. Ren. */
export function interpretPreflight(checks: readonly PreflightCheck[]): { ok: boolean; errors: string[] } {
  const errors = checks
    .filter((c) => !c.ok)
    .map((c) => (c.hint ? `${c.name}: ${c.hint}` : c.name));
  return { ok: errors.length === 0, errors };
}

type SpawnLike = (cmd: string, args: string[]) => { status: number | null };

/** Är `docker` körbart? (kör `docker --version`.) */
export async function dockerAvailable(spawn?: SpawnLike): Promise<boolean> {
  if (spawn) return spawn("docker", ["--version"]).status === 0;
  const { spawnSync } = await import("node:child_process");
  return spawnSync("docker", ["--version"], { stdio: "ignore" }).status === 0;
}

/** Är `port` ledig? Försöker lyssna på den; EADDRINUSE → upptagen. */
export async function portFree(port: number): Promise<boolean> {
  const net = await import("node:net");
  return new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

/** Kör alla preflight-checkar inför start (docker + web-port). */
export async function runPreflight(webPort: number): Promise<PreflightCheck[]> {
  const [docker, free] = await Promise.all([dockerAvailable(), portFree(webPort)]);
  return [
    { name: "docker", ok: docker, hint: "docker hittades inte på PATH — installera Docker Desktop/Engine" },
    { name: `port ${webPort}`, ok: free, hint: `porten ${webPort} är upptagen — stoppa tjänsten som använder den eller välj en annan` },
  ];
}
