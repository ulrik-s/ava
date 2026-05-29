package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	srv := New("v1.2.3-test", nil)
	return httptest.NewServer(srv.Handler())
}

func TestPing(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()
	resp, err := http.Get(ts.URL + "/ping")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), "ava-helper v1.2.3-test") {
		t.Errorf("body missing version: %q", string(body))
	}
}

func TestVersion(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()
	resp, err := http.Get(ts.URL + "/version")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var v map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		t.Fatal(err)
	}
	if v["current"] != "v1.2.3-test" {
		t.Errorf("current: got %v", v["current"])
	}
}

func TestCORSAllowsLocalhost(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()
	req, _ := http.NewRequest("OPTIONS", ts.URL+"/ping", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != "http://localhost:3000" {
		t.Errorf("expected CORS allow for localhost, got %q", got)
	}
}

func TestCORSAllowsGithubIO(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()
	req, _ := http.NewRequest("OPTIONS", ts.URL+"/ping", nil)
	req.Header.Set("Origin", "https://ulrik-s.github.io")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != "https://ulrik-s.github.io" {
		t.Errorf("expected CORS allow for github.io, got %q", got)
	}
}

func TestCORSBlocksUnknownOrigin(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()
	req, _ := http.NewRequest("OPTIONS", ts.URL+"/ping", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("expected no CORS for evil.example.com, got %q", got)
	}
}

func TestOpenRequiresPost(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()
	resp, _ := http.Get(ts.URL + "/open")
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", resp.StatusCode)
	}
}

func TestOpenRejectsInvalidBody(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()
	resp, _ := http.Post(ts.URL+"/open", "application/json", strings.NewReader("not-json"))
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", resp.StatusCode)
	}
}

func TestOpenRejectsTraversalFileName(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()
	body := `{"downloadUrl":"http://example.com/f","fileName":"../etc/passwd"}`
	resp, _ := http.Post(ts.URL+"/open", "application/json", strings.NewReader(body))
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 for path-traversal fileName, got %d", resp.StatusCode)
	}
}

func TestIsSafeFileName(t *testing.T) {
	good := []string{"foo.pdf", "förordnande.docx", "rapport 2026-05.xlsx"}
	bad := []string{"", ".", "..", "../etc", "a/b", `a\b`}
	for _, n := range good {
		if !isSafeFileName(n) {
			t.Errorf("expected safe: %q", n)
		}
	}
	for _, n := range bad {
		if isSafeFileName(n) {
			t.Errorf("expected unsafe: %q", n)
		}
	}
}
