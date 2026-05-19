/*!
 * AVA — Tauri-runtime.
 *
 * Commands:
 *   - open_in_default_app(path) — OS:ets default-app
 *   - git_status(repoPath) — ändringar
 *   - git_commit_changes(repoPath, message, author?) — stage + commit
 *   - git_push(repoPath, remote?, branch?, token) — push via HTTPS PAT
 *   - git_pull(repoPath, remote?, branch?, token) — fetch + fast-forward
 *   - secret_get(key) / secret_set(key, value) / secret_delete(key) —
 *     OS-keychain via `keyring`-crate.
 *   - watch_repo_start(repoPath) / watch_repo_stop(token) — fs-watch
 *     med notify; emittar Tauri-event "repo-changed" per change.
 */

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use notify::{Event, RecursiveMode, Watcher};

const KEYRING_SERVICE: &str = "ava-crm";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(WatcherState::default())
        .invoke_handler(tauri::generate_handler![
            ping,
            open_in_default_app,
            git_status,
            git_commit_changes,
            git_push,
            git_pull,
            secret_get,
            secret_set,
            secret_delete,
            watch_repo_start,
            watch_repo_stop,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}

#[tauri::command]
fn ping() -> &'static str { "pong" }

#[tauri::command]
async fn open_in_default_app(
    path: String,
    app: AppHandle,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_path(path, None::<&str>).map_err(|e| e.to_string())
}

// ─── Keychain ─────────────────────────────────────────────────────

#[tauri::command]
fn secret_get(key: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn secret_set(key: String, value: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &key).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_delete(key: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ─── Git ──────────────────────────────────────────────────────────

#[derive(Serialize)]
struct GitStatusEntry {
    path: String,
    status: String,
}

#[derive(Serialize)]
struct CommitResult {
    oid: String,
    message: String,
}

#[derive(Serialize)]
struct PullResult {
    /// "up-to-date" | "fast-forward" | "merge-needed"
    kind: String,
    new_head: Option<String>,
}

#[tauri::command]
fn git_status(repo_path: String) -> Result<Vec<GitStatusEntry>, String> {
    let repo = git2::Repository::open(&repo_path).map_err(|e| e.to_string())?;
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut opts)).map_err(|e| e.to_string())?;
    Ok(statuses
        .iter()
        .filter_map(|s| {
            let path = s.path()?.to_string();
            let st = s.status();
            let label = if st.is_wt_new() || st.is_index_new() { "added" }
                else if st.is_wt_modified() || st.is_index_modified() { "modified" }
                else if st.is_wt_deleted() || st.is_index_deleted() { "deleted" }
                else if st.is_wt_renamed() || st.is_index_renamed() { "renamed" }
                else { "untracked" };
            Some(GitStatusEntry { path, status: label.to_string() })
        })
        .collect())
}

#[tauri::command]
fn git_commit_changes(
    repo_path: String,
    message: String,
    author: Option<String>,
) -> Result<CommitResult, String> {
    let repo = git2::Repository::open(&repo_path).map_err(|e| e.to_string())?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    index.add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
        .map_err(|e| e.to_string())?;
    index.write().map_err(|e| e.to_string())?;
    let tree_oid = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_oid).map_err(|e| e.to_string())?;

    let sig = parse_signature(author.as_deref())
        .or_else(|_| repo.signature())
        .map_err(|e| e.to_string())?;

    let parent = repo.head().ok().and_then(|h| h.target())
        .and_then(|oid| repo.find_commit(oid).ok());
    let parents: Vec<&git2::Commit> = parent.iter().collect();
    let oid = repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents)
        .map_err(|e| e.to_string())?;
    Ok(CommitResult { oid: oid.to_string(), message })
}

fn parse_signature(author: Option<&str>) -> Result<git2::Signature<'static>, git2::Error> {
    if let Some(s) = author {
        if let Some(lt) = s.find('<') {
            if let Some(gt) = s.find('>') {
                let name = s[..lt].trim();
                let email = &s[lt + 1..gt];
                return git2::Signature::now(name, email);
            }
        }
    }
    git2::Signature::now("AVA User", "user@ava.local")
}

fn token_callbacks(token: String) -> git2::RemoteCallbacks<'static> {
    let mut cb = git2::RemoteCallbacks::new();
    cb.credentials(move |_url, _username, _allowed| {
        git2::Cred::userpass_plaintext("x-access-token", &token)
    });
    cb
}

