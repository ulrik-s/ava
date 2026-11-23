/**
 * Prod-stackens images är låsta till digest (#1881).
 *
 * En rörlig tagg (`latest`, `2-alpine`, `stable-slim`) kan bytas upstream, och
 * en kapad image tas då in på en ny server eller vid `docker compose pull`.
 * Varje image i prod-composen, och varje `FROM` och `# syntax=` i den Dockerfile
 * som server-first byggs ur, ska därför ha formen `namn:tagg@sha256:<digest>`,
 * med en tagg som säger en version.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest-compat";

const ROOT = process.cwd();
const DOCKER = join(ROOT, "tooling/docker");
const read = (p: string): string => readFileSync(p, "utf8");

interface ComposeService { image?: string; build?: { context?: string; dockerfile?: string } }
const production = Bun.YAML.parse(read(join(DOCKER, "docker-compose.production.yml"))) as { services: Record<string, ComposeService> };

/** `namn:tagg@sha256:<64 hex>` — taggen läsbar, digesten låser. */
const PINNED = /^[^\s@]+:([\w.-]+)@sha256:[0-9a-f]{64}$/;

/**
 * Images som får ha `latest` som etikett. autoheal har ingen versionstagg
 * nyare än 1.2.0 (2021), så `latest` med digest låser dagens image (Ulriks
 * beslut på #1881). Digesten gör att taggen ändå inte flyttar sig.
 */
const LATEST_ALLOWED = new Set(["willfarrell/autoheal"]);

function tagProblem(ref: string): string | null {
  const m = PINNED.exec(ref);
  if (!m) return `${ref}: saknar namn:tagg@sha256:<digest>`;
  const name = ref.slice(0, ref.indexOf(":"));
  if (m[1] === "latest" && !LATEST_ALLOWED.has(name)) return `${ref}: taggen latest säger ingen version`;
  return null;
}

/** `# syntax=` och varje `FROM` (utan `--platform` och `AS`) i en Dockerfile. */
function dockerfileRefs(text: string): string[] {
  const refs: string[] = [];
  for (const line of text.split("\n")) {
    const syntax = /^#\s*syntax=(\S+)/.exec(line);
    if (syntax?.[1]) refs.push(syntax[1]);
    const from = /^FROM\s+(?:--platform=\S+\s+)?(\S+)/i.exec(line);
    if (from?.[1]) refs.push(from[1]);
  }
  return refs;
}

const services = Object.entries(production.services);
const built = services.filter(([, s]) => s.build?.dockerfile != null);

describe("prod-stackens images är låsta till digest (#1881)", () => {
  it("varje tjänst har build eller ett image med tagg och digest", () => {
    const problems = services.flatMap(([name, s]) => {
      if (s.build) return [];
      if (!s.image) return [`${name}: varken build eller image`];
      const p = tagProblem(s.image);
      return p ? [`${name}: ${p}`] : [];
    });
    expect(problems).toEqual([]);
  });

  it("server-first byggs ur en Dockerfile", () => {
    expect(built.map(([name]) => name)).toContain("server-first");
  });

  it("varje FROM och # syntax= i de byggda Dockerfilerna har tagg och digest", () => {
    const problems = built.flatMap(([, s]) => {
      const file = join(DOCKER, s.build?.context ?? ".", s.build?.dockerfile ?? "");
      const refs = dockerfileRefs(read(file));
      expect(refs.length).toBeGreaterThanOrEqual(2);
      return refs.map(tagProblem).filter((p): p is string => p !== null);
    });
    expect(problems).toEqual([]);
  });

  it("regeln fäller rörliga taggar och latest utanför undantaget", () => {
    const digest = "@sha256:" + "a".repeat(64);
    expect(tagProblem("caddy:2-alpine")).toMatch(/saknar/);
    expect(tagProblem("caddy@sha256:" + "a".repeat(64))).toMatch(/saknar/);
    expect(tagProblem(`ollama/ollama:latest${digest}`)).toMatch(/latest/);
    expect(tagProblem(`willfarrell/autoheal:latest${digest}`)).toBeNull();
    expect(tagProblem(`quay.io/oauth2-proxy/oauth2-proxy:v7.6.0${digest}`)).toBeNull();
  });

  it("dockerfileRefs läser syntax, FROM med --platform, och hoppar över andra rader", () => {
    const text = "# syntax=docker/dockerfile:1\n# kommentar\nFROM --platform=linux/amd64 debian:13 AS bas\nRUN true\nfrom alpine:3\n";
    expect(dockerfileRefs(text)).toEqual(["docker/dockerfile:1", "debian:13", "alpine:3"]);
  });
});
