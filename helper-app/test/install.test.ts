import { describe, expect, test } from "bun:test";

import {
  resolveInstallPaths,
  renderLaunchdPlist,
  renderSystemdUnit,
  renderWindowsTaskXml,
  registerArgs,
  unregisterArgs,
  installService,
  uninstallService,
  type InstallDeps,
  type InstallPaths,
} from "../src/install.ts";

const HOME = "/home/anna";

describe("resolveInstallPaths", () => {
  test("macOS: launchd-plist + Application Support-bin", () => {
    const p = resolveInstallPaths("darwin", HOME)!;
    expect(p.binPath).toBe(`${HOME}/Library/Application Support/AVA/ava-helper`);
    expect(p.servicePath).toBe(`${HOME}/Library/LaunchAgents/se.ava.helper.plist`);
  });
  test("Linux: systemd user-unit + .local/share-bin", () => {
    const p = resolveInstallPaths("linux", HOME)!;
    expect(p.binPath).toBe(`${HOME}/.local/share/AVA/ava-helper`);
    expect(p.servicePath).toBe(`${HOME}/.config/systemd/user/ava-helper.service`);
  });
  test("Windows: .exe-binär + task-xml", () => {
    const p = resolveInstallPaths("windows", HOME, { localAppData: "C:/Users/Anna/AppData/Local" })!;
    expect(p.binPath.endsWith("ava-helper.exe")).toBe(true);
    expect(p.servicePath.endsWith("ava-helper-task.xml")).toBe(true);
  });
  test("ostödd plattform → null", () => {
    expect(resolveInstallPaths("other", HOME)).toBeNull();
  });
});

describe("service-fil-renderare", () => {
  test("launchd-plist bär absolut bin-path + KeepAlive + label", () => {
    const xml = renderLaunchdPlist("/bin/ava-helper", "/logs");
    expect(xml).toContain("<string>/bin/ava-helper</string>");
    expect(xml).toContain("<key>KeepAlive</key><true/>");
    expect(xml).toContain("se.ava.helper");
  });
  test("systemd-unit har ExecStart + Restart=always", () => {
    const u = renderSystemdUnit("/bin/ava-helper");
    expect(u).toContain("ExecStart=/bin/ava-helper");
    expect(u).toContain("Restart=always");
  });
  test("windows task-xml har Command", () => {
    expect(renderWindowsTaskXml("C:/x/ava-helper.exe")).toContain("<Command>C:/x/ava-helper.exe</Command>");
  });
});

describe("registerArgs / unregisterArgs", () => {
  const p: InstallPaths = { binPath: "/b", servicePath: "/s", logDir: "/l" };
  test("macOS: launchctl load / unload", () => {
    expect(registerArgs("darwin", p).at(-1)).toEqual({ cmd: "launchctl", args: ["load", "-w", "/s"] });
    expect(unregisterArgs("darwin", p)[0]).toEqual({ cmd: "launchctl", args: ["unload", "-w", "/s"] });
  });
  test("Linux: systemctl enable / disable --user", () => {
    expect(registerArgs("linux", p).at(-1)).toEqual({ cmd: "systemctl", args: ["--user", "enable", "--now", "ava-helper"] });
    expect(unregisterArgs("linux", p)[0]).toEqual({ cmd: "systemctl", args: ["--user", "disable", "--now", "ava-helper"] });
  });
  test("Windows: schtasks /Create /Delete", () => {
    expect(registerArgs("windows", p)[0]!.args).toContain("/Create");
    expect(unregisterArgs("windows", p)[0]!.args).toContain("/Delete");
  });
});

interface Recorder {
  copied: Array<[string, string]>;
  written: string[];
  ran: Array<{ cmd: string; args: string[] }>;
  trust: number;
  deps: InstallDeps;
}

function recorder(): Recorder {
  const r: Recorder = { copied: [], written: [], ran: [], trust: 0, deps: {} as InstallDeps };
  r.deps = {
    mkdirp: () => {},
    copyFile: (from, to) => { r.copied.push([from, to]); },
    chmodExec: () => {},
    writeFile: (path) => { r.written.push(path); },
    run: (cmd, args) => { r.ran.push({ cmd, args }); },
    installTrust: () => { r.trust += 1; },
    log: () => {},
  };
  return r;
}

describe("installService (orkestrering)", () => {
  test("macOS: kopierar binär, skriver plist, laddar launchd, installerar trust", () => {
    const r = recorder();
    const ok = installService("darwin", HOME, "/tmp/ava-helper", r.deps);
    expect(ok).toBe(true);
    expect(r.copied[0]![1]).toBe(`${HOME}/Library/Application Support/AVA/ava-helper`);
    expect(r.written.some((p) => p.endsWith("se.ava.helper.plist"))).toBe(true);
    expect(r.ran.some((c) => c.cmd === "launchctl" && c.args.includes("load"))).toBe(true);
    expect(r.trust).toBe(1);
  });

  test("Linux: ingen trust, systemctl enable", () => {
    const r = recorder();
    installService("linux", HOME, "/tmp/ava-helper", r.deps);
    expect(r.trust).toBe(0);
    expect(r.ran.some((c) => c.cmd === "systemctl" && c.args.includes("enable"))).toBe(true);
  });

  test("hoppar kopiering när binären redan ligger på målet", () => {
    const r = recorder();
    const target = `${HOME}/.local/share/AVA/ava-helper`;
    installService("linux", HOME, target, r.deps);
    expect(r.copied).toHaveLength(0);
  });

  test("ostödd plattform → false, inga sidoeffekter", () => {
    const r = recorder();
    expect(installService("other", HOME, "/tmp/x", r.deps)).toBe(false);
    expect(r.written).toHaveLength(0);
  });
});

describe("uninstallService", () => {
  test("macOS: launchctl unload", () => {
    const r = recorder();
    expect(uninstallService("darwin", HOME, r.deps)).toBe(true);
    expect(r.ran[0]).toEqual({ cmd: "launchctl", args: ["unload", "-w", `${HOME}/Library/LaunchAgents/se.ava.helper.plist`] });
  });
});
