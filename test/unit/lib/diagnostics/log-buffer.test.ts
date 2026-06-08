import { describe, it, expect, vi } from "vitest-compat";
import {
  LogBuffer,
  formatArgs,
  installConsoleCapture,
} from "@/lib/client/diagnostics/log-buffer";

describe("formatArgs", () => {
  it("slår ihop strängar, objekt och fel", () => {
    expect(formatArgs(["a", 1, { b: 2 }])).toBe('a 1 {"b":2}');
    expect(formatArgs([new Error("boom")])).toBe("Error: boom");
    expect(formatArgs([undefined])).toBe("undefined");
  });

  it("faller tillbaka på String() vid cirkulär struktur", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(formatArgs([circular])).toBe("[object Object]");
  });
});

describe("LogBuffer", () => {
  it("kräver positiv kapacitet", () => {
    expect(() => new LogBuffer(0)).toThrow();
  });

  it("behåller bara de senaste posterna (ringbuffert)", () => {
    const buf = new LogBuffer(2);
    buf.push({ level: "log", ts: 1, text: "a" });
    buf.push({ level: "log", ts: 2, text: "b" });
    buf.push({ level: "log", ts: 3, text: "c" });
    expect(buf.size()).toBe(2);
    expect(buf.recent().map((e) => e.text)).toEqual(["b", "c"]);
  });

  it("recent(n) returnerar de n senaste, äldst först", () => {
    const buf = new LogBuffer(10);
    for (let i = 0; i < 5; i++) buf.push({ level: "log", ts: i, text: `m${i}` });
    expect(buf.recent(2).map((e) => e.text)).toEqual(["m3", "m4"]);
    expect(buf.recent(99).map((e) => e.text)).toHaveLength(5);
  });

  it("clear() tömmer bufferten", () => {
    const buf = new LogBuffer();
    buf.push({ level: "warn", ts: 1, text: "x" });
    buf.clear();
    expect(buf.size()).toBe(0);
  });

  it("toText() ger en rad per post med nivå", () => {
    const buf = new LogBuffer();
    buf.push({ level: "error", ts: 0, text: "kaboom" });
    expect(buf.toText()).toContain("ERROR kaboom");
  });
});

function fakeConsole() {
  return { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function fakeTarget() {
  const listeners = new Map<string, (ev: unknown) => void>();
  return {
    listeners,
    addEventListener: (t: string, l: (ev: unknown) => void) => listeners.set(t, l),
    removeEventListener: (t: string) => listeners.delete(t),
    emit: (t: string, ev: unknown) => listeners.get(t)?.(ev),
  };
}

describe("installConsoleCapture", () => {
  it("fångar console.* till bufferten OCH anropar originalet", () => {
    const buf = new LogBuffer();
    const con = fakeConsole();
    const warnSpy = con.warn; // wrappern ersätter con.warn → behåll spion-ref
    let t = 100;
    const uninstall = installConsoleCapture({ buffer: buf, console: con, target: null, now: () => t++ });

    con.warn("hej", 42);
    con.error("trasig");

    expect(warnSpy).toHaveBeenCalledWith("hej", 42); // originalet kördes
    expect(buf.recent().map((e) => ({ level: e.level, text: e.text }))).toEqual([
      { level: "warn", text: "hej 42" },
      { level: "error", text: "trasig" },
    ]);
    uninstall();
  });

  it("uninstall återställer originalmetoderna", () => {
    const buf = new LogBuffer();
    const con = fakeConsole();
    const origLog = con.log;
    const uninstall = installConsoleCapture({ buffer: buf, console: con, target: null });
    expect(con.log).not.toBe(origLog);
    uninstall();
    expect(con.log).toBe(origLog);
  });

  it("är idempotent — andra install:en blir no-op", () => {
    const buf = new LogBuffer();
    const con = fakeConsole();
    const un1 = installConsoleCapture({ buffer: buf, console: con, target: null });
    const wrapped = con.log;
    const un2 = installConsoleCapture({ buffer: buf, console: con, target: null });
    expect(con.log).toBe(wrapped); // inte dubbel-wrappad
    un2(); // no-op
    expect(con.log).toBe(wrapped);
    un1();
  });

  it("fångar error- och unhandledrejection-events", () => {
    const buf = new LogBuffer();
    const con = fakeConsole();
    const target = fakeTarget();
    const uninstall = installConsoleCapture({ buffer: buf, console: con, target, now: () => 0 });

    target.emit("error", { message: "synkfel", filename: "a.js", lineno: 12 });
    target.emit("error", { error: new Error("objektfel") });
    target.emit("unhandledrejection", { reason: new Error("avvisad") });

    expect(buf.recent().map((e) => `${e.level}:${e.text}`)).toEqual([
      "uncaught:synkfel (a.js:12)",
      "uncaught:Error: objektfel",
      "rejection:Error: avvisad",
    ]);

    uninstall();
    expect(target.listeners.size).toBe(0);
  });
});
