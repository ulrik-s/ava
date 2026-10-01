/**
 * `deploy-prod.sh` + `lib/release.sh` (#1369) — deployen på prod-servern.
 *
 * Kör det RIKTIGA skriptet i en riktig git-klon (med ett lokalt "origin"),
 * med falska `docker` och `systemctl` på PATH som loggar varje anrop:
 *   - bygget hamnar i releases/<tid>-<sha> och blir aktivt (releases/current)
 *     först när migrationerna gått igenom och servern svarar på /readyz,
 *   - en kontroll som fäller lämnar klient, server och databas orörda — och
 *     säger det,
 *   - en omkörning efter ett avbrott kör migrationerna ändå (förr gav
 *     `git diff` en tom lista, eftersom koden redan var uppdaterad),
 *   - --dry-run ändrar ingenting, --rollback byter till förra klienten.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest-compat";

const REPO = process.cwd();
/** Databaslösenordet i testets ava-server.env — får aldrig synas i utskrift eller anrop. */
const PASSWORD = "hemligt-pw-1369";
const COPIED = [
  "tooling/scripts/deploy-prod.sh",
  "tooling/scripts/lib/release.sh",
  "tooling/scripts/check-built-css.sh",
  "tooling/docker/caddy/Caddyfile",
];

let root = "";
let srv = "";
let dev = "";
let bin = "";
let log = "";
let gitEnv: Record<string, string> = {};

function sh(cmd: string, cwd: string): string {
  const r = spawnSync("bash", ["-c", cmd], { cwd, encoding: "utf8", env: { ...process.env, ...gitEnv } });
  if (r.status !== 0) throw new Error(`${cmd}: ${r.stderr}`);
  return r.stdout.trim();
}

function write(base: string, path: string, content: string, mode = 0o644): void {
  const p = join(base, path);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
  chmodSync(p, mode);
}

/** En ny commit på origin/main (det en utvecklare mergat). */
function pushCommit(path = "CHANGELOG", content = String(Math.random())): string {
  write(dev, path, content, path.endsWith(".sh") ? 0o755 : 0o644);
  sh(`git add -A && git commit -qm "ändring" && git push -q origin main`, dev);
  return sh("git rev-parse --short HEAD", dev);
}

const FAKE_DOCKER = `#!/usr/bin/env bash
echo "docker $*" >> "$FAKE_LOG"
case "$1" in
  ps) [ -z "\${FAKE_BUSY:-}" ] || echo abc123 ;;
  run)
    case "$*" in
      *build-demo.sh*)
        [ -z "\${FAKE_BUILD_FAIL:-}" ] || exit 1
        mkdir -p out/_next/static/chunks
        css=".bg-canvas{a:b}.x>span:before{a:b}"
        printf "%s" "\${FAKE_CSS:-\$css}" > out/_next/static/chunks/a.css
        echo "klient $(git rev-parse --short HEAD)" > out/index.html ;;
      *db-migrate.ts*)
        # "-e AVA_DATABASE_URL" utan värde: docker läser URL:en ur sin miljö.
        [ "\${AVA_DATABASE_URL:-}" != "postgres://ava:\${FAKE_PASSWORD}@postgres:5432/ava" ] || echo "db-url via miljön" >> "$FAKE_LOG"
        [ -z "\${FAKE_MIGRATE_FAIL:-}" ] || exit 1 ;;
    esac ;;
  compose)
    case "$*" in
      *"exec -T caddy wget"*) [ -n "\${FAKE_READY_FAIL:-}" ] || echo '{"status":"ok"}' ;;
      *"exec -T caddy cat"*) if [ -n "\${FAKE_CADDYFILE_STALE:-}" ]; then echo gammal; else cat tooling/docker/caddy/Caddyfile; fi ;;
    esac ;;
esac
`;

