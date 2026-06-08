/**
 * `composeMail` — öppna OS:ets mail-app med ett förifyllt kompositions-
 * fönster + bifogad fil. Returnerar utan att vänta på user-action.
 * (Port av Go:s platform.ComposeMail.)
 *
 *   - macOS: AppleScript mot Mail.app (make new outgoing message, visible).
 *   - Linux: `xdg-email --attach --subject --body` (Thunderbird/Evolution …).
 *   - Windows: Outlook COM via PowerShell, fallback `mailto:` (utan bilaga).
 */

import { currentPlatform } from "./runtime.ts";
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
  switch (currentPlatform()) {
    case "darwin":
      await spawnDetached("osascript", ["-e", macScript(opts)]).started;
      return;
    case "linux":
      await spawnDetached("xdg-email", linuxArgs(opts)).started;
      return;
    case "windows":
      await composeWindows(opts);
      return;
    default:
      throw new Error(`unsupported OS: ${process.platform}`);
  }
}

function macScript(opts: ComposeMailOpts): string {
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

function macToRecipient(to: string): string {
  if (to === "") return "";
  return `make new to recipient at end of to recipients with properties {address:${applescriptQuote(to)}}`;
}

/** Kapsla en sträng som AppleScript-literal (escapar `\` och `"`). */
export function applescriptQuote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function linuxArgs(opts: ComposeMailOpts): string[] {
  const args = ["--attach", opts.attachmentPath, "--subject", opts.subject, "--body", opts.body];
  if (opts.to !== undefined && opts.to !== "") args.push(opts.to);
  return args;
}

async function composeWindows(opts: ComposeMailOpts): Promise<void> {
  const ps = [
    "$ol = New-Object -ComObject Outlook.Application",
    "$mail = $ol.CreateItem(0)",
    `$mail.To = '${escapePs(opts.to ?? "")}'`,
    `$mail.Subject = '${escapePs(opts.subject)}'`,
    `$mail.Body = '${escapePs(opts.body)}'`,
    `$mail.Attachments.Add('${escapePs(opts.attachmentPath)}') | Out-Null`,
    "$mail.Display()",
  ].join("\n");
  try {
    await spawnDetached("powershell", ["-NoProfile", "-Command", ps]).started;
  } catch {
    // Fallback: mailto (utan bilaga — Windows stöder inte standard-attach).
    const url = `mailto:${opts.to ?? ""}?subject=${escapeUrl(opts.subject)}&body=${escapeUrl(opts.body)}`;
    await spawnDetached("rundll32", ["url.dll,FileProtocolHandler", url]).started;
  }
}

/** PowerShell single-quote-escape (`'` → `''`). */
export function escapePs(s: string): string {
  return s.replace(/'/g, "''");
}

/** Minimal mailto-escape (mellanslag + radbryt). */
export function escapeUrl(s: string): string {
  return s.replace(/ /g, "%20").replace(/\n/g, "%0A");
}
