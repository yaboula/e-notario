#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::Write;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::{process::CommandChild, ShellExt};
mod saved_receipts;

struct Runtime {
    token: String,
    process: Mutex<Option<CommandChild>>,
    _receipt_cleanup: saved_receipts::CleanupGuard,
}

#[derive(serde::Serialize)]
struct Bootstrap {
    token: String,
    base: String,
}

#[derive(serde::Serialize)]
struct SaveDocxResult {
    saved: bool,
    path: Option<String>,
    opened: bool,
    receipt_id: Option<String>,
}

#[tauri::command]
fn bootstrap(state: tauri::State<Runtime>) -> Bootstrap {
    Bootstrap {
        token: state.token.clone(),
        base: "http://127.0.0.1:8787".into(),
    }
}

#[tauri::command]
async fn export_file(app: tauri::AppHandle, name: String, bytes: Vec<u8>) -> Result<bool, String> {
    if bytes.len() > 25 * 1024 * 1024 || name.contains('/') || name.contains('\\') {
        return Err("Invalid export".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let destination = app
            .dialog()
            .file()
            .set_file_name(&name)
            .blocking_save_file();
        if let Some(destination) = destination {
            let path = destination.into_path().map_err(|_| "Invalid destination")?;
            std::fs::write(path, bytes).map_err(|_| "Could not save the selected file")?;
            Ok(true)
        } else {
            Ok(false)
        }
    })
    .await
    .map_err(|_| "Export failed".to_string())?
}

#[tauri::command]
async fn save_docx(
    app: tauri::AppHandle,
    name: String,
    bytes: Vec<u8>,
    case_context: Option<saved_receipts::CaseSaveContext>,
) -> Result<SaveDocxResult, String> {
    if bytes.len() > 25 * 1024 * 1024
        || bytes.len() < 4
        || &bytes[..4] != b"PK\x03\x04"
        || name.contains('/')
        || name.contains('\\')
        || !name.to_ascii_lowercase().ends_with(".docx")
    {
        return Err("Documento Word no válido".into());
    }
    let dialog_app = app.clone();
    let saved_path = tauri::async_runtime::spawn_blocking(
        move || -> Result<Option<(std::path::PathBuf, Option<String>, bool)>, String> {
            let destination = dialog_app
                .dialog()
                .file()
                .set_file_name(&name)
                .blocking_save_file();
            let Some(destination) = destination else {
                return Ok(None);
            };
            let path = destination.into_path().map_err(|_| "Destino no válido")?;
            if path
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| value.eq_ignore_ascii_case("docx"))
                != Some(true)
            {
                return Err("El archivo debe conservar la extensión .docx".into());
            }
            let parent = path.parent().ok_or("Destino no válido")?;
            let mut temporary = tempfile::NamedTempFile::new_in(parent)
                .map_err(|_| "No se pudo preparar el guardado")?;
            temporary
                .write_all(&bytes)
                .map_err(|_| "No se pudo escribir el documento")?;
            temporary
                .as_file()
                .sync_all()
                .map_err(|_| "No se pudo confirmar el documento")?;
            let receipt_id = case_context
                .as_ref()
                .map(|context| saved_receipts::prepare(context, &path, &bytes))
                .transpose()?;
            temporary
                .persist(&path)
                .map_err(|_| "No se pudo guardar el archivo seleccionado")?;
            let receipt_confirmed = receipt_id
                .as_ref()
                .map(|id| saved_receipts::confirm(id).is_ok())
                .unwrap_or(true);
            Ok(Some((path, receipt_id, receipt_confirmed)))
        },
    )
    .await
    .map_err(|_| "Falló el guardado".to_string())??;
    let Some((path, receipt_id, receipt_confirmed)) = saved_path else {
        return Ok(SaveDocxResult {
            saved: false,
            path: None,
            opened: false,
            receipt_id: None,
        });
    };
    let opened = receipt_confirmed
        && app
            .opener()
            .open_path(path.to_string_lossy().to_string(), None::<&str>)
            .is_ok();
    Ok(SaveDocxResult {
        saved: true,
        path: Some(path.to_string_lossy().to_string()),
        opened,
        receipt_id,
    })
}

#[tauri::command]
async fn pending_case_save_receipts() -> Result<Vec<saved_receipts::SavedCaseReceipt>, String> {
    tauri::async_runtime::spawn_blocking(saved_receipts::list)
        .await
        .map_err(|_| "SAVE_RECEIPT_RECOVERY_FAILED".to_string())?
}

#[tauri::command]
async fn acknowledge_case_save_receipt(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || saved_receipts::acknowledge(&id))
        .await
        .map_err(|_| "SAVE_RECEIPT_RECOVERY_FAILED".to_string())?
}

#[tauri::command]
async fn clear_case_save_receipts() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(saved_receipts::clear)
        .await
        .map_err(|_| "SAVE_RECEIPT_RECOVERY_FAILED".to_string())?
}

#[tauri::command]
fn reveal_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let path = std::path::PathBuf::from(path);
    if !path.is_file() {
        return Err("El archivo guardado ya no está disponible".into());
    }
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|_| "No se pudo abrir el Explorador".into())
}

#[tauri::command]
async fn configure_lan(app: tauri::AppHandle, ip: String) -> Result<(), String> {
    let address: std::net::Ipv4Addr = ip
        .parse()
        .map_err(|_| "Introduce una dirección IPv4 válida".to_string())?;
    if !address.is_private() || address.is_loopback() || address.is_unspecified() {
        return Err("La dirección debe ser la IPv4 privada de este PC en la oficina".into());
    }
    let command = if cfg!(debug_assertions) {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
        app.shell()
            .command(root.join(".venv/Scripts/python.exe"))
            .current_dir(root)
            .args(["-m", "cnie_capture", "setup-lan", "--ip", &ip])
    } else {
        let sidecar = app
            .path()
            .resource_dir()
            .map_err(|_| "No se encontró el motor instalado".to_string())?
            .join("sidecar/cnie-capture.exe");
        app.shell()
            .command(sidecar)
            .args(["setup-lan", "--ip", &ip])
    };
    let output = command
        .output()
        .await
        .map_err(|_| "No se pudo crear el certificado de oficina".to_string())?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "No se pudo guardar la configuración de red".into()
        } else {
            detail
        });
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
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let receipt_cleanup = saved_receipts::start_cleanup()?;
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
            app.manage(Runtime {
                token,
                process: Mutex::new(Some(process)),
                _receipt_cleanup: receipt_cleanup,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            export_file,
            save_docx,
            pending_case_save_receipts,
            acknowledge_case_save_receipt,
            clear_case_save_receipts,
            reveal_file,
            configure_lan,
            restart_app
        ])
        .build(tauri::generate_context!())
        .expect("Could not launch e-notario");
    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(state) = handle.try_state::<Runtime>() {
                if let Ok(mut process) = state.process.lock() {
                    if let Some(child) = process.take() {
                        let _ = child.kill();
                    }
                }
            }
        }
    });
}
