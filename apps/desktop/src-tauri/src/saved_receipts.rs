//! Protected write-ahead receipts. No CNIE values or document bytes are retained.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

static LOCK: Mutex<()> = Mutex::new(());
const MAX_BYTES: usize = 1024 * 1024;
const RETENTION: u64 = 24 * 60 * 60;
const ENTROPY: &[u8] = b"e-notario-v2/saved-case-receipts/v1";
const SCHEMA: &str = "enotario.saved-case-receipts/v1";

#[derive(Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReceiptKind {
    #[default]
    Case,
    DocumentRequest,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct CaseSaveContext {
    pub id: String,
    pub revision: u64,
    #[serde(default)]
    pub kind: ReceiptKind,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct SavedCaseReceipt {
    pub id: String,
    pub case_id: String,
    // case_id is the stable v1 reference key; kind distinguishes its domain.
    #[serde(default)]
    pub kind: ReceiptKind,
    pub revision: u64,
    pub path: String,
    pub created_at: u64,
    pub expires_at: u64,
    pub confirmed: bool,
    #[serde(skip_serializing_if = "String::is_empty", default)]
    digest: String,
}

#[derive(Deserialize, Serialize)]
struct Catalog {
    schema: String,
    receipts: Vec<SavedCaseReceipt>,
}

fn now() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .map_err(|_| "SAVE_RECEIPT_CLOCK_FAILED".into())
}

pub fn storage_path() -> Result<PathBuf, String> {
    let base = std::env::var_os("LOCALAPPDATA").ok_or("SAVE_RECEIPT_STORAGE_UNAVAILABLE")?;
    Ok(PathBuf::from(base)
        .join("e-notario-v2")
        .join("saved-case-receipts.dpapi"))
}

