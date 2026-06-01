package platform

import (
	"fmt"
	"os/exec"
	"runtime"
	"strings"
)

// ComposeMail öppnar OS:s mail-app med ett förifyllt kompositions-fönster
// och en bifogad fil. Returnerar utan att vänta på user-action (mail-app:n
// startar — användaren fyller adressat och skickar).
//
//   - macOS: AppleScript mot Mail.app. Skapar "make new outgoing message"
//     med subject + body + attachment, sätter visible:true så fönstret poppar.
//   - Linux: xdg-email --attach + --subject + --body. Funkar med
//     Thunderbird, Evolution, etc. via xdg-utils.
//   - Windows: rundll32 + mailto. Begränsat: bifogning via mailto stöds
//     inte officiellt; Outlook respekterar det informellt, andra klienter
//     ignorerar bilagan. Best-effort.
func ComposeMail(opts ComposeMailOpts) error {
	if opts.AttachmentPath == "" {
		return fmt.Errorf("attachmentPath required")
	}
	switch runtime.GOOS {
	case "darwin":
		return composeMac(opts)
	case "linux":
		return composeLinux(opts)
	case "windows":
		return composeWindows(opts)
	default:
		return fmt.Errorf("unsupported OS: %s", runtime.GOOS)
	}
}

// ComposeMailOpts — input till ComposeMail.
type ComposeMailOpts struct {
	To             string // valfri, default tom
	Subject        string
	Body           string
	AttachmentPath string // absolut sökväg till bilagan
}

func composeMac(opts ComposeMailOpts) error {
	// AppleScript: kapsla in body som "via shell" så multi-line + svenska
	// tecken funkar. Använder POSIX file för bilagan så Mail.app hanterar
	// path:en korrekt.
	script := fmt.Sprintf(`
tell application "Mail"
  activate
  set newMsg to make new outgoing message with properties {visible:true, subject:%s, content:%s}
  tell newMsg
    %s
    tell content
      make new attachment with properties {file name:(POSIX file %s)} at after the last paragraph
    end tell
  end tell
end tell`,
		applescriptQuote(opts.Subject),
		applescriptQuote(opts.Body),
		macToRecipient(opts.To),
		applescriptQuote(opts.AttachmentPath),
	)
	return exec.Command("osascript", "-e", script).Start()
}

func macToRecipient(to string) string {
	if to == "" {
		return ""
	}
	return "make new to recipient at end of to recipients with properties {address:" + applescriptQuote(to) + "}"
}

// applescriptQuote — kapsla en sträng som AppleScript-literal. Escapar
// dubbel-citationstecken och backslash så strängen är säker.
func applescriptQuote(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `"`, `\"`)
	return `"` + r.Replace(s) + `"`
}

func composeLinux(opts ComposeMailOpts) error {
	args := []string{
		"--attach", opts.AttachmentPath,
		"--subject", opts.Subject,
		"--body", opts.Body,
	}
	if opts.To != "" {
		args = append(args, opts.To)
	}
	return exec.Command("xdg-email", args...).Start()
}

func composeWindows(opts ComposeMailOpts) error {
	// Försök 1: Outlook COM via PowerShell — bifoga path:en korrekt.
	// Faller tillbaka på mailto om Outlook inte är installerat.
	ps := fmt.Sprintf(`
$ol = New-Object -ComObject Outlook.Application
$mail = $ol.CreateItem(0)
$mail.To = '%s'
$mail.Subject = '%s'
$mail.Body = '%s'
$mail.Attachments.Add('%s') | Out-Null
$mail.Display()`,
		escapePs(opts.To), escapePs(opts.Subject), escapePs(opts.Body), escapePs(opts.AttachmentPath))
	cmd := exec.Command("powershell", "-NoProfile", "-Command", ps)
	if err := cmd.Start(); err == nil {
		return nil
	}
	// Fallback: mailto (utan bilaga — Windows stöder inte standard-attach)
	url := fmt.Sprintf("mailto:%s?subject=%s&body=%s",
		opts.To, escapeURL(opts.Subject), escapeURL(opts.Body))
	return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}

func escapePs(s string) string {
	return strings.ReplaceAll(s, "'", "''")
}

func escapeURL(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, " ", "%20"), "\n", "%0A")
}
