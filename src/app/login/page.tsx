"use client";

/**
 * `/login` — demo-lägets användarväljare. ENDAST demo: i self-hosted sker
 * inloggning via OIDC (ADR 0009) — oauth2-proxy gat:ar nginx-fronten och
 * dirigerar till byråns IdP innan appen laddas, och principalen binds i
 * bootstrappen (`resolveOidcLogin`). Den här sidan nås aldrig i det flödet.
 *
 * Demo: användaren väljer ett konto, skriver "demo" som lösenord, klickar
 * "Logga in" → `principalId` + `organizationId` sparas i `ava.firma`
 * localStorage och vi navigerar till `/`.
 *
 * Routen själv vägrar att kräva en redan-satt principal — annars hamnar
 * vi i en omdirigerings-loop med demo-bootstrap.
 */
import { useEffect, useState } from "react";
import { loadDemoMeta, type DemoMeta, type DemoMetaUser } from "@/lib/client/demo/demo-meta";
import { loadFirmaConfig, patchFirmaConfig } from "@/lib/client/firma/firma-config";
import { DEMO_PASSWORD } from "../../../tooling/demo-config";

type State =
  | { kind: "loading" }
  | { kind: "ready"; meta: DemoMeta }
  | { kind: "info"; message: string }
  | { kind: "error"; message: string };

async function initLogin(
  setState: (s: State) => void,
  setSelected: (id: string) => void,
): Promise<void> {
  const cfg = loadFirmaConfig();
  if (cfg.tier !== "demo") {
    setState({
      kind: "info",
      message:
        "Self-hosted: inloggning sker via din identitetsleverantör (OIDC). " +
        "oauth2-proxy dirigerar dig dit automatiskt — den här sidan används " +
        "bara i demo-läget.",
    });
    return;
  }
  try {
    const meta = await loadDemoMeta(cfg.repo);
    setState({ kind: "ready", meta });
    const admin = meta.users.find((u) => u.role === "ADMIN") ?? meta.users[0];
    if (admin) setSelected(admin.id);
  } catch (err) {
    setState({ kind: "error", message: (err as Error).message });
  }
}

export default function LoginPage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [selected, setSelected] = useState<string>("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void initLogin(setState, setSelected);
  }, []);

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (state.kind !== "ready") return;
    if (password !== DEMO_PASSWORD) {
      setError(`Lösenord är "${DEMO_PASSWORD}" i demoläget.`);
      return;
    }
    const user = state.meta.users.find((u) => u.id === selected);
    if (!user) {
      setError("Välj en användare.");
      return;
    }
    patchFirmaConfig({
      principalId: user.id,
      organizationId: state.meta.organizationId,
      authorName: user.name,
      authorEmail: user.email,
    });
    // Full reload (inte router.push) — DemoBootstrap initierar trpcClient via
    // useState-initializer som bara körs vid MOUNT. router.push reloadar inte
    // → ny principalId/organizationId i localStorage ignoreras och alla
    // queries returnerar tomt. window.location.replace tvingar fresh mount.
    const basePath = process.env.NEXT_PUBLIC_DEMO_BASE_PATH ?? "";
    window.location.replace(`${basePath}/`);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gray-50">
      <div className="w-full max-w-md bg-white rounded-lg shadow-md p-6 space-y-4">
        <header>
          <h1 className="text-2xl font-bold text-gray-900">AVA — Logga in</h1>
          {state.kind === "ready" && (
            <p className="text-sm text-gray-500 mt-1">{state.meta.organizationName}</p>
          )}
        </header>
        {state.kind === "loading" && <p className="text-sm text-gray-500">Hämtar användare…</p>}
        {state.kind === "error" && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
            {state.message}
          </p>
        )}
        {state.kind === "info" && (
          <div className="space-y-3">
            <p className="text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded p-3">
              {state.message}
            </p>
            <a
              href={`${process.env.NEXT_PUBLIC_DEMO_BASE_PATH ?? ""}/`}
              className="inline-block w-full text-center rounded-md bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-medium"
            >
              Till startsidan
            </a>
          </div>
        )}
        {state.kind === "ready" && (
          <LoginForm
            users={state.meta.users}
            selected={selected}
            onSelect={setSelected}
            password={password}
            onPassword={setPassword}
            error={error}
            onSubmit={onSubmit}
          />
        )}
      </div>
    </div>
  );
}

interface FormProps {
  users: DemoMetaUser[];
  selected: string;
  onSelect: (id: string) => void;
  password: string;
  onPassword: (p: string) => void;
  error: string | null;
  onSubmit: (e: React.FormEvent) => void;
}

function LoginForm({ users, selected, onSelect, password, onPassword, error, onSubmit }: FormProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="user" className="block text-sm font-medium text-gray-700 mb-1">
          Konto
        </label>
        <select
          id="user"
          value={selected}
          onChange={(e) => onSelect(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} {u.title ? `— ${u.title}` : ""} ({u.role})
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
          Lösenord
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => onPassword(e.target.value)}
          placeholder={`Skriv "${DEMO_PASSWORD}"`}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          autoFocus
        />
      </div>
      {error && (
        <p className="text-sm text-red-700">{error}</p>
      )}
      <button
        type="submit"
        className="w-full rounded-md bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-medium"
      >
        Logga in
      </button>
      <p className="text-xs text-gray-400 text-center">
        Demo-läge — alla användare har lösenord <code>{DEMO_PASSWORD}</code>.
      </p>
    </form>
  );
}
