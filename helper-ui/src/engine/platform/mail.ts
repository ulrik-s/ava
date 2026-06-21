/**
 * `composeMail` — öppna OS:ets mail-app med ett förifyllt kompositions-
 * fönster + bifogad fil. Returnerar utan att vänta på user-action.
 * (Port av Go:s platform.ComposeMail.)
 *
 *   - macOS: AppleScript mot Mail.app (make new outgoing message, visible).
 *   - Linux: `xdg-email --attach --subject --body` (Thunderbird/Evolution …).
 *   - Windows: Outlook COM via PowerShell, fallback `mailto:` (utan bilaga).
 *
 * Kommando-byggarna (`mailCommand`, `windowsFallbackCommand` + script-/
 * arg-/url-byggarna) är rena → testbara utan spawn (SOLID).
 */

import type { Command } from "./command.ts";
import { currentPlatform, type Platform } from "./runtime.ts";
import { spawnDetached } from "./spawn.ts";

export interface ComposeMailOpts {
  /** Valfri, default tom. */
  to?: string;
  subject: string;
  body: string;
  /** Absolut sökväg till bilagan. */
  attachmentPath: string;
}

export async function composeMail(opts: ComposeMailOpts): Promise<void> {
  if (opts.attachmentPath === "") {
    throw new Error("attachmentPath required");
  }
  const platform = currentPlatform();
  if (platform === "windows") {
    await composeWindows(opts);
    return;
  }
  const { cmd, args } = mailCommand(platform, opts);
  await spawnDetached(cmd, args).started;
}

/** Primärt mail-kommando per plattform (ren). Kastar för okänt OS. */
export function mailCommand(platform: Platform, opts: ComposeMailOpts): Command {
  switch (platform) {
    case "darwin":
      return { cmd: "osascript", args: ["-e", macScript(opts)] };
    case "linux":
      return { cmd: "xdg-email", args: linuxArgs(opts) };
    case "windows":
      return { cmd: "powershell", args: ["-NoProfile", "-Command", windowsScript(opts)] };
    default:
      throw new Error(`unsupported OS: ${platform}`);
  }
}

/** Windows-fallback: mailto (utan bilaga — stöds inte av standard-attach). */
export function windowsFallbackCommand(opts: ComposeMailOpts): Command {
  const url = `mailto:${opts.to ?? ""}?subject=${escapeUrl(opts.subject)}&body=${escapeUrl(opts.body)}`;
  return { cmd: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
}

async function composeWindows(opts: ComposeMailOpts): Promise<void> {
  const primary = mailCommand("windows", opts);
  try {
    await spawnDetached(primary.cmd, primary.args).started;
  } catch {
    const fb = windowsFallbackCommand(opts);
    await spawnDetached(fb.cmd, fb.args).started;
  }
}

export function macScript(opts: ComposeMailOpts): string {
  return `
tell application "Mail"
  activate
  set newMsg to make new outgoing message with properties {visible:true, subject:${applescriptQuote(opts.subject)}, content:${applescriptQuote(opts.body)}}
  tell newMsg
    ${macToRecipient(opts.to ?? "")}
    tell content
      make new attachment with properties {file name:(POSIX file ${applescriptQuote(opts.attachmentPath)})} at after the last paragraph
    end tell
  end tell
end tell`;
}

export function macToRecipient(to: string): string {
  if (to === "") return "";
  return `make new to recipient at end of to recipients with properties {address:${applescriptQuote(to)}}`;
}

/** Kapsla en sträng som AppleScript-literal (escapar `\` och `"`). */
export function applescriptQuote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function linuxArgs(opts: ComposeMailOpts): string[] {
  const args = ["--attach", opts.attachmentPath, "--subject", opts.subject, "--body", opts.body];
  if (opts.to !== undefined && opts.to !== "") args.push(opts.to);
  return args;
}

export function windowsScript(opts: ComposeMailOpts): string {
  return [
    "$ol = New-Object -ComObject Outlook.Application",
    "$mail = $ol.CreateItem(0)",
    `$mail.To = '${escapePs(opts.to ?? "")}'`,
    `$mail.Subject = '${escapePs(opts.subject)}'`,
    `$mail.Body = '${escapePs(opts.body)}'`,
    `$mail.Attachments.Add('${escapePs(opts.attachmentPath)}') | Out-Null`,
    "$mail.Display()",
  ].join("\n");
}

/** PowerShell single-quote-escape (`'` → `''`). */
export function escapePs(s: string): string {
  return s.replace(/'/g, "''");
}

/** Minimal mailto-escape (mellanslag + radbryt). */
export function escapeUrl(s: string): string {
  return s.replace(/ /g, "%20").replace(/\n/g, "%0A");
}
