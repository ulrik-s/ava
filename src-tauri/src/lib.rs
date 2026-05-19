/*!
 * AVA — Tauri-runtime.
 *
 * Exponerar Tauri-commands för dokument-flödet:
 *
 *   1. `open_in_default_app(path)` — öppnar fil i OS:ets default-app
 *      (Preview/PDFGear/Word). Användaren editerar i sin redigerare,
 *      sparar tillbaka, och vi committar via git_commit_changes.
 *   2. `git_commit_changes(repo_path, message)` — stage:ar alla ändringar
 *      och committar lokalt (HEAD blir den nya commit:en).
 *   3. `git_push(repo_path, remote, token)` — pushar HEAD via HTTPS
 *      med token-auth (GitHub PAT).
 *   4. `git_status(repo_path)` — listar ändrade filer (för UI-badge).
 *
 * All affärslogik bor fortfarande på JS-sidan; detta är bara IPC-broar.
 */

use std::path::PathBuf;
use serde::Serialize;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            ping,
            open_in_default_app,
            git_status,
            git_commit_changes,
            git_push,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}

#[tauri::command]
fn ping() -> &'static str { "pong" }

/// Öppna en lokal fil i OS:ets default-app. Returnerar fel-strängen
/// om opener-pluginen inte kan starta processen.
#[tauri::command]
async fn open_in_default_app(
    path: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct GitStatusEntry {
    path: String,
    /// "modified" | "added" | "deleted" | "untracked" | "renamed"
    status: String,
}

#[derive(Serialize)]
struct CommitResult {
    oid: String,
    message: String,
}

/// Lista status (ändrade/otrackade filer). Tom array = ren working tree.
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

/// Stage:a alla ändringar och committa lokalt. HEAD flyttas fram.
/// `author` form: "Namn <epost@host>".
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
    git2::Signature::now("AVA Demo", "demo@ava.local")
}

/// Pusha HEAD till en remote via HTTPS med PAT-auth.
/// `token` = GitHub Personal Access Token med push-permission på repo:t.
#[tauri::command]
fn git_push(
    repo_path: String,
    remote: Option<String>,
    branch: Option<String>,
    token: String,
) -> Result<(), String> {
    let repo = git2::Repository::open(&repo_path).map_err(|e| e.to_string())?;
    let remote_name = remote.unwrap_or_else(|| "origin".to_string());
    let mut remote = repo.find_remote(&remote_name).map_err(|e| e.to_string())?;

    let branch_name = branch.unwrap_or_else(|| "main".to_string());
    let refspec = format!("refs/heads/{}:refs/heads/{}", branch_name, branch_name);

    let mut callbacks = git2::RemoteCallbacks::new();
    let token_clone = token.clone();
    callbacks.credentials(move |_url, _username, _allowed| {
        // GitHub HTTPS-PAT: "x-access-token" som username, token som lösenord
        git2::Cred::userpass_plaintext("x-access-token", &token_clone)
    });

    let mut push_opts = git2::PushOptions::new();
    push_opts.remote_callbacks(callbacks);

    remote.push(&[refspec], Some(&mut push_opts)).map_err(|e| e.to_string())
}

#[allow(dead_code)]
fn home_dir() -> PathBuf {
    dirs_for_home().unwrap_or_else(|| PathBuf::from("."))
}

fn dirs_for_home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}
