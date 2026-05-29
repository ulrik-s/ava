package main

import "runtime"

// runtimeGOOS — wrappa runtime.GOOS så det går att testa per-OS-grenar.
func runtimeGOOS() string { return runtime.GOOS }
