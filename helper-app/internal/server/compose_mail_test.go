package server

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestComposeMail_RejectsGET(t *testing.T) {
	ts := httptest.NewServer(New("test", nil).Handler())
	defer ts.Close()
	resp, err := http.Get(ts.URL + "/compose-mail")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", resp.StatusCode)
	}
}

func TestComposeMail_RejectsMissingFields(t *testing.T) {
	ts := httptest.NewServer(New("test", nil).Handler())
	defer ts.Close()
	body := strings.NewReader(`{}`)
	resp, _ := http.Post(ts.URL+"/compose-mail", "application/json", body)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 for missing fileName/contentBase64, got %d", resp.StatusCode)
	}
}

func TestComposeMail_RejectsInvalidBase64(t *testing.T) {
	ts := httptest.NewServer(New("test", nil).Handler())
	defer ts.Close()
	req := ComposeMailRequest{
		FileName: "test.html", ContentBase64: "%%%%", Subject: "s", Body: "b",
	}
	b, _ := json.Marshal(req)
	resp, _ := http.Post(ts.URL+"/compose-mail", "application/json", strings.NewReader(string(b)))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid base64, got %d", resp.StatusCode)
	}
}

func TestComposeMail_RejectsPathTraversalFileName(t *testing.T) {
	ts := httptest.NewServer(New("test", nil).Handler())
	defer ts.Close()
	content := base64.StdEncoding.EncodeToString([]byte("hello"))
	req := ComposeMailRequest{
		FileName: "../etc/passwd", ContentBase64: content, Subject: "s", Body: "b",
	}
	b, _ := json.Marshal(req)
	resp, _ := http.Post(ts.URL+"/compose-mail", "application/json", strings.NewReader(string(b)))
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 for path-traversal name, got %d (body=%s)", resp.StatusCode, body)
	}
}
