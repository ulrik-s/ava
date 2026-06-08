import { describe, expect, test } from "bun:test";

import {
  applescriptQuote,
  escapePs,
  escapeUrl,
  linuxArgs,
  macScript,
  macToRecipient,
  mailCommand,
  windowsFallbackCommand,
  windowsScript,
  type ComposeMailOpts,
} from "../src/platform/mail.ts";

const opts: ComposeMailOpts = {
  to: "a@b.se",
  subject: "Hej",
  body: "Brödtext",
  attachmentPath: "/tmp/brev.html",
};

// Variant utan `to` (exactOptionalPropertyTypes tillåter inte to: undefined).
const optsNoTo: ComposeMailOpts = {
  subject: "Hej",
  body: "Brödtext",
  attachmentPath: "/tmp/brev.html",
};

describe("applescriptQuote", () => {
  test("escapar backslash + citationstecken", () => {
    expect(applescriptQuote('a "b" c')).toBe('"a \\"b\\" c"');
    expect(applescriptQuote("a\\b")).toBe('"a\\\\b"');
  });
  test("svenska tecken passerar orörda", () => {
    expect(applescriptQuote("Förordnande åäö")).toBe('"Förordnande åäö"');
  });
});

describe("escapePs", () => {
  test("dubblerar single-quotes", () => {
    expect(escapePs("it's a test")).toBe("it''s a test");
  });
});

describe("escapeUrl", () => {
  test("escapar mellanslag + radbryt", () => {
    expect(escapeUrl("hej och hå")).toBe("hej%20och%20hå");
    expect(escapeUrl("rad1\nrad2")).toBe("rad1%0Arad2");
  });
});

describe("macToRecipient", () => {
  test("tom adress → tom sträng", () => {
    expect(macToRecipient("")).toBe("");
  });
  test("adress → AppleScript-rad med escapad address", () => {
    expect(macToRecipient("a@b.se")).toContain('address:"a@b.se"');
  });
});

describe("linuxArgs", () => {
  test("inkluderar attach/subject/body + mottagare sist", () => {
    expect(linuxArgs(opts)).toEqual([
      "--attach", "/tmp/brev.html", "--subject", "Hej", "--body", "Brödtext", "a@b.se",
    ]);
  });
  test("utelämnar mottagare när to saknas", () => {
    expect(linuxArgs(optsNoTo)).not.toContain("a@b.se");
  });
});

describe("windowsScript", () => {
  test("bygger Outlook-COM-script med escapade fält", () => {
    const s = windowsScript({ ...opts, body: "it's" });
    expect(s).toContain("New-Object -ComObject Outlook.Application");
    expect(s).toContain("$mail.Attachments.Add('/tmp/brev.html')");
    expect(s).toContain("$mail.Body = 'it''s'");
  });
});

describe("macScript", () => {
  test("innehåller subject, body och attachment-path", () => {
    const s = macScript(opts);
    expect(s).toContain('subject:"Hej"');
    expect(s).toContain('content:"Brödtext"');
    expect(s).toContain("POSIX file \"/tmp/brev.html\"");
  });
});

describe("mailCommand", () => {
  test("macOS → osascript -e <script>", () => {
    const c = mailCommand("darwin", opts);
    expect(c.cmd).toBe("osascript");
    expect(c.args[0]).toBe("-e");
    expect(c.args[1]).toContain("tell application \"Mail\"");
  });
  test("Linux → xdg-email", () => {
    expect(mailCommand("linux", opts).cmd).toBe("xdg-email");
  });
  test("Windows → powershell", () => {
    const c = mailCommand("windows", opts);
    expect(c.cmd).toBe("powershell");
    expect(c.args.slice(0, 2)).toEqual(["-NoProfile", "-Command"]);
  });
  test("okänt OS kastar", () => {
    expect(() => mailCommand("other", opts)).toThrow("unsupported OS: other");
  });
});

describe("windowsFallbackCommand", () => {
  test("mailto via rundll32 med escapade fält", () => {
    const c = windowsFallbackCommand({ ...opts, subject: "ett mål", body: "rad1\nrad2" });
    expect(c.cmd).toBe("rundll32");
    expect(c.args[1]).toBe("mailto:a@b.se?subject=ett%20mål&body=rad1%0Arad2");
  });
  test("tom mottagare → mailto: utan adress", () => {
    expect(windowsFallbackCommand(optsNoTo).args[1]).toStartWith("mailto:?");
  });
});