const FAKE_SYSTEMCTL = `#!/usr/bin/env bash
echo "systemctl $*" >> "$FAKE_LOG"
case "$1" in
  cat) [ -n "\${FAKE_SYSTEMD:-}" ] ;;
  show) echo success ;;
esac
`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ava-deploy-"));
  srv = join(root, "srv");
  dev = join(root, "dev");
  bin = join(root, "bin");
  log = join(root, "log");
  const gitconfig = join(root, "gitconfig");
  // maintenance/gc av: en push startar annars underhåll i bakgrunden som packar
  // om lösa objekt medan `git clone` kopierar dem ("No such file", flaky).
  writeFileSync(gitconfig, "[user]\n\tname = t\n\temail = t@t\n[init]\n\tdefaultBranch = main\n[core]\n\thooksPath = /dev/null\n[commit]\n\tgpgsign = false\n[maintenance]\n\tauto = false\n[gc]\n\tauto = 0\n");
  gitEnv = { GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: "1" };

  sh(`git init -q --bare origin.git && git init -q dev`, root);
  for (const f of COPIED) {
    mkdirSync(dirname(join(dev, f)), { recursive: true });
    copyFileSync(join(REPO, f), join(dev, f));
  }
  write(dev, "src/app/globals.css", ".bg-canvas { a: b; }\n.x > span::before { a: b; }\n");
  write(dev, "tooling/scripts/backup-db.sh", 'echo "backup $*" >> "$FAKE_LOG"\n[ -z "${FAKE_BACKUP_FAIL:-}" ]\n', 0o755);
  sh(`git remote add origin ../origin.git && git add -A && git commit -qm init && git push -q origin main`, dev);
  sh(`git clone -q origin.git srv`, root);
  writeFileSync(join(srv, "ava-server.env"), `POSTGRES_PASSWORD=${PASSWORD}\n`);

  mkdirSync(bin);
  write(bin, "docker", FAKE_DOCKER, 0o755);
  write(bin, "systemctl", FAKE_SYSTEMCTL, 0o755);
});

afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function deploy(args: string[] = [], env: Record<string, string> = {}): { status: number; out: string; calls: string[] } {
  writeFileSync(log, "");
  const r = spawnSync("bash", [join(srv, "tooling/scripts/deploy-prod.sh"), ...args], {
    encoding: "utf8",
    env: {
      ...process.env, ...gitEnv, PATH: `${bin}:${process.env.PATH ?? ""}`, FAKE_LOG: log, FAKE_PASSWORD: PASSWORD,
      AVA_DEPLOY_READY_TRIES: "2", AVA_DEPLOY_READY_PAUSE: "0", ...env,
    },
  });
  const calls = readFileSync(log, "utf8").split("\n").filter(Boolean);
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, calls };
}

const link = (name: string): string => {
  const p = join(srv, "releases", name);
  return existsSync(p) ? readlinkSync(p) : "";
};
const served = (): string => readFileSync(join(srv, "releases/current/index.html"), "utf8").trim();
const at = (calls: string[], needle: string): number => calls.findIndex((c) => c.includes(needle));
const head = (): string => sh("git rev-parse --short HEAD", srv);

describe("deploy-prod.sh — en lyckad deploy", () => {
  it("bygger, migrerar, startar om servern och byter sedan klienten", () => {
    const sha = pushCommit();
    const { status, out, calls } = deploy();
    expect(status, out).toBe(0);
    expect(head()).toBe(sha);
    expect(link("current")).toMatch(new RegExp(`^\\d{8}T\\d{6}Z-${sha}$`));
    expect(served()).toBe(`klient ${sha}`);
    expect(existsSync(join(srv, "out"))).toBe(false);
    const backup = at(calls, "backup backup");
    const build = at(calls, "build-demo.sh");
    const migrate = at(calls, "db-migrate.ts");
    const up = at(calls, "up -d --build");
    expect(backup).toBeGreaterThan(-1);
    expect(backup).toBeLessThan(build);
    // Prod-klienten byggs utan demodata (#1352) och på roten.
    expect(calls[build]).toContain("-e DEMO_BASE_PATH= -e AVA_BUILD_TARGET=server oven/bun:1");
    expect(build).toBeLessThan(migrate);
    expect(migrate).toBeLessThan(up);
    expect(up).toBeLessThan(at(calls, "exec -T caddy wget"));
    expect(at(calls, "restart caddy")).toBe(-1);
    expect(out).toContain("deploy klar");
  });

  it("första deployen med releases/: nuvarande out/ blir en release och Caddy flyttas dit FÖRE bygget", () => {
    write(srv, "out/index.html", "gammal klient\n");
    // Som i prod: koden hämtades för hand först → HEAD är redan den NYA sha:n
    // när skriptet körs, och out/ är byggd från en okänd, äldre version.
    const sha = pushCommit();
    sh("git fetch -q origin && git merge -q --ff-only origin/main", srv);
    const { status, out, calls } = deploy();
    expect(status, out).toBe(0);
    expect(link("previous")).toMatch(/^\d{8}T\d{6}Z-bootstrap$/);
    expect(link("previous")).not.toContain(sha);
    expect(readFileSync(join(srv, "releases", link("previous"), "index.html"), "utf8")).toBe("gammal klient\n");
    expect(served()).toBe(`klient ${head()}`);
    expect(at(calls, "up -d --no-deps caddy")).toBeGreaterThan(-1);
    expect(at(calls, "up -d --no-deps caddy")).toBeLessThan(at(calls, "build-demo.sh"));
  });

  it("databaslösenordet syns aldrig på kommandoraden — migreringen får URL:en via miljön", () => {
    const { status, out, calls } = deploy();
    expect(status, out).toBe(0);
    expect(calls).toContain("db-url via miljön");
    expect(calls.find((c) => c.includes("db-migrate.ts"))).toContain("-e AVA_DATABASE_URL oven/bun:1");
    expect(calls.join("\n")).not.toContain(PASSWORD);
    expect(out).not.toContain(PASSWORD);
  });

  it("migrationerna körs vid VARJE deploy, även utan nya commits", () => {
    expect(deploy().status).toBe(0);
    const { status, calls } = deploy();
    expect(status).toBe(0);
    expect(at(calls, "db-migrate.ts")).toBeGreaterThan(-1);
  });

  it("behåller bara current och previous", () => {
    for (let i = 0; i < 3; i++) {
      pushCommit();
      expect(deploy().status).toBe(0);
    }
    const entries = readdirSync(join(srv, "releases")).sort();
    expect(entries.filter((e) => e !== "current" && e !== "previous")).toEqual([link("previous"), link("current")].sort());
  });

  it("ändrad Caddyfile → caddy startas om (en enskild fil i en bind-mount syns först då)", () => {
    const { status, calls } = deploy([], { FAKE_CADDYFILE_STALE: "1" });
    expect(status).toBe(0);
    expect(at(calls, "restart caddy")).toBeGreaterThan(at(calls, "exec -T caddy wget"));
  });

  it("backup via systemd-tjänsten när den finns", () => {
    const { status, calls } = deploy([], { FAKE_SYSTEMD: "1" });
    expect(status).toBe(0);
    expect(calls).toContain("systemctl start ava-backup.service");
    expect(at(calls, "backup backup")).toBe(-1);
  });

  it("deploy-skriptet ändrat i origin/main → deployen körs med den nya versionen", () => {
    const src = readFileSync(join(dev, "tooling/scripts/deploy-prod.sh"), "utf8");
    pushCommit("tooling/scripts/deploy-prod.sh", src.replace("set -euo pipefail\n", "set -euo pipefail\necho NY-VERSION-KÖR\n"));
    const { status, out, calls } = deploy();
    expect(status, out).toBe(0);
    expect(out).toContain("startar om med den nya versionen");
    expect(out).toContain("NY-VERSION-KÖR");
    expect(calls.filter((c) => c.startsWith("backup"))).toHaveLength(1);
  });
});

