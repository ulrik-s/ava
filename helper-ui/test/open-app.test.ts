import { describe, expect, test } from "bun:test";

import { openCommand } from "../src/engine/platform/open-app.ts";

describe("openCommand", () => {
  test("macOS → open", () => {
    expect(openCommand("darwin", "/tmp/a.pdf")).toEqual({ cmd: "open", args: ["/tmp/a.pdf"] });
  });
  test("Linux → xdg-open", () => {
    expect(openCommand("linux", "/tmp/a.pdf")).toEqual({ cmd: "xdg-open", args: ["/tmp/a.pdf"] });
  });
  test("Windows → rundll32 FileProtocolHandler", () => {
    expect(openCommand("windows", "C:\\a.pdf")).toEqual({
      cmd: "rundll32",
      args: ["url.dll,FileProtocolHandler", "C:\\a.pdf"],
    });
  });
  test("okänt OS kastar", () => {
    expect(() => openCommand("other", "/tmp/a.pdf")).toThrow("unsupported OS: other");
  });
});
