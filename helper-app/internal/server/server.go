// Package server — HTTP-API:t som AVA-webbappen pratar med.
//
// Endpoints (alla på 127.0.0.1:48761):
//
//	GET  /ping            → "ava-helper <version>\n" (text)
//	GET  /version         → JSON { current, latest, updateAvailable }
//	POST /open            → download → spawn default-app → watch+upload
//	POST /check-update    → trigga omedelbar self-update-kontroll
//
// Säkerhet:
//   - Lyssnar bara på localhost (127.0.0.1)
//   - CORS-whitelist: localhost-portar + *.github.io + custom firma-domäner
//   - Inga endpoints som exekverar godtyckliga kommandon — bara
//     OS-default-app-spawn på user-given path.
package server

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/ulrik-s/ava/helper-app/internal/update"
)

// Server bär runt state mellan endpoints.
type Server struct {
	version   string
	updateCfg *update.Config
}

func New(version string, updateCfg *update.Config) *Server {
	return &Server{version: version, updateCfg: updateCfg}
}

// Handler returnerar HTTP-mux med CORS-wrappning.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/ping", s.handlePing)
	mux.HandleFunc("/version", s.handleVersion)
	mux.HandleFunc("/open", s.handleOpen)
	mux.HandleFunc("/compose-mail", s.handleComposeMail)
	mux.HandleFunc("/check-update", s.handleCheckUpdate)
	return withCORS(mux)
}

func (s *Server) handlePing(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write([]byte("ava-helper " + s.version + "\n"))
}

func (s *Server) handleVersion(w http.ResponseWriter, _ *http.Request) {
	json.NewEncoder(w).Encode(map[string]any{
		"current":         s.version,
		"updateAvailable": false, // populated via async check
	})
}

func (s *Server) handleCheckUpdate(w http.ResponseWriter, _ *http.Request) {
	// Triggar update-loopen omedelbart. Returnerar status; faktisk
	// uppdatering sker async — om en finns exit:ar helpern efteråt.
	if s.updateCfg == nil {
		http.Error(w, "update not configured", http.StatusInternalServerError)
		return
	}
	go update.CheckOnce(s.updateCfg)
	w.WriteHeader(http.StatusAccepted)
	_, _ = w.Write([]byte("update check triggered\n"))
}

// ─── CORS ────────────────────────────────────────────────────────────

// Allowed origins: localhost (dev/self-hosted) + GitHub Pages (demo)
// + valfritt domäner satta via AVA_HELPER_ORIGINS env-var.
func isAllowedOrigin(origin string) bool {
	if origin == "" {
		return false
	}
	if strings.HasPrefix(origin, "http://localhost:") ||
		strings.HasPrefix(origin, "http://127.0.0.1:") {
		return true
	}
	// *.github.io (för GH-Pages-demon)
	if strings.HasSuffix(origin, ".github.io") {
		return true
	}
	// Konfigurerbara extra origins (komma-separerade) via env-var
	for _, extra := range strings.Split(getEnv("AVA_HELPER_ORIGINS", ""), ",") {
		extra = strings.TrimSpace(extra)
		if extra != "" && extra == origin {
			return true
		}
	}
	return false
}

func withCORS(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if isAllowedOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		h.ServeHTTP(w, r)
	})
}