describe("deploy-prod.sh — avbrott lämnar prod orört och säger var", () => {
  it("CSS-kontrollen fäller → ingen migrering, ingen omstart, klienten oförändrad", () => {
    expect(deploy().status).toBe(0);
    const before = link("current");
    pushCommit();
    const { status, out, calls } = deploy([], { FAKE_CSS: ".bg-canvas{a:b}" });
    expect(status).toBe(1);
    expect(link("current")).toBe(before);
    expect(at(calls, "db-migrate.ts")).toBe(-1);
    expect(at(calls, "up -d --build")).toBe(-1);
    expect(out).toContain("AVBRÖTS i steget: kontrollerar byggd CSS");
    expect(out).toContain("server:    oförändrad");
    expect(out).toContain("databas:   oförändrad");
    expect(out).toContain(`releases/current -> ${before}`);
  });

  it("migreringen fäller → servern startas inte om; omkörningen kör migrationerna ändå (#1369)", () => {
    expect(deploy().status).toBe(0);
    const before = link("current");
    const sha = pushCommit();
    const failed = deploy([], { FAKE_MIGRATE_FAIL: "1" });
    expect(failed.status).toBe(1);
    expect(head()).toBe(sha);
    expect(link("current")).toBe(before);
    expect(at(failed.calls, "up -d --build")).toBe(-1);
    expect(failed.out).toContain("migreringen avbröts");
    expect(failed.out).toContain("förberedd men inte aktiv");

    const rerun = deploy();
    expect(rerun.status, rerun.out).toBe(0);
    expect(at(rerun.calls, "db-migrate.ts")).toBeGreaterThan(-1);
    expect(served()).toBe(`klient ${sha}`);
    expect(link("previous")).toBe(before);
  });

  it("/readyz svarar inte → klienten byts inte, och rapporten säger att servern är omstartad", () => {
    expect(deploy().status).toBe(0);
    const before = link("current");
    pushCommit();
    const { status, out } = deploy([], { FAKE_READY_FAIL: "1" });
    expect(status).toBe(1);
    expect(link("current")).toBe(before);
    expect(out).toContain("omstartad med ny kod");
    expect(out).toContain("/readyz svarar inte ok");
    expect(out).toContain("databas:   migrerad");
  });

  it("bygget fäller → out/ och releases orörda för Caddy", () => {
    expect(deploy().status).toBe(0);
    const before = link("current");
    pushCommit();
    const { status, out } = deploy([], { FAKE_BUILD_FAIL: "1" });
    expect(status).toBe(1);
    expect(link("current")).toBe(before);
    expect(out).toContain("AVBRÖTS i steget: bygger");
  });

  it("backupen fäller → inget byggs", () => {
    const { status, calls } = deploy([], { FAKE_BACKUP_FAIL: "1" });
    expect(status).toBe(1);
    expect(at(calls, "build-demo.sh")).toBe(-1);
  });

  it("ett annat bygge kör → avbryter innan något görs", () => {
    const { status, out, calls } = deploy([], { FAKE_BUSY: "1" });
    expect(status).toBe(1);
    expect(out).toContain("kör redan");
    expect(calls).toHaveLength(1);
  });

  it("ava-server.env saknas → avbryter före backup", () => {
    rmSync(join(srv, "ava-server.env"));
    const { status, out, calls } = deploy();
    expect(status).toBe(1);
    expect(out).toContain("ava-server.env saknas");
    expect(at(calls, "backup")).toBe(-1);
  });
});

