#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::{process::CommandChild, ShellExt};

struct Runtime { token: String, process: Mutex<Option<CommandChild>> }

#[derive(serde::Serialize)]
struct Bootstrap { token: String, base: String }

#[tauri::command]
fn bootstrap(state: tauri::State<Runtime>) -> Bootstrap {
    Bootstrap { token: state.token.clone(), base: "http://127.0.0.1:8787".into() }
}

#[tauri::command]
async fn export_file(app: tauri::AppHandle, name: String, bytes: Vec<u8>) -> Result<bool, String> {
    if bytes.len() > 25 * 1024 * 1024 || name.contains('/') || name.contains('\\') {
        return Err("Invalid export".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let destination = app.dialog().file().set_file_name(&name).blocking_save_file();
        if let Some(destination) = destination {
            let path = destination.into_path().map_err(|_| "Invalid destination")?;
            std::fs::write(path, bytes).map_err(|_| "Could not save the selected file")?;
            Ok(true)
        } else { Ok(false) }
    }).await.map_err(|_| "Export failed".to_string())?
}

#[tauri::command]
async fn configure_lan(app: tauri::AppHandle, ip: String) -> Result<(), String> {
    let address: std::net::Ipv4Addr = ip.parse().map_err(|_| "Introduce una dirección IPv4 válida".to_string())?;
    if !address.is_private() || address.is_loopback() || address.is_unspecified() {
        return Err("La dirección debe ser la IPv4 privada de este PC en la oficina".into());
    }
    let command = if cfg!(debug_assertions) {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
        app.shell().command(root.join(".venv/Scripts/python.exe")).current_dir(root)
            .args(["-m", "cnie_capture", "setup-lan", "--ip", &ip])
    } else {
        let sidecar = app.path().resource_dir().map_err(|_| "No se encontró el motor instalado".to_string())?
            .join("sidecar/cnie-capture.exe");
        app.shell().command(sidecar).args(["setup-lan", "--ip", &ip])
    };
    let output = command.output().await.map_err(|_| "No se pudo crear el certificado de oficina".to_string())?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() { "No se pudo guardar la configuración de red".into() } else { detail });
    }
    Ok(())
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    app.request_restart();
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") { let _ = window.set_focus(); }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let token = format!("{}{}", uuid::Uuid::new_v4(), uuid::Uuid::new_v4());
            let command = if cfg!(debug_assertions) {
                let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
                app.shell()
                    .command(root.join(".venv/Scripts/python.exe"))
                    .current_dir(root)
                    .args(["-m", "cnie_capture", "serve"])
            } else {
                let sidecar = app.path().resource_dir()?.join("sidecar/cnie-capture.exe");
                app.shell().command(sidecar).args(["serve"])
            };
            let (_, process) = command.env("CNIE_DESKTOP_TOKEN", &token).spawn()?;
            app.manage(Runtime { token, process: Mutex::new(Some(process)) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![bootstrap, export_file, configure_lan, restart_app])
        .build(tauri::generate_context!())
        .expect("Could not launch e-notario");
    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(state) = handle.try_state::<Runtime>() {
                if let Ok(mut process) = state.process.lock() {
                    if let Some(child) = process.take() { let _ = child.kill(); }
                }
            }
        }
    });
}
