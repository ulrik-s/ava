package server

import "os"

// getEnv — wrapper med default-värde.
func getEnv(key, fallback string) string {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	return v
}