describe("deploy-prod.sh — --dry-run, --rollback och argument", () => {
  it("--dry-run visar stegen men ändrar ingenting", () => {
    expect(deploy().status).toBe(0);
    const before = link("current");
    const oldHead = head();
    const sha = pushCommit();
    const { status, out, calls } = deploy(["--dry-run"]);
    expect(status, out).toBe(0);
    expect(head()).toBe(oldHead);
    expect(link("current")).toBe(before);
    expect(calls.filter((c) => !c.startsWith("docker ps") && !c.startsWith("systemctl cat"))).toEqual([]);
    expect(out).toContain("[dry-run] git merge --ff-only");
    expect(out).toContain(`[dry-run] release_activate `);
    expect(out).toContain(sha);
    // Utskriften hamnar i terminaler och loggar: inga hemligheter (#1369-uppföljning).
    expect(out).toContain("[dry-run] docker run --rm --network ava_default");
    expect(out).not.toContain(PASSWORD);
    expect(calls.join("\n")).not.toContain(PASSWORD);
  });

  it("--rollback byter till förra klienten — och en andra rollback ångrar den", () => {
    const first = pushCommit();
    expect(deploy().status).toBe(0);
    const second = pushCommit();
    expect(deploy().status).toBe(0);
    expect(served()).toBe(`klient ${second}`);

    const back = deploy(["--rollback"]);
    expect(back.status, back.out).toBe(0);
    expect(served()).toBe(`klient ${first}`);
    expect(back.calls).toEqual([]);
    expect(deploy(["--rollback"]).status).toBe(0);
    expect(served()).toBe(`klient ${second}`);
  });

  it("--rollback utan tidigare release → fel, inget ändrat", () => {
    expect(deploy().status).toBe(0);
    const before = link("current");
    const { status, out } = deploy(["--rollback"]);
    expect(status).toBe(1);
    expect(out).toContain("ingen tidigare release");
    expect(link("current")).toBe(before);
  });

  it("okänt argument → exit 2; --help → användning", () => {
    expect(deploy(["--okänt"]).status).toBe(2);
    const help = deploy(["--help"]);
    expect(help.status).toBe(0);
    expect(help.out).toContain("--rollback");
  });
});

describe("lib/release.sh", () => {
  function lib(script: string): { status: number; out: string } {
    const r = spawnSync("bash", ["-c", `set -euo pipefail; source "${join(REPO, "tooling/scripts/lib/release.sh")}"; ${script}`], {
      cwd: root, encoding: "utf8",
    });
    return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  }

  it("release_new_name ger ett ledigt namn även inom samma sekund", () => {
    const r = lib('a=$(release_new_name abc); mkdir -p "releases/$a"; b=$(release_new_name abc); [ "$b" = "$a.2" ] && echo ok');
    expect(r.out.trim()).toBe("ok");
  });

  it("release_stage vägrar en saknad källa och ett upptaget namn", () => {
    expect(lib("release_stage nope r1").out).toContain("finns inte");
    const r = lib("mkdir -p out releases/r1; release_stage out r1");
    expect(r.status).toBe(1);
    expect(r.out).toContain("finns redan");
  });

  it("release_activate: okänd release vägras, samma release två gånger är en no-op", () => {
    expect(lib("release_activate saknas").out).toContain("finns inte");
    const r = lib("mkdir -p out; release_stage out r1; release_activate r1; release_activate r1; release_describe");
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain("releases/current -> r1 (previous -> ingen)");
  });
});
