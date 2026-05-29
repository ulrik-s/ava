package server

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/ulrik-s/ava/helper-app/internal/platform"
)

// OpenRequest — vad AVA-webbappen skickar.
type OpenRequest struct {
	// DownloadURL — varifrån vi laddar ner fil-bytsen.
	DownloadURL string `json:"downloadUrl"`
	// UploadURL — vart vi PUT:ar ändrade bytes efter user save. Tom →
	// helpern öppnar bara filen (read-only).
	UploadURL string `json:"uploadUrl,omitempty"`
	// FileName — det namn user ska se i editorn.
	FileName string `json:"fileName"`
	// AuthHeader — vidarebefordras orörd till download+upload.
	AuthHeader string `json:"authHeader,omitempty"`
	// MaxWatchMinutes — hur länge helpern lyssnar på save-events.
	// Default 60 minuter; 0 = helpern stänger watchern direkt.
	MaxWatchMinutes int `json:"maxWatchMinutes,omitempty"`
}

// OpenResponse — vad helpern svarar med.
type OpenResponse struct {
	Path   string `json:"path"`
	Status string `json:"status"`
}

func (s *Server) handleOpen(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req OpenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.DownloadURL == "" || req.FileName == "" {
		http.Error(w, "downloadUrl and fileName required", http.StatusBadRequest)
		return
	}
	if !isSafeFileName(req.FileName) {
		http.Error(w, "invalid fileName", http.StatusBadRequest)
		return
	}

	// Skriv till en isolerad katalog per session — så samtidiga öppningar
	// av samma fil inte krockar.
	sessionDir, err := os.MkdirTemp("", "ava-helper-")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	tmpFile := filepath.Join(sessionDir, req.FileName)

	if err := downloadTo(tmpFile, req.DownloadURL, req.AuthHeader); err != nil {
		http.Error(w, "download failed: "+err.Error(), http.StatusBadGateway)
		return
	}
	if err := platform.OpenWithDefaultApp(tmpFile); err != nil {
		http.Error(w, "open failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if req.UploadURL != "" {
		watchMin := req.MaxWatchMinutes
		if watchMin <= 0 {
			watchMin = 60
		}
		go watchAndUpload(tmpFile, req.UploadURL, req.AuthHeader, time.Duration(watchMin)*time.Minute)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(OpenResponse{Path: tmpFile, Status: "opened"})
}

// isSafeFileName — sanity-check så user-given filnamn inte traverserar
// upp ur tempkatalogen (../etc/passwd).
func isSafeFileName(name string) bool {
	if name == "" || name == "." || name == ".." {
		return false
	}
	for _, r := range name {
		if r == '/' || r == '\\' || r == 0 {
			return false
		}
	}
	return true
}

func downloadTo(path, url, authHeader string) error {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := io.Copy(f, resp.Body); err != nil {
		return err
	}
	return nil
}

// watchAndUpload pollar filens mtime och PUT:ar nya bytes vid varje save.
// Stänger efter timeout om ingen aktivitet — så user kan stänga editorn
// utan att helpern fortsätter hålla session öppen för evigt.
func watchAndUpload(path, uploadURL, authHeader string, timeout time.Duration) {
	stat, err := os.Stat(path)
	if err != nil {
		return
	}
	lastMtime := stat.ModTime()
	deadline := time.Now().Add(timeout)
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		if time.Now().After(deadline) {
			log.Printf("watch timeout: %s", path)
			return
		}
		stat, err := os.Stat(path)
		if err != nil {
			continue
		}
		if !stat.ModTime().After(lastMtime) {
			continue
		}
		if err := uploadFile(path, uploadURL, authHeader); err != nil {
			log.Printf("upload failed (%s): %v", path, err)
			continue
		}
		log.Printf("uploaded changes: %s", path)
		lastMtime = stat.ModTime()
		// Förläng deadline efter aktivitet — user editerar fortfarande.
		deadline = time.Now().Add(timeout)
	}
}

func uploadFile(path, uploadURL, authHeader string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	req, err := http.NewRequest(http.MethodPut, uploadURL, f)
	if err != nil {
		return err
	}
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("upload HTTP %d", resp.StatusCode)
	}
	return nil
}
