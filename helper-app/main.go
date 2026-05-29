// Package main — ava-helper är en liten localhost-bryggar-app som låter
// AVA-webbapparna öppna dokument i native-editorer (PDF Gear, Word,
// Preview…) och automatiskt synka tillbaka ändringarna.
//
// Designprinciper:
//   - Tier-agnostisk: helpern vet inget om AVA:s backend (git/Postgres).
//     Web-appen skickar downloadUrl + uploadUrl per fil.
//   - Localhost-only: lyssnar på 127.0.0.1:48761, ingen extern access.
//   - CORS-whitelist mot AVA:s origins (localhost, *.github.io,
//     självvärdad firma-server).
//   - Self-update: kontrollerar GitHub releases dagligen och ersätter
//     sig själv (atomisk on Mac/Linux/Win via go-selfupdate).
//   - Restart-policy: service-runner (launchd/systemd/sc.exe) startar om
//     om processen exit:ar, så self-update bara behöver "exit 0".
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/ulrik-s/ava/helper-app/internal/server"
	"github.com/ulrik-s/ava/helper-app/internal/update"
)

// Version sätts vid build via -ldflags "-X main.Version=v1.2.3".
var Version = "dev"

const (
	ListenAddr      = "127.0.0.1:48761"
	ShutdownTimeout = 5 * time.Second
)

func main() {
	flagVersion := flag.Bool("version", false, "skriv ut versionen och avsluta")
	flag.Parse()
	if *flagVersion {
		fmt.Println(Version)
		return
	}

	logFile := openLogFile()
	if logFile != nil {
		log.SetOutput(logFile)
		defer logFile.Close()
	}

	log.Printf("ava-helper %s startar på %s", Version, ListenAddr)

	// Bakgrund: dagligen kontrollera nya releases. Helpern exitar (kod 0)
	// efter självuppdatering → service-runner startar om med nya binären.
	updateCfg := update.Config{
		CurrentVersion: Version,
		Repo:           "ulrik-s/ava",
		TagFilter:      "helper-",
		CheckInterval:  24 * time.Hour,
		InitialDelay:   5 * time.Minute,
		OnUpdated: func(newVersion string) {
			log.Printf("self-update klar (%s → %s) — exiterar för restart", Version, newVersion)
			os.Exit(0)
		},
	}
	go update.RunLoop(context.Background(), updateCfg)

	srv := &http.Server{
		Addr:              ListenAddr,
		Handler:           server.New(Version, &updateCfg).Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	// Graceful shutdown vid SIGTERM/SIGINT
	go func() {
		ch := make(chan os.Signal, 1)
		signal.Notify(ch, syscall.SIGTERM, syscall.SIGINT)
		<-ch
		ctx, cancel := context.WithTimeout(context.Background(), ShutdownTimeout)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}()

	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server fail: %v", err)
	}
	log.Printf("ava-helper avslutar")
}

// openLogFile öppnar ~/Library/Logs/AVA/helper.log (mac) eller
// motsvarande på Linux/Win. Tyst no-op vid fel — helpern ska aldrig
// vägra starta pga loggproblem.
func openLogFile() *os.File {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	var dir string
	switch {
	case isMac():
		dir = filepath.Join(home, "Library", "Logs", "AVA")
	case isWin():
		dir = filepath.Join(os.Getenv("LOCALAPPDATA"), "AVA", "Logs")
	default:
		dir = filepath.Join(home, ".local", "state", "AVA")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil
	}
	f, err := os.OpenFile(filepath.Join(dir, "helper.log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return nil
	}
	return f
}

func isMac() bool { return runtimeGOOS() == "darwin" }
func isWin() bool { return runtimeGOOS() == "windows" }