fn crypt(value: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };
    if value.len() > MAX_BYTES {
        return Err("SAVE_RECEIPT_TOO_LARGE".into());
    }
    let input = CRYPT_INTEGER_BLOB {
        cbData: value.len() as u32,
        pbData: value.as_ptr() as *mut u8,
    };
    let entropy = CRYPT_INTEGER_BLOB {
        cbData: ENTROPY.len() as u32,
        pbData: ENTROPY.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    // DPAPI owns output. UI is forbidden; no credential prompts or log output.
    unsafe {
        let success = if encrypt {
            CryptProtectData(
                &input,
                std::ptr::null(),
                &entropy,
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                &entropy,
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if success == 0 {
            return Err("SAVE_RECEIPT_PROTECTION_FAILED".into());
        }
        if output.cbData as usize > MAX_BYTES {
            LocalFree(output.pbData as _);
            return Err("SAVE_RECEIPT_TOO_LARGE".into());
        }
        let result = if output.cbData == 0 {
            Vec::new()
        } else {
            std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec()
        };
        LocalFree(output.pbData as _);
        Ok(result)
    }
}

fn load(path: &Path) -> Result<Catalog, String> {
    if !path.exists() {
        return Ok(Catalog {
            schema: SCHEMA.into(),
            receipts: vec![],
        });
    }
    if path
        .metadata()
        .map_err(|_| "SAVE_RECEIPT_READ_FAILED")?
        .len()
        > MAX_BYTES as u64
    {
        return Err("SAVE_RECEIPT_TOO_LARGE".into());
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .map_err(|_| "SAVE_RECEIPT_READ_FAILED")?
        .take(MAX_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "SAVE_RECEIPT_READ_FAILED")?;
    if bytes.len() > MAX_BYTES {
        return Err("SAVE_RECEIPT_TOO_LARGE".into());
    }
    let decoded = crypt(&bytes, false)?;
    let catalog: Catalog = serde_json::from_slice(&decoded).map_err(|_| "SAVE_RECEIPT_INVALID")?;
    if catalog.schema != SCHEMA || catalog.receipts.len() > 64 {
        return Err("SAVE_RECEIPT_INVALID".into());
    }
    for receipt in &catalog.receipts {
        if uuid::Uuid::parse_str(&receipt.id).is_err()
            || uuid::Uuid::parse_str(&receipt.case_id).is_err()
            || receipt.path.len() > 32768
            || !Path::new(&receipt.path).is_absolute()
            || receipt.expires_at != receipt.created_at.saturating_add(RETENTION)
            || receipt.digest.len() != 64
            || !receipt.digest.bytes().all(|c| c.is_ascii_hexdigit())
        {
            return Err("SAVE_RECEIPT_INVALID".into());
        }
    }
    Ok(catalog)
}

fn save(path: &Path, catalog: &Catalog) -> Result<(), String> {
    let parent = path.parent().ok_or("SAVE_RECEIPT_STORAGE_UNAVAILABLE")?;
    std::fs::create_dir_all(parent).map_err(|_| "SAVE_RECEIPT_WRITE_FAILED")?;
    let plain = serde_json::to_vec(catalog).map_err(|_| "SAVE_RECEIPT_INVALID")?;
    let encrypted = crypt(&plain, true)?;
    let mut file =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| "SAVE_RECEIPT_WRITE_FAILED")?;
    file.write_all(&encrypted)
        .map_err(|_| "SAVE_RECEIPT_WRITE_FAILED")?;
    file.as_file()
        .sync_all()
        .map_err(|_| "SAVE_RECEIPT_WRITE_FAILED")?;
    file.persist(path)
        .map_err(|_| "SAVE_RECEIPT_WRITE_FAILED")?;
    Ok(())
}

fn prepare_at(
    store: &Path,
    context: &CaseSaveContext,
    destination: &Path,
    bytes: &[u8],
) -> Result<String, String> {
    uuid::Uuid::parse_str(&context.id).map_err(|_| "SAVE_RECEIPT_INVALID_CASE")?;
    let path = destination.to_str().ok_or("SAVE_RECEIPT_INVALID_PATH")?;
    if !destination.is_absolute() || path.len() > 32768 {
        return Err("SAVE_RECEIPT_INVALID_PATH".into());
    }
    let timestamp = now()?;
    let mut catalog = load(store)?;
    catalog.receipts.retain(|item| item.expires_at > timestamp);
    if catalog
        .receipts
        .iter()
        .any(|item| item.case_id == context.id && item.kind == context.kind)
    {
        return Err("SAVE_RECEIPT_ALREADY_EXISTS".into());
    }
    if catalog.receipts.len() >= 64 {
        return Err("SAVE_RECEIPT_LIMIT".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    catalog.receipts.push(SavedCaseReceipt {
        id: id.clone(),
        case_id: context.id.clone(),
        kind: context.kind,
        revision: context.revision,
        path: path.into(),
        created_at: timestamp,
        expires_at: timestamp + RETENTION,
        confirmed: false,
        digest: format!("{:x}", Sha256::digest(bytes)),
    });
    save(store, &catalog)?;
    Ok(id)
}

pub fn prepare(
    context: &CaseSaveContext,
    destination: &Path,
    bytes: &[u8],
) -> Result<String, String> {
    let _lock = LOCK.lock().map_err(|_| "SAVE_RECEIPT_BUSY")?;
    prepare_at(&storage_path()?, context, destination, bytes)
}

pub fn confirm(id: &str) -> Result<(), String> {
    let _lock = LOCK.lock().map_err(|_| "SAVE_RECEIPT_BUSY")?;
    let path = storage_path()?;
    let mut catalog = load(&path)?;
    let receipt = catalog
        .receipts
        .iter_mut()
        .find(|item| item.id == id)
        .ok_or("SAVE_RECEIPT_NOT_FOUND")?;
    receipt.confirmed = true;
    save(&path, &catalog)
}

fn list_at(path: &Path) -> Result<Vec<SavedCaseReceipt>, String> {
    let mut catalog = load(path)?;
    let timestamp = now()?;
    catalog.receipts.retain(|item| item.expires_at > timestamp);
    for receipt in &mut catalog.receipts {
        if !receipt.confirmed {
            if let Ok(metadata) = std::fs::metadata(&receipt.path) {
                if metadata.len() <= 25 * 1024 * 1024 {
                    if let Ok(file) = std::fs::File::open(&receipt.path) {
                        let mut bytes = Vec::new();
                        if file
                            .take(25 * 1024 * 1024 + 1)
                            .read_to_end(&mut bytes)
                            .is_ok()
                            && bytes.len() <= 25 * 1024 * 1024
                        {
                            receipt.confirmed =
                                format!("{:x}", Sha256::digest(&bytes)) == receipt.digest;
                        }
                    }
                }
            }
        }
    }
    if path.exists() {
        save(path, &catalog)?;
    }
    // Hashes are internal verification data, not UI or telemetry payloads.
    Ok(catalog
        .receipts
        .into_iter()
        .map(|mut item| {
            item.digest.clear();
            item
        })
        .collect())
}

pub fn list() -> Result<Vec<SavedCaseReceipt>, String> {
    let _lock = LOCK.lock().map_err(|_| "SAVE_RECEIPT_BUSY")?;
    list_at(&storage_path()?)
}

pub fn acknowledge(id: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(id).map_err(|_| "SAVE_RECEIPT_INVALID")?;
    let _lock = LOCK.lock().map_err(|_| "SAVE_RECEIPT_BUSY")?;
    let path = storage_path()?;
    acknowledge_at(&path, id)
}

fn acknowledge_at(path: &Path, id: &str) -> Result<(), String> {
    let mut catalog = load(path)?;
    let timestamp = now()?;
    catalog
        .receipts
        .retain(|item| item.id != id && item.expires_at > timestamp);
    if path.exists() {
        save(path, &catalog)?;
    }
    Ok(())
}

pub fn clear() -> Result<(), String> {
    let _lock = LOCK.lock().map_err(|_| "SAVE_RECEIPT_BUSY")?;
    let path = storage_path()?;
    if path.exists() {
        save(
            &path,
            &Catalog {
                schema: SCHEMA.into(),
                receipts: vec![],
            },
        )?;
    }
    Ok(())
}

fn prune_at(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let mut catalog = load(path)?;
    let count = catalog.receipts.len();
    let timestamp = now()?;
    catalog.receipts.retain(|item| item.expires_at > timestamp);
    if catalog.receipts.len() != count {
        save(path, &catalog)?;
    }
    Ok(())
}

pub struct CleanupGuard {
    stopped: Arc<AtomicBool>,
    thread: std::thread::JoinHandle<()>,
}

impl Drop for CleanupGuard {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Release);
        self.thread.thread().unpark();
    }
}

/// Retention must not depend on opening the document editor.
pub fn start_cleanup() -> std::io::Result<CleanupGuard> {
    let stopped = Arc::new(AtomicBool::new(false));
    let worker_stop = stopped.clone();
    let thread = std::thread::Builder::new()
        .name("saved-receipt-retention".into())
        .spawn(move || {
            while !worker_stop.load(Ordering::Acquire) {
                if let Ok(_lock) = LOCK.try_lock() {
                    if let Ok(path) = storage_path() {
                        // Corruption never becomes a fresh valid catalog. The UI
                        // reports it and blocks generation when recovery is requested.
                        let _ = prune_at(&path);
                    }
                }
                std::thread::park_timeout(std::time::Duration::from_secs(30));
            }
        })?;
    Ok(CleanupGuard { stopped, thread })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dpapi_roundtrip_and_tampering() {
        let bytes = crypt(b"synthetic-private-path", true).unwrap();
        assert!(!bytes
            .windows(22)
            .any(|item| item == b"synthetic-private-path"));
        assert_eq!(crypt(&bytes, false).unwrap(), b"synthetic-private-path");
        let mut modified = bytes;
        let end = modified.len() - 1;
        modified[end] ^= 1;
        assert!(crypt(&modified, false).is_err());
    }
    #[test]
    fn crash_between_file_commit_and_receipt_confirmation_is_recovered() {
        let directory = tempfile::tempdir().unwrap();
        let store = directory.path().join("receipts.dpapi");
        let output = directory.path().join("synthetic.docx");
        let context = CaseSaveContext {
            id: uuid::Uuid::new_v4().to_string(),
            revision: 4,
            kind: ReceiptKind::Case,
        };
        let id = prepare_at(&store, &context, &output, b"PK\x03\x04synthetic").unwrap();
        assert!(!list_at(&store).unwrap()[0].confirmed);
        std::fs::write(&output, b"PK\x03\x04synthetic").unwrap();
        let restored = list_at(&store).unwrap();
        assert_eq!(restored[0].id, id);
        assert!(restored[0].confirmed);
        // Subsequent editing in Word must not undo proof of the original save.
        std::fs::write(&output, b"edited-in-word").unwrap();
        assert!(list_at(&store).unwrap()[0].confirmed);
        let raw = std::fs::read(&store).unwrap();
        assert!(!raw
            .windows(context.id.len())
            .any(|item| item == context.id.as_bytes()));
    }
    #[test]
    fn different_existing_file_does_not_confirm_a_prepared_save() {
        let directory = tempfile::tempdir().unwrap();
        let store = directory.path().join("receipts.dpapi");
        let output = directory.path().join("synthetic.docx");
        std::fs::write(&output, b"old-content").unwrap();
        prepare_at(
            &store,
            &CaseSaveContext {
                id: uuid::Uuid::new_v4().to_string(),
                revision: 1,
                kind: ReceiptKind::Case,
            },
            &output,
            b"new-content",
        )
        .unwrap();
        assert!(!list_at(&store).unwrap()[0].confirmed);
    }
    #[test]
    fn receipts_expire_and_acknowledgement_never_deletes_word_files() {
        let directory = tempfile::tempdir().unwrap();
        let store = directory.path().join("receipts.dpapi");
        let output = directory.path().join("synthetic.docx");
        let context = CaseSaveContext {
            id: uuid::Uuid::new_v4().to_string(),
            revision: 1,
            kind: ReceiptKind::Case,
        };
        let id = prepare_at(&store, &context, &output, b"synthetic").unwrap();
        std::fs::write(&output, b"synthetic").unwrap();
        acknowledge_at(&store, &id).unwrap();
        acknowledge_at(&store, &id).unwrap();
        assert_eq!(std::fs::read(&output).unwrap(), b"synthetic");
        prune_at(&store).unwrap();
        assert!(list_at(&store).unwrap().is_empty());
        prepare_at(&store, &context, &output, b"synthetic").unwrap();
        let mut catalog = load(&store).unwrap();
        catalog.receipts[0].created_at = 0;
        catalog.receipts[0].expires_at = RETENTION;
        save(&store, &catalog).unwrap();
        prune_at(&store).unwrap();
        assert!(load(&store).unwrap().receipts.is_empty());
        assert!(list_at(&store).unwrap().is_empty());
        assert!(load(&store).unwrap().receipts.is_empty());
        assert!(output.is_file());
    }
    #[test]
    fn duplicate_saves_and_corrupt_catalogs_fail_closed() {
        let directory = tempfile::tempdir().unwrap();
        let store = directory.path().join("receipts.dpapi");
        let output = directory.path().join("synthetic.docx");
        let context = CaseSaveContext {
            id: uuid::Uuid::new_v4().to_string(),
            revision: 1,
            kind: ReceiptKind::Case,
        };
        prepare_at(&store, &context, &output, b"synthetic").unwrap();
        assert_eq!(
            prepare_at(&store, &context, &output, b"synthetic").unwrap_err(),
            "SAVE_RECEIPT_ALREADY_EXISTS"
        );
        std::fs::write(&store, b"tampered-encrypted-catalog").unwrap();
        assert!(list_at(&store).is_err());
        assert!(prepare_at(&store, &context, &output, b"synthetic").is_err());
        assert!(!output.exists());
    }
    #[test]
    fn receipt_kind_is_isolated_and_legacy_receipts_remain_readable() {
        let directory = tempfile::tempdir().unwrap();
        let store = directory.path().join("receipts.dpapi");
        let output = directory.path().join("synthetic.docx");
        let context = CaseSaveContext {
            id: uuid::Uuid::new_v4().to_string(),
            revision: 1,
            kind: ReceiptKind::Case,
        };
        prepare_at(&store, &context, &output, b"synthetic").unwrap();
        let mut request_context = context.clone();
        request_context.kind = ReceiptKind::DocumentRequest;
        prepare_at(&store, &request_context, &output, b"synthetic").unwrap();
        let receipts = list_at(&store).unwrap();
        assert!(receipts[0].kind == ReceiptKind::Case);
        assert!(receipts[1].kind == ReceiptKind::DocumentRequest);
        let mut legacy = serde_json::to_value(load(&store).unwrap()).unwrap();
        legacy["receipts"][0]
            .as_object_mut()
            .unwrap()
            .remove("kind");
        std::fs::write(
            &store,
            crypt(&serde_json::to_vec(&legacy).unwrap(), true).unwrap(),
        )
        .unwrap();
        assert!(load(&store).unwrap().receipts[0].kind == ReceiptKind::Case);
    }
}
