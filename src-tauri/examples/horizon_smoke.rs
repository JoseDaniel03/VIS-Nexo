//! Real Horizon resource preparation diagnostic using the production backend.
//! Run with cargo run -p vslauncher-tauri --example horizon_smoke.
#[path = "../src/accounts.rs"] mod accounts;
#[path = "../src/instance_guard.rs"] mod instance_guard;
#[path = "../src/minecraft.rs"] mod minecraft;
#[path = "../src/horizon.rs"] mod horizon;
#[path = "../src/horizon_download.rs"] mod horizon_download;
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
                name: "HorizonSmoke".into(), project_id: "smoke-test".into(),
                version: "26.3".into(), engine: "horizon".into(), ram_mb: 2048,
                horizon_build_dir: horizon::SOURCE_BUILD_ID.into(),
                player_name: "VisTest".into(), ..Default::default()
            };
            horizon::initialize_bundled_source(&handle);
            let result = (|| -> Result<minecraft::LaunchResult, String> {
                let mut instance = instance;
                let dir = minecraft::instance_dir(&root, "VisTest", &instance)?;
                instance.horizon_build_dir = horizon::install_instance_engine(&dir, &instance)?;
                let (mc, server, jdk) = minecraft::horizon_prerequisites(&handle, &root, "VisTest", &instance, &[])?;
                instance.horizon_minecraft_dir = mc;
                instance.horizon_server_jar = server;
                instance.java_path = jdk;
                let dir = minecraft::instance_dir(&root, "VisTest", &instance)?;
                horizon::prepare(&handle, &dir, &instance)?;
                accounts::atomic_json(&dir.join("vis-test-instance.json"), &instance)?;
                println!("PREPARE_OK {}", dir.display());
                horizon::launch(&handle, &dir, &instance, "")
            })();
            match result {
                Ok(launch) => println!("GAME_STARTED pid={} log={}", launch.pid, launch.log_file),
                Err(error) => { eprintln!("SMOKE_FAILED {error}"); handle.exit(1); }
            }
        });
        Ok(())
    }).run(tauri::generate_context!()).expect("Diagnostic runtime");
}
