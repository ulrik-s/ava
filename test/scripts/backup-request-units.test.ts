/**
 * Hostens enheter för backup på begäran (#1431). Säkerheten står i filerna:
 * `.path`-enheten startar en FAST enhet, och den enheten kör bara
 * `systemctl start ava-backup.service` — och inte alls om en export skrevs
 * de senaste fem minuterna. Spärren körs här på riktigt mot en katalog.
 *
 * Timexportens enheter (ADR 0039) testas här också: timern kvart över varje
 * timme, och tjänstens villkor och kommando körs på riktigt med falska
 * `systemctl` och `backup-export.sh`.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest-compat";

const read = (unit: string): string => readFileSync(join(process.cwd(), "tooling/systemd", unit), "utf8");
const directives = (text: string, key: string): string[] =>
  text.split("\n").filter((l) => l.startsWith(`${key}=`)).map((l) => l.slice(key.length + 1));

describe("ava-backup-request.path", () => {
  const unit = read("ava-backup-request.path");

  it("bevakar bara begärandekatalogen och startar bara begärandetjänsten", () => {
    expect(directives(unit, "PathChanged")).toEqual(["/srv/ava/backup-requests"]);
    expect(directives(unit, "Unit")).toEqual(["ava-backup-request.service"]);
    expect(directives(unit, "DirectoryMode")).toEqual(["0700"]);
    expect(directives(unit, "WantedBy")).toEqual(["multi-user.target"]);
  });
});

describe("ava-backup-request.service", () => {
  const unit = read("ava-backup-request.service");

  it("kör bara nattjobbets tjänst — inget ur begärandefilen", () => {
    expect(directives(unit, "ExecStart")).toEqual(["/bin/systemctl start --no-block ava-backup.service"]);
    expect(unit).not.toContain("backup-requests");
    expect(directives(unit, "Type")).toEqual(["oneshot"]);
  });

  describe("spärren (ExecCondition)", () => {
    let dir = "";
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ava-units-")); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    /** Villkoret som systemd kör (`$$` → `$`), mot `dir` i stället för exportkatalogen. */
    function condition(): number {
      const [line] = directives(unit, "ExecCondition");
      const cmd = (line ?? "").replace(/^\/bin\/sh -c '/, "").replace(/'$/, "").replaceAll("$$", "$").replaceAll("/srv/backup-chroot/ava", dir);
      return spawnSync("sh", ["-c", cmd]).status ?? -1;
    }

    it("ingen export: körs", () => {
      expect(condition()).toBe(0);
    });

    it("en export de senaste fem minuterna: körs inte", () => {
      writeFileSync(join(dir, "ava-2026-10-01-0300.tar.age"), "x");
      expect(condition()).not.toBe(0);
    });

    it("en färsk timexport: körs — bara fulla exporter spärrar", () => {
      writeFileSync(join(dir, "ava-2026-10-01-1015-hourly.tar.age"), "x");
      expect(condition()).toBe(0);
    });

    it("en färsk full export bredvid en timexport: körs inte", () => {
      writeFileSync(join(dir, "ava-2026-10-01-1015-hourly.tar.age"), "x");
      writeFileSync(join(dir, "ava-2026-10-01-1020.tar.age"), "x");
      expect(condition()).not.toBe(0);
    });

    it("bara äldre exporter (och andra filer): körs", () => {
      const old = join(dir, "ava-2026-09-30-0300.tar.age");
      writeFileSync(old, "x");
      const tenMinutesAgo = new Date(Date.now() - 10 * 60_000);
      utimesSync(old, tenMinutesAgo, tenMinutesAgo);
      writeFileSync(join(dir, "annat.txt"), "x");
      expect(condition()).toBe(0);
    });
  });
});

describe("ava-backup-hourly.timer", () => {
  const unit = read("ava-backup-hourly.timer");

  it("startar timexporten kvart över varje timme, utan att ta igen missade timmar", () => {
    expect(directives(unit, "OnCalendar")).toEqual(["*:15"]);
    expect(directives(unit, "Persistent")).toEqual(["false"]);
    expect(directives(unit, "Unit")).toEqual(["ava-backup-hourly.service"]);
    expect(directives(unit, "WantedBy")).toEqual(["timers.target"]);
  });

  it("säger vad den gör, hänvisar till ADR 0039 och förklarar höstens dubbla stämpel", () => {
    expect(unit.startsWith("# Timexporten (ADR 0039)")).toBe(true);
    expect(unit).toContain("skriver då över den första");
  });
});

describe("ava-backup-hourly.service", () => {
  const unit = read("ava-backup-hourly.service");
  let dir = "";
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ava-hourly-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  /** Kör direktivet som systemd gör (`$$` → `$`), i `dir` och med falska kommandon först på PATH. */
  function exec(key: string, env: Record<string, string> = {}): { status: number; out: string } {
    const [line] = directives(unit, key);
    const cmd = (line ?? "").replace(/^\/bin\/(ba)?sh -c '/, "").replace(/'$/, "").replaceAll("$$", "$");
    const r = spawnSync("bash", ["-c", cmd], {
      cwd: dir, encoding: "utf8", env: { ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH ?? ""}`, ...env },
    });
    return { status: r.status ?? -1, out: r.stdout };
  }

  function fake(path: string, body: string): void {
    const p = join(dir, path);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(p, 0o755);
  }

  it("är en oneshot i /srv/ava som hänvisar till ADR 0039", () => {
    expect(directives(unit, "Type")).toEqual(["oneshot"]);
    expect(directives(unit, "WorkingDirectory")).toEqual(["/srv/ava"]);
    expect(unit.startsWith("# Timexporten (ADR 0039)")).toBe(true);
  });

  it("hoppar över medan nattjobbet ava-backup.service kör", () => {
    fake("bin/systemctl", '[ "$*" = "is-active --quiet ava-backup.service" ] && [ -n "${FAKE_ACTIVE:-}" ]');
    expect(exec("ExecCondition", { FAKE_ACTIVE: "1" }).status).not.toBe(0);
    expect(exec("ExecCondition").status).toBe(0);
  });

  it("laddar ava-server.env och kör backup-export.sh --hourly med mottagaren och exportkatalogen därifrån", () => {
    fake("tooling/scripts/backup-export.sh", 'echo "export $* compose=${POSTGRES_PASSWORD:-saknas}"');
    writeFileSync(join(dir, "ava-server.env"), "POSTGRES_PASSWORD=pw\nAVA_BACKUP_RECIPIENT=/r.txt\nAVA_BACKUP_EXPORT_HOST_DIR=/exp\n");
    expect(exec("ExecStart").out.trim()).toBe("export /r.txt /exp --hourly compose=pw");
  });

  it("utan egna värden: standardmottagaren och samma exportkatalog som serverns montering", () => {
    fake("tooling/scripts/backup-export.sh", 'echo "export $*"');
    writeFileSync(join(dir, "ava-server.env"), "POSTGRES_PASSWORD=pw\n");
    expect(exec("ExecStart").out.trim()).toBe("export /srv/ava/backup-recipient.txt /srv/backup-chroot/ava --hourly");
  });
});
