//! Real Vanilla installation/launch diagnostic using the production backend.
//! Run with cargo run -p vslauncher-tauri --example minecraft_smoke.
#[path = "../src/accounts.rs"] mod accounts;
#[path = "../src/minecraft.rs"] mod minecraft;
#[path = "../src/horizon.rs"] mod horizon;
#[path = "../src/horizon_download.rs"] mod horizon_download;
#[path = "../src/rust_runtime.rs"] mod rust_runtime;
use tauri::{Listener, Manager};

fn main() {
    let root = std::env::current_dir().expect("working directory").join(".vis-smoke-test");
    tauri::Builder::default().setup(move |app| {
        if let Some(window) = app.get_webview_window("main") { window.hide()?; }
        app.listen("minecraft-progress", |event| println!("PROGRESS {}", event.payload()));
        let exit_app = app.handle().clone();
        app.listen("minecraft-process-exited", move |event| {
            println!("GAME_EXIT {}", event.payload());
            let success = serde_json::from_str::<serde_json::Value>(event.payload())
                .ok().and_then(|value| value["success"].as_bool()).unwrap_or(false);
            exit_app.exit(if success { 0 } else { 1 });
        });
        let handle = app.handle().clone();
        std::thread::spawn(move || {
            let instance = accounts::Instance {
                name: "VanillaSmoke".into(), project_id: "smoke-test".into(),
                version: "1.21.1".into(), ram_mb: 2048,
                player_name: "VisTest".into(), ..Default::default()
            };
            let result = minecraft::install(&handle, &root, "VisTest", &instance, &[])
                .and_then(|_| {
                    println!("INSTALL_OK {}", root.display());
                    minecraft::launch(&handle, &root, "VisTest", &instance)
                });
            match result {
                Ok(launch) => println!("GAME_STARTED pid={} log={}", launch.pid, launch.log_file),
                Err(error) => { eprintln!("SMOKE_FAILED {error}"); handle.exit(1); }
            }
        });
        Ok(())
    }).run(tauri::generate_context!()).expect("Diagnostic runtime");
}
