package server

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"

	"github.com/ulrik-s/ava/helper-app/internal/platform"
)

// ComposeMailRequest — vad AVA-webbappen skickar för att be helpern
// öppna OS:s mail-app med en bifogad fil.
type ComposeMailRequest struct {
	FileName      string `json:"fileName"`
	ContentBase64 string `json:"contentBase64"`
	MimeType      string `json:"mimeType,omitempty"`
	To            string `json:"to,omitempty"`
	Subject       string `json:"subject"`
	Body          string `json:"body"`
}

type ComposeMailResponse struct {
	Path   string `json:"path"`
	Status string `json:"status"`
}

func (s *Server) handleComposeMail(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req ComposeMailRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.FileName == "" || req.ContentBase64 == "" {
		http.Error(w, "fileName and contentBase64 required", http.StatusBadRequest)
		return
	}
	if !isSafeFileName(req.FileName) {
		http.Error(w, "invalid fileName", http.StatusBadRequest)
		return
	}

	bytes, err := base64.StdEncoding.DecodeString(req.ContentBase64)
	if err != nil {
		http.Error(w, "invalid base64", http.StatusBadRequest)
		return
	}

	sessionDir, err := os.MkdirTemp("", "ava-helper-mail-")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	attachmentPath := filepath.Join(sessionDir, req.FileName)
	if err := os.WriteFile(attachmentPath, bytes, 0o600); err != nil {
		http.Error(w, "write failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if err := platform.ComposeMail(platform.ComposeMailOpts{
		To: req.To, Subject: req.Subject, Body: req.Body,
		AttachmentPath: attachmentPath,
	}); err != nil {
		http.Error(w, "compose-mail failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(ComposeMailResponse{
		Path: attachmentPath, Status: "opened",
	})
}