#[tauri::command]
fn git_push(
    repo_path: String,
    remote: Option<String>,
    branch: Option<String>,
    token: String,
) -> Result<(), String> {
    let repo = git2::Repository::open(&repo_path).map_err(|e| e.to_string())?;
    let remote_name = remote.unwrap_or_else(|| "origin".to_string());
    let mut r = repo.find_remote(&remote_name).map_err(|e| e.to_string())?;
    let branch_name = branch.unwrap_or_else(|| "main".to_string());
    let refspec = format!("refs/heads/{0}:refs/heads/{0}", branch_name);
    let mut opts = git2::PushOptions::new();
    opts.remote_callbacks(token_callbacks(token));
    r.push(&[refspec], Some(&mut opts)).map_err(|e| e.to_string())
}

#[tauri::command]
fn git_pull(
    repo_path: String,
    remote: Option<String>,
    branch: Option<String>,
    token: String,
) -> Result<PullResult, String> {
    let repo = git2::Repository::open(&repo_path).map_err(|e| e.to_string())?;
    let remote_name = remote.unwrap_or_else(|| "origin".to_string());
    let branch_name = branch.unwrap_or_else(|| "main".to_string());
    let mut r = repo.find_remote(&remote_name).map_err(|e| e.to_string())?;

    let mut fetch_opts = git2::FetchOptions::new();
    fetch_opts.remote_callbacks(token_callbacks(token));
    r.fetch(&[&branch_name], Some(&mut fetch_opts), None)
        .map_err(|e| e.to_string())?;

    let fetch_head = repo.find_reference("FETCH_HEAD").map_err(|e| e.to_string())?;
    let fetch_commit = repo.reference_to_annotated_commit(&fetch_head).map_err(|e| e.to_string())?;
    let (analysis, _) = repo.merge_analysis(&[&fetch_commit]).map_err(|e| e.to_string())?;

    if analysis.is_up_to_date() {
        return Ok(PullResult { kind: "up-to-date".into(), new_head: None });
    }
    if analysis.is_fast_forward() {
        let refname = format!("refs/heads/{}", branch_name);
        let mut reference = repo.find_reference(&refname).map_err(|e| e.to_string())?;
        reference.set_target(fetch_commit.id(), "Fast-forward via git_pull").map_err(|e| e.to_string())?;
        repo.set_head(&refname).map_err(|e| e.to_string())?;
        repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))
            .map_err(|e| e.to_string())?;
        return Ok(PullResult { kind: "fast-forward".into(), new_head: Some(fetch_commit.id().to_string()) });
    }
    Ok(PullResult { kind: "merge-needed".into(), new_head: Some(fetch_commit.id().to_string()) })
}

// ─── fs-watch ─────────────────────────────────────────────────────

type WatcherToken = u64;

#[derive(Default)]
struct WatcherState(Mutex<WatcherInner>);

#[derive(Default)]
struct WatcherInner {
    next_token: WatcherToken,
    watchers: HashMap<WatcherToken, notify::RecommendedWatcher>,
}

#[tauri::command]
fn watch_repo_start(
    repo_path: String,
    state: State<'_, WatcherState>,
    app: AppHandle,
) -> Result<WatcherToken, String> {
    let path = Path::new(&repo_path).to_path_buf();
    if !path.exists() {
        return Err(format!("Sökväg finns inte: {}", repo_path));
    }
    let app_clone = app.clone();
    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        if let Ok(ev) = res {
            // Filtra bort .git-mappens interna ändringar — vi bryr oss
            // bara om working-tree-ändringar.
            let any_non_git = ev.paths.iter().any(|p| {
                !p.components().any(|c| c.as_os_str() == ".git")
            });
            if !any_non_git { return; }
            let payload = serde_json::json!({
                "kind": format!("{:?}", ev.kind),
                "paths": ev.paths.iter().map(|p| p.display().to_string()).collect::<Vec<_>>(),
            });
            let _ = app_clone.emit("repo-changed", payload);
        }
    }).map_err(|e| e.to_string())?;

    watcher.watch(&path, RecursiveMode::Recursive).map_err(|e| e.to_string())?;
    let mut inner = state.0.lock().map_err(|_| "lock-fel".to_string())?;
    let token = inner.next_token;
    inner.next_token += 1;
    inner.watchers.insert(token, watcher);
    Ok(token)
}

#[tauri::command]
fn watch_repo_stop(
    token: WatcherToken,
    state: State<'_, WatcherState>,
) -> Result<(), String> {
    let mut inner = state.0.lock().map_err(|_| "lock-fel".to_string())?;
    inner.watchers.remove(&token);
    Ok(())
}
