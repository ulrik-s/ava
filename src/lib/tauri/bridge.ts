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
