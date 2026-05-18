/*!
 * AVA — Tauri-runtime.
 *
 * Den här Rust-koden gör tre saker:
 *
 *   1. Spinner upp en Tauri-window som lasted Next.js-appen i webview
 *   2. Exponerar Tauri-commands för fs- och git-operationer som
 *      JS-sidans `LocalRuntime` använder (när vi byter bort
 *      child_process-baserad subprocess-git mot Rust-side ops).
 *   3. Auto-uppdaterar via Tauri Updater (Fas 4 — inte i dagens build)
 *
 * Just nu är detta en MINIMAL skeleton som öppnar en window mot
 * localhost:3000 (eller bundled frontend). All affärslogik bor
 * fortfarande på JS-sidan.
 */

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![ping])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}

/// Smoke-test-command som JS-sidan kan invoka för att verifiera att
/// IPC-bryggan funkar. Tas bort när vi har riktiga commands.
#[tauri::command]
fn ping() -> &'static str {
    "pong"
}
