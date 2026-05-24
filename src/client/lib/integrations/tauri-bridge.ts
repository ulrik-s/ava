/**
 * Tauri-bro: lättviktig wrapper kring `@tauri-apps/api` invoke.
 *
 * Designval:
 *   - Vi importerar `@tauri-apps/api/core` dynamiskt så modulen kan
 *     packas i web-bygget utan att Tauri-runtime saknas vid require.
 *   - `isTauri()` detekterar om vi kör i Tauri vs vanlig browser så
 *     UI:t kan välja flöde (öppna native vs ladda ner via URL).
 *
 * Tre commands speglar `src-tauri/src/lib.rs`:
 *   - openInDefaultApp(path)
 *   - gitStatus(repoPath)
 *   - gitCommitChanges(repoPath, message, author?)
 *   - gitPush(repoPath, remote, branch, token)
 */

export function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
  );
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error(`Tauri-command '${cmd}' anropad i icke-Tauri-kontext`);
  }
  const mod = await import("@tauri-apps/api/core");
  return mod.invoke<T>(cmd, args);
}

export async function openInDefaultApp(path: string): Promise<void> {
  await invoke<void>("open_in_default_app", { path });
}

export async function gitClone(
  url: string,
  targetDir: string,
  token?: string,
): Promise<void> {
  await invoke<void>("git_clone", { url, targetDir, token });
}

export interface GitStatusEntry {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
}

export async function gitStatus(repoPath: string): Promise<GitStatusEntry[]> {
  return invoke<GitStatusEntry[]>("git_status", { repoPath });
}

export interface CommitResult { oid: string; message: string }

export async function gitCommitChanges(
  repoPath: string,
  message: string,
  author?: string,
): Promise<CommitResult> {
  return invoke<CommitResult>("git_commit_changes", { repoPath, message, author });
}

export async function gitPush(
  repoPath: string,
  token: string,
  options: { remote?: string; branch?: string } = {},
): Promise<void> {
  await invoke<void>("git_push", {
    repoPath,
    remote: options.remote,
    branch: options.branch,
    token,
  });
}

export interface PullResult {
  kind: "up-to-date" | "fast-forward" | "merge-needed";
  newHead: string | null;
}

export async function gitPull(
  repoPath: string,
  token: string,
  options: { remote?: string; branch?: string } = {},
): Promise<PullResult> {
  return invoke<PullResult>("git_pull", {
    repoPath,
    remote: options.remote,
    branch: options.branch,
    token,
  });
}

// ─── Keychain ──────────────────────────────────────────────────────

export async function secretGet(key: string): Promise<string | null> {
  return invoke<string | null>("secret_get", { key });
}

export async function secretSet(key: string, value: string): Promise<void> {
  await invoke<void>("secret_set", { key, value });
}

export async function secretDelete(key: string): Promise<void> {
  await invoke<void>("secret_delete", { key });
}

// ─── fs-watch ──────────────────────────────────────────────────────

export interface RepoChangeEvent {
  kind: string;
  paths: string[];
}

export async function watchRepoStart(repoPath: string): Promise<number> {
  return invoke<number>("watch_repo_start", { repoPath });
}

export async function watchRepoStop(token: number): Promise<void> {
  await invoke<void>("watch_repo_stop", { token });
}

/**
 * Lyssna på `repo-changed`-eventet som watch_repo_start emittar.
 * Returnerar unsubscribe-fn. Anropas bara i Tauri-kontext.
 */
export async function onRepoChange(
  handler: (event: RepoChangeEvent) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const mod = await import("@tauri-apps/api/event");
  const un = await mod.listen<RepoChangeEvent>("repo-changed", (e) => handler(e.payload));
  return un;
}

// ─── GitHub OAuth Device Flow ─────────────────────────────────────

export interface DeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
  expiresIn: number;
}

export type PollResult =
  | { status: "authorization_pending" }
  | { status: "slow_down"; interval: number }
  | { status: "done"; accessToken: string }
  | { status: "error"; message: string };

export async function oauthStartDeviceFlow(scopes?: string): Promise<DeviceCodeResponse> {
  const raw = await invoke<{
    device_code: string; user_code: string; verification_uri: string;
    interval: number; expires_in: number;
  }>("oauth_start_device_flow", { scopes });
  return {
    deviceCode: raw.device_code,
    userCode: raw.user_code,
    verificationUri: raw.verification_uri,
    interval: raw.interval,
    expiresIn: raw.expires_in,
  };
}

export async function oauthPollAccessToken(deviceCode: string): Promise<PollResult> {
  const raw = await invoke<
    | { status: "authorization_pending" }
    | { status: "slow_down"; interval: number }
    | { status: "done"; access_token: string }
    | { status: "error"; message: string }
  >("oauth_poll_access_token", { deviceCode });
  if (raw.status === "done") return { status: "done", accessToken: raw.access_token };
  return raw as PollResult;
}

// ─── Merge-konflikter ─────────────────────────────────────────────

export interface ConflictedFile {
  path: string;
  kind: "both_modified" | "both_added" | "deleted_by_us" | "deleted_by_them" | "unknown";
}

export async function listConflictedFiles(repoPath: string): Promise<ConflictedFile[]> {
  return invoke<ConflictedFile[]>("list_conflicted_files", { repoPath });
}

// ─── Folder-picker via tauri-plugin-dialog ────────────────────────

export async function pickFolder(title?: string): Promise<string | null> {
  if (!isTauri()) return null;
  const mod = await import("@tauri-apps/plugin-dialog");
  const selected = await mod.open({ directory: true, multiple: false, title });
  if (typeof selected === "string") return selected;
  return null;
}
