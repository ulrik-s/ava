// Package platform — OS-specifik integration. Just nu bara "öppna med
// default-app". Vid behov: visa-i-finder, listartrayicons, etc.
package platform

import (
	"fmt"
	"os/exec"
	"runtime"
)

// OpenWithDefaultApp startar OS:ets default-app för filen. Helpern
// väntar INTE på att appen ska stänga — den returnerar så snart
// applikationen startat.
func OpenWithDefaultApp(path string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", path)
	case "linux":
		cmd = exec.Command("xdg-open", path)
	case "windows":
		// `rundll32 url.dll,FileProtocolHandler` triggar default-app
		// utan att öppna ett konsolfönster.
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", path)
	default:
		return fmt.Errorf("unsupported OS: %s", runtime.GOOS)
	}
	return cmd.Start()
}
