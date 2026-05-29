// Package update — daglig kontroll mot GitHub releases + atomisk
// ersättning av egen binär via creativeprojects/go-selfupdate.
//
// Tagging-strategi: AVA är monorepo, så vi taggar helper-releaser
// "helper-vX.Y.Z" — separerat från web-app-releaser. Update-koden
// filtrerar GitHub-releaser via TagFilter-prefixet.
//
// Restart-policy: helpern exit:ar (kod 0) efter lyckad uppdatering.
// service-runner (launchd/systemd/sc.exe) startar om processen med
// nya binär-bytsen. Vi behöver inte re-exec:a själva.
package update

import (
	"context"
	"log"
	"os"
	"time"

	"github.com/creativeprojects/go-selfupdate"
)

type Config struct {
	// CurrentVersion — bakad in vid build via -ldflags.
	CurrentVersion string
	// Repo — "owner/name" på GitHub.
	Repo string
	// TagFilter — bara releases vars tag börjar med detta prefix beaktas
	// (t.ex. "helper-" för "helper-v1.2.3"-taggar i monorepot).
	TagFilter string
	// CheckInterval — hur ofta vi kollar (typiskt 24h).
	CheckInterval time.Duration
	// InitialDelay — vänta så länge efter start innan första kollen.
	InitialDelay time.Duration
	// OnUpdated — callback när ny binär skrivits. Får nya versionen.
	// Förväntas avsluta processen (os.Exit) så service-runner startar om.
	OnUpdated func(newVersion string)
}

// RunLoop kör forever — kolla, sov, kolla, sov. Anropa som goroutine.
func RunLoop(ctx context.Context, cfg Config) {
	if cfg.InitialDelay > 0 {
		select {
		case <-ctx.Done():
			return
		case <-time.After(cfg.InitialDelay):
		}
	}
	interval := cfg.CheckInterval
	if interval <= 0 {
		interval = 24 * time.Hour
	}
	for {
		if err := CheckOnce(&cfg); err != nil {
			log.Printf("update check failed: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(interval):
		}
	}
}

// CheckOnce — synkront en kontroll. Returnerar nil om allt OK (inkl. om
// ingen ny version finns).
func CheckOnce(cfg *Config) error {
	ctx := context.Background()
	source, err := selfupdate.NewGitHubSource(selfupdate.GitHubConfig{})
	if err != nil {
		return err
	}
	filterOpt := []string{}
	if cfg.TagFilter != "" {
		filterOpt = append(filterOpt, "^"+cfg.TagFilter+".*")
	}
	updater, err := selfupdate.NewUpdater(selfupdate.Config{
		Source:  source,
		Filters: filterOpt,
	})
	if err != nil {
		return err
	}
	repo := selfupdate.ParseSlug(cfg.Repo)
	latest, found, err := updater.DetectLatest(ctx, repo)
	if err != nil {
		return err
	}
	if !found || latest == nil {
		log.Printf("no release found for %s", cfg.Repo)
		return nil
	}
	if latest.LessOrEqual(cfg.CurrentVersion) {
		log.Printf("already up to date (%s)", cfg.CurrentVersion)
		return nil
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	log.Printf("updating %s → %s", cfg.CurrentVersion, latest.Version())
	if err := updater.UpdateTo(ctx, latest, exe); err != nil {
		return err
	}
	if cfg.OnUpdated != nil {
		cfg.OnUpdated(latest.Version())
	}
	return nil
}
