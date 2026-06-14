/**
 * Tester för `AuthProvider` + `useAuthMode`.
 *
 */

import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import {
  AuthProvider,
  useAuthMode,
  useIsWriteAllowed,
  loadAuthSettings,
  saveAuthSettings,
} from "@/lib/client/auth/use-auth-mode";

beforeEach(() => {
  localStorage.clear();
});

describe("AuthProvider — basic mode-detection", () => {
  it("ingen token → anonymous", async () => {
    const detect = vi.fn().mockResolvedValue("anonymous");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider token="" repoUrl="ulrik-s/ava-demo" detect={detect} fetchUser={async () => null}>
        {children}
      </AuthProvider>
    );
    const { result } = renderHook(() => useAuthMode(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.mode).toBe("anonymous");
    expect(result.current.user).toBeNull();
  });

  it("giltig token + push → identified-write", async () => {
    const detect = vi.fn().mockResolvedValue("identified-write");
    const fetchUser = vi.fn().mockResolvedValue({ login: "anna", id: 1, name: "Anna" });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider token="ghp_x" repoUrl="ulrik-s/ava-demo" detect={detect} fetchUser={fetchUser}>
        {children}
      </AuthProvider>
    );
    const { result } = renderHook(() => useAuthMode(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.mode).toBe("identified-write");
    expect(result.current.user?.login).toBe("anna");
  });

  it("token utan push → identified-read", async () => {
    const detect = vi.fn().mockResolvedValue("identified-read");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider
        token="ghp_x" repoUrl="other/repo"
        detect={detect}
        fetchUser={async () => ({ login: "guest", id: 2, name: "G" })}
      >
        {children}
      </AuthProvider>
    );
    const { result } = renderHook(() => useAuthMode(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.mode).toBe("identified-read");
  });

  it("fel i detect lämnar error-state och anonymous mode", async () => {
    const detect = vi.fn().mockRejectedValue(new Error("network"));
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider token="x" repoUrl="u/r" detect={detect} fetchUser={async () => null}>
        {children}
      </AuthProvider>
    );
    const { result } = renderHook(() => useAuthMode(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toContain("network");
  });
});

describe("shouldRequireLogin", () => {
  it("anonymous + allowAnonymousRead=false → kräv login", async () => {
    const detect = vi.fn().mockResolvedValue("anonymous");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider
        token="" repoUrl="u/r"
        detect={detect} fetchUser={async () => null}
        settings={{ allowAnonymousRead: false }}
      >
        {children}
      </AuthProvider>
    );
    const { result } = renderHook(() => useAuthMode(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.shouldRequireLogin).toBe(true);
  });

  it("identified + allowAnonymousRead=false → få ändå komma in", async () => {
    const detect = vi.fn().mockResolvedValue("identified-read");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider
        token="x" repoUrl="u/r"
        detect={detect}
        fetchUser={async () => ({ login: "anna", id: 1 })}
        settings={{ allowAnonymousRead: false }}
      >
        {children}
      </AuthProvider>
    );
    const { result } = renderHook(() => useAuthMode(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.shouldRequireLogin).toBe(false);
  });

  it("anonymous + allowAnonymousRead=true → ingen login krävs", async () => {
    const detect = vi.fn().mockResolvedValue("anonymous");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider
        token="" repoUrl="u/r"
        detect={detect} fetchUser={async () => null}
        settings={{ allowAnonymousRead: true }}
      >
        {children}
      </AuthProvider>
    );
    const { result } = renderHook(() => useAuthMode(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.shouldRequireLogin).toBe(false);
  });
});

describe("useIsWriteAllowed", () => {
  it("true bara i identified-write-mode", async () => {
    const detect = vi.fn().mockResolvedValue("identified-write");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider token="x" repoUrl="u/r" detect={detect} fetchUser={async () => ({ login: "a", id: 1 })}>
        {children}
      </AuthProvider>
    );
    const { result } = renderHook(() => useIsWriteAllowed(), { wrapper });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("false i anonymous-mode", async () => {
    const detect = vi.fn().mockResolvedValue("anonymous");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider token="" repoUrl="u/r" detect={detect} fetchUser={async () => null}>
        {children}
      </AuthProvider>
    );
    const { result } = renderHook(() => useIsWriteAllowed(), { wrapper });
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("false i identified-read-mode", async () => {
    const detect = vi.fn().mockResolvedValue("identified-read");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider token="x" repoUrl="u/r" detect={detect} fetchUser={async () => ({ login: "a", id: 1 })}>
        {children}
      </AuthProvider>
    );
    const { result } = renderHook(() => useIsWriteAllowed(), { wrapper });
    await waitFor(() => expect(result.current).toBe(false));
  });
});

describe("loadAuthSettings + saveAuthSettings", () => {
  it("default = allowAnonymousRead: true", () => {
    expect(loadAuthSettings()).toEqual({ allowAnonymousRead: true });
  });

  it("save+load round-trip", () => {
    saveAuthSettings({ allowAnonymousRead: false });
    expect(loadAuthSettings()).toEqual({ allowAnonymousRead: false });
  });

  it("korrupt JSON → default", () => {
    localStorage.setItem("ava.authSettings", "{kaos");
    expect(loadAuthSettings()).toEqual({ allowAnonymousRead: true });
  });
});

describe("refresh", () => {
  it("anropar detect igen vid refresh()", async () => {
    const detect = vi.fn().mockResolvedValue("anonymous");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider token="" repoUrl="u/r" detect={detect} fetchUser={async () => null}>
        {children}
      </AuthProvider>
    );
    const { result } = renderHook(() => useAuthMode(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(detect).toHaveBeenCalledTimes(1);
    await act(async () => { await result.current.refresh(); });
    expect(detect).toHaveBeenCalledTimes(2);
  });
});
