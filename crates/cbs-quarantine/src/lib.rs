//! CBS Shield quarantine vault.
//!
//! Design goals:
//! - Files are encrypted at rest with AES-256-GCM.
//! - The encryption key is random and protected by Windows DPAPI (current user).
//! - Restore never overwrites an existing path.
//! - The vault never deletes a user file automatically: `store` moves one file
//!   only after an explicit confirmation handled by the caller, and `purge`
//!   removes the encrypted blob only after an explicit confirmation.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use sha2::{Digest, Sha256};
use uuid::Uuid;

mod dpapi;

pub const MAGIC: &[u8; 5] = b"CBSQ1";
pub const NONCE_LEN: usize = 12;
pub const KEY_LEN: usize = 32;
pub const MAX_FILE_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum QuarantineError {
    #[error("fichier introuvable : {0}")]
    NotFound(String),
    #[error("cet élément existe déjà : {0}")]
    AlreadyExists(String),
    #[error("fichier trop volumineux pour la quarantaine ({0} octets, maximum {MAX_FILE_BYTES})")]
    TooLarge(u64),
    #[error("la cible n'est pas un fichier ordinaire : {0}")]
    NotAFile(String),
    #[error("coffre de quarantaine invalide : {0}")]
    InvalidVault(String),
    #[error("échec cryptographique : {0}")]
    Crypto(String),
    /// The encrypted blob is stored and verified, but the source file could not
    /// be removed (locked, sharing violation, permission denied…). The blob is
    /// deliberately kept so no data is lost; the item id lets the caller record
    /// and reconcile the incomplete transition.
    #[error(
        "le fichier n'a pas pu être retiré ({reason}) ; la copie chiffrée {item_id} est conservée : {path}"
    )]
    SourceRetained {
        path: String,
        item_id: String,
        reason: String,
    },
    #[error("échec d'entrée/sortie : {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredItem {
    pub item_id: String,
    pub file_name: String,
    pub stored_path: PathBuf,
    pub sha256: String,
    pub size_bytes: u64,
}

/// Result of a quarantine move: the encrypted item plus whether the source was
/// actually removed. `source_removed == false` means the transition is
/// incomplete but fully recoverable (the blob is verified before returning).
#[derive(Debug, Clone)]
pub struct StoreOutcome {
    pub item: StoredItem,
    pub source_removed: bool,
}

#[derive(Clone)]
pub struct Quarantine {
    root: PathBuf,
    key_path: PathBuf,
    /// Serializes vault mutations inside this process. Two concurrent calls on
    /// the same file can then never stage two blobs or race a removal against a
    /// restore. Cross-process safety comes from the single-instance guard.
    op_lock: Arc<Mutex<()>>,
}

impl Quarantine {
    /// `root` is the vault directory; the DPAPI-protected key is stored next to
    /// it (`<parent>/quarantine.key`) so the vault itself only holds blobs.
    pub fn new(root: PathBuf) -> Self {
        let key_path = root
            .parent()
            .map(|parent| parent.join("quarantine.key"))
            .unwrap_or_else(|| root.join("quarantine.key"));
        Self {
            root,
            key_path,
            op_lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn with_key_path(root: PathBuf, key_path: PathBuf) -> Self {
        Self {
            root,
            key_path,
            op_lock: Arc::new(Mutex::new(())),
        }
    }

    fn lock_ops(&self) -> Result<MutexGuard<'_, ()>, QuarantineError> {
        self.op_lock
            .lock()
            .map_err(|_| QuarantineError::InvalidVault("verrou du coffre empoisonné".to_string()))
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn ensure_layout(&self) -> Result<(), QuarantineError> {
        fs::create_dir_all(&self.root)?;
        cleanup_temp_blobs(&self.root);
        if !self.key_path.is_file() {
            let key = random_bytes(KEY_LEN)?;
            let protected = dpapi::protect(&key)?;
            if let Some(parent) = self.key_path.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            // Off Windows (tests/CI) the key file itself is the secret: make
            // it owner-only, as documented in dpapi.rs.
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            match options.open(&self.key_path) {
                Ok(mut file) => {
                    file.write_all(&protected)?;
                    file.sync_all()?;
                }
                // Another instance won the race: reuse its key.
                Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(err) => return Err(err.into()),
            }
        }
        Ok(())
    }

    fn load_key(&self) -> Result<[u8; KEY_LEN], QuarantineError> {
        let protected = fs::read(&self.key_path).map_err(|err| {
            if err.kind() == std::io::ErrorKind::NotFound {
                QuarantineError::InvalidVault(
                    "clé de quarantaine absente ; le coffre ne peut pas être ouvert".to_string(),
                )
            } else {
                QuarantineError::Io(err)
            }
        })?;
        let key = dpapi::unprotect(&protected)?;
        if key.len() != KEY_LEN {
            return Err(QuarantineError::InvalidVault(
                "la clé de quarantaine a une taille invalide".to_string(),
            ));
        }
        let mut out = [0u8; KEY_LEN];
        out.copy_from_slice(&key);
        Ok(out)
    }

    /// Path of an item's blob. `item_id` is always a UUID minted by
    /// [`Quarantine::stage`]; anything else (for example a tampered database
    /// value such as `..\key`) is refused so it can never address a file
    /// outside the vault.
    fn blob_path(&self, item_id: &str) -> Result<PathBuf, QuarantineError> {
        let parsed = Uuid::parse_str(item_id).map_err(|_| {
            QuarantineError::InvalidVault(format!("identifiant d'élément invalide : {item_id}"))
        })?;
        Ok(self.root.join(format!("{}.cbsq", parsed.hyphenated())))
    }

    /// Encrypt a file into the vault **without touching the source**.
    ///
    /// The blob is written to a temporary name, fsynced, renamed atomically and
    /// then read back and decrypted to prove it is intact. A failure at any
    /// step leaves the source untouched and removes the partial temporary file.
    pub fn stage(&self, source: &Path) -> Result<StoredItem, QuarantineError> {
        let _guard = self.lock_ops()?;
        self.ensure_layout()?;

        if !source.exists() {
            return Err(QuarantineError::NotFound(source.display().to_string()));
        }
        let metadata = fs::symlink_metadata(source)?;
        if metadata.file_type().is_symlink() {
            return Err(QuarantineError::NotAFile(
                "les liens symboliques ne sont pas mis en quarantaine".to_string(),
            ));
        }
        if !metadata.is_file() {
            return Err(QuarantineError::NotAFile(source.display().to_string()));
        }
        if metadata.len() > MAX_FILE_BYTES {
            return Err(QuarantineError::TooLarge(metadata.len()));
        }

        // Open without following reparse points and re-check the *opened*
        // object: a symlink swapped in after `symlink_metadata` is refused.
        let mut file = open_no_follow(source, false)?;
        let opened = file.metadata()?;
        if opened.file_type().is_symlink() || !opened.is_file() {
            return Err(QuarantineError::NotAFile(
                "le fichier a été remplacé par un lien ou un dossier".to_string(),
            ));
        }
        if opened.len() > MAX_FILE_BYTES {
            return Err(QuarantineError::TooLarge(opened.len()));
        }
        let mut data = Vec::with_capacity(opened.len() as usize);
        (&mut file)
            .take(MAX_FILE_BYTES + 1)
            .read_to_end(&mut data)?;
        if data.len() as u64 > MAX_FILE_BYTES {
            return Err(QuarantineError::TooLarge(data.len() as u64));
        }
        drop(file);

        let sha256 = hex_digest(&data);
        let item_id = Uuid::new_v4().to_string();
        let file_name = source
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "fichier".to_string());

        let key = self.load_key()?;
        let cipher = Aes256Gcm::new_from_slice(&key)
            .map_err(|err| QuarantineError::Crypto(err.to_string()))?;
        let mut nonce_bytes = [0u8; NONCE_LEN];
        getrandom::getrandom(&mut nonce_bytes)
            .map_err(|err| QuarantineError::Crypto(err.to_string()))?;
        let ciphertext = cipher
            .encrypt(
                Nonce::from_slice(&nonce_bytes),
                Payload {
                    msg: &data,
                    aad: item_id.as_bytes(),
                },
            )
            .map_err(|_| QuarantineError::Crypto("chiffrement refusé".to_string()))?;

        let stored_path = self.blob_path(&item_id)?;
        let temp_path = self.root.join(format!(".{item_id}.tmp"));

        // Write, flush, rename. Any error removes the partial file so a
        // disk-full or interrupted write can never leave a half blob.
        let write_result = (|| -> Result<(), QuarantineError> {
            let mut blob = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp_path)?;
            blob.write_all(MAGIC)?;
            blob.write_all(&nonce_bytes)?;
            blob.write_all(&ciphertext)?;
            blob.sync_all()?;
            Ok(())
        })();
        if let Err(err) = write_result {
            let _ = fs::remove_file(&temp_path);
            return Err(err);
        }
        if let Err(err) = fs::rename(&temp_path, &stored_path) {
            let _ = fs::remove_file(&temp_path);
            return Err(err.into());
        }

        // Prove the stored copy is readable and authentic *before* anyone is
        // allowed to delete the source.
        match self.decrypt_blob(&item_id) {
            Ok(plain) if hex_digest(&plain) == sha256 => {}
            Ok(_) => {
                let _ = fs::remove_file(&stored_path);
                return Err(QuarantineError::InvalidVault(
                    "la copie chiffrée ne restitue pas le contenu d'origine".to_string(),
                ));
            }
            Err(err) => {
                let _ = fs::remove_file(&stored_path);
                return Err(err);
            }
        }

        Ok(StoredItem {
            item_id,
            file_name,
            stored_path,
            sha256,
            size_bytes: data.len() as u64,
        })
    }

    /// Remove the source of an already staged item.
    ///
    /// - Success: the file is gone and the verified blob is the only copy.
    /// - `NotFound`: the source vanished concurrently (another scanner moved
    ///   it). The blob is kept and the transition is considered complete.
    /// - Any other error (sharing violation, access denied, read-only file):
    ///   the blob is **kept** and `SourceRetained` is returned so the caller
    ///   can record an incomplete-but-recoverable state.
    pub fn commit(&self, item: &StoredItem, source: &Path) -> Result<(), QuarantineError> {
        let _guard = self.lock_ops()?;
        // Re-verify before deletion: never remove a source whose blob is gone
        // or unreadable (for example if the vault was cleaned concurrently).
        self.verify_blob(&item.item_id, &item.sha256)?;
        // Only delete the exact content that was encrypted: the file is
        // re-hashed through the handle that performs the deletion, so a file
        // swapped in after staging is never removed.
        let retained = |reason: String| QuarantineError::SourceRetained {
            path: source.display().to_string(),
            item_id: item.item_id.clone(),
            reason,
        };
        match delete_if_unchanged(source, &item.sha256) {
            Ok(()) => Ok(()),
            Err(DeleteError::Missing) => Ok(()),
            Err(DeleteError::Changed) => Err(retained(
                "le fichier a changé ou a été remplacé depuis sa copie chiffrée".to_string(),
            )),
            Err(DeleteError::Io(err)) => Err(retained(err.to_string())),
        }
    }

    /// Encrypt and move one file into the vault in a single call.
    ///
    /// On `SourceRetained`, the returned `StoreOutcome` still carries the item
    /// so the caller can persist an incomplete record. The source is never
    /// deleted unless the blob has been verified first.
    pub fn store(&self, source: &Path) -> Result<StoreOutcome, QuarantineError> {
        let item = self.stage(source)?;
        match self.commit(&item, source) {
            Ok(()) => Ok(StoreOutcome {
                item,
                source_removed: true,
            }),
            Err(QuarantineError::SourceRetained { .. }) => Ok(StoreOutcome {
                item,
                source_removed: false,
            }),
            Err(err) => {
                // Staging succeeded but the blob could not be re-verified:
                // drop the unusable copy rather than leaving an orphan.
                let _ = fs::remove_file(&item.stored_path);
                Err(err)
            }
        }
    }

    /// Read and decrypt one blob, proving its authenticity (AES-GCM tag) and
    /// returning the plaintext. Used by restore, commits and staging checks.
    fn decrypt_blob(&self, item_id: &str) -> Result<Vec<u8>, QuarantineError> {
        let blob_path = self.blob_path(item_id)?;
        let blob = fs::read(&blob_path).map_err(|err| {
            if err.kind() == std::io::ErrorKind::NotFound {
                QuarantineError::NotFound(blob_path.display().to_string())
            } else {
                QuarantineError::Io(err)
            }
        })?;
        if blob.len() < MAGIC.len() + NONCE_LEN + 16 || &blob[..MAGIC.len()] != MAGIC {
            return Err(QuarantineError::InvalidVault(
                "format de coffre non reconnu".to_string(),
            ));
        }

        let nonce_start = MAGIC.len();
        let ciphertext_start = nonce_start + NONCE_LEN;
        let nonce = &blob[nonce_start..ciphertext_start];
        let ciphertext = &blob[ciphertext_start..];

        let key = self.load_key()?;
        let cipher = Aes256Gcm::new_from_slice(&key)
            .map_err(|err| QuarantineError::Crypto(err.to_string()))?;
        cipher
            .decrypt(
                Nonce::from_slice(nonce),
                Payload {
                    msg: ciphertext,
                    aad: item_id.as_bytes(),
                },
            )
            .map_err(|_| {
                QuarantineError::Crypto(
                    "déchiffrement impossible (données altérées ou clé différente)".to_string(),
                )
            })
    }

    fn verify_blob(&self, item_id: &str, expected_sha256: &str) -> Result<(), QuarantineError> {
        let plain = self.decrypt_blob(item_id)?;
        if hex_digest(&plain).eq_ignore_ascii_case(expected_sha256) {
            Ok(())
        } else {
            Err(QuarantineError::InvalidVault(format!(
                "empreinte SHA-256 incohérente pour {item_id}"
            )))
        }
    }

    /// Decrypt an item to `destination`. Refuses to overwrite anything.
    ///
    /// `expected_sha256` binds the restore to the hash recorded in SQLite.
    pub fn restore(
        &self,
        item_id: &str,
        destination: &Path,
        expected_sha256: Option<&str>,
    ) -> Result<PathBuf, QuarantineError> {
        let _guard = self.lock_ops()?;
        if destination.exists() {
            return Err(QuarantineError::AlreadyExists(
                destination.display().to_string(),
            ));
        }
        let Some(parent) = destination.parent() else {
            return Err(QuarantineError::InvalidVault(
                "destination invalide".to_string(),
            ));
        };
        if !parent.is_dir() {
            return Err(QuarantineError::NotFound(format!(
                "dossier de destination absent : {}",
                parent.display()
            )));
        }

        let blob_path = self.blob_path(item_id)?;
        let plaintext = self.decrypt_blob(item_id)?;

        if let Some(expected) = expected_sha256 {
            let actual = hex_digest(&plaintext);
            if !actual.eq_ignore_ascii_case(expected) {
                return Err(QuarantineError::InvalidVault(format!(
                    "empreinte SHA-256 incohérente (attendu {expected}, obtenu {actual})"
                )));
            }
        }

        let mut out = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(destination)?;
        out.write_all(&plaintext)?;
        out.sync_all()?;
        drop(out);

        // Best effort: the restored file is the source of truth. A leftover
        // encrypted blob is inert and can be purged from the UI.
        let _ = fs::remove_file(&blob_path);
        Ok(destination.to_path_buf())
    }

    /// Permanently remove the encrypted blob. The caller is responsible for the
    /// explicit confirmation and for updating the audit record.
    pub fn purge(&self, item_id: &str) -> Result<(), QuarantineError> {
        let _guard = self.lock_ops()?;
        let path = self.blob_path(item_id)?;
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(err) => Err(err.into()),
        }
    }
}

fn random_bytes(len: usize) -> Result<Vec<u8>, QuarantineError> {
    let mut bytes = vec![0u8; len];
    getrandom::getrandom(&mut bytes).map_err(|err| QuarantineError::Crypto(err.to_string()))?;
    Ok(bytes)
}

/// Remove orphaned temporary blobs left by a crash during `store`.
///
/// `store` writes the encrypted blob as `.<item_id>.tmp` and then renames it
/// to `<item_id>.cbsq`. If the application dies between the two steps, the
/// temporary file stays in the vault. Such a file can never be legitimate
/// (nothing else in the vault uses that naming nor that extension), so it is
/// safe to delete every `.tmp` file at startup and before each store.
fn cleanup_temp_blobs(root: &Path) -> usize {
    let Ok(entries) = fs::read_dir(root) else {
        return 0;
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        let is_temp_blob = entry.file_type().map(|t| t.is_file()).unwrap_or(false)
            && path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with('.') && name.ends_with(".tmp"));
        if is_temp_blob && fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    removed
}

fn hex_digest(data: &[u8]) -> String {
    format!("{:x}", Sha256::digest(data))
}

/// Open a file for reading without following a final symlink/junction
/// (`FILE_FLAG_OPEN_REPARSE_POINT`). With `delete`, the handle also carries
/// `DELETE` access so the file can be removed through it.
fn open_no_follow(path: &Path, delete: bool) -> std::io::Result<fs::File> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{
            DELETE, FILE_FLAG_OPEN_REPARSE_POINT, FILE_GENERIC_READ,
        };
        let access = if delete {
            FILE_GENERIC_READ | DELETE
        } else {
            FILE_GENERIC_READ
        };
        options
            .access_mode(access)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    #[cfg(not(windows))]
    {
        let _ = delete;
    }
    options.open(path)
}

#[derive(Debug)]
enum DeleteError {
    Missing,
    Changed,
    Io(std::io::Error),
}

/// Delete `path` only if it is still a regular file whose SHA-256 equals
/// `expected_sha256`.
///
/// On Windows the hash check and the deletion use the same handle (delete
/// disposition set via `SetFileInformationByHandle`), so the object that was
/// verified is exactly the one removed, even if the path is swapped.
fn delete_if_unchanged(path: &Path, expected_sha256: &str) -> Result<(), DeleteError> {
    let mut file = match open_no_follow(path, true) {
        Ok(file) => file,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Err(DeleteError::Missing),
        Err(err) => return Err(DeleteError::Io(err)),
    };
    let metadata = file.metadata().map_err(DeleteError::Io)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(DeleteError::Changed);
    }
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(DeleteError::Io)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    if !format!("{:x}", hasher.finalize()).eq_ignore_ascii_case(expected_sha256) {
        return Err(DeleteError::Changed);
    }

    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            FileDispositionInfo, SetFileInformationByHandle, FILE_DISPOSITION_INFO,
        };
        let info = FILE_DISPOSITION_INFO { DeleteFile: true };
        // SAFETY: the handle is owned by `file` and valid for the call; `info`
        // is a properly sized FILE_DISPOSITION_INFO living on the stack.
        let ok = unsafe {
            SetFileInformationByHandle(
                file.as_raw_handle() as _,
                FileDispositionInfo,
                (&info as *const FILE_DISPOSITION_INFO).cast(),
                std::mem::size_of::<FILE_DISPOSITION_INFO>() as u32,
            )
        };
        if ok == 0 {
            return Err(DeleteError::Io(std::io::Error::last_os_error()));
        }
        // The file disappears when this last handle closes.
        drop(file);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        drop(file);
        fs::remove_file(path).map_err(|err| {
            if err.kind() == std::io::ErrorKind::NotFound {
                DeleteError::Missing
            } else {
                DeleteError::Io(err)
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, Quarantine) {
        let dir = tempfile::tempdir().unwrap();
        let q = Quarantine::new(dir.path().join("vault"));
        (dir, q)
    }

    #[test]
    fn commit_never_deletes_a_file_swapped_after_staging() {
        // Regression: commit() used to delete by path, so a different file
        // placed at the same path after staging was removed.
        let (dir, q) = setup();
        let source = dir.path().join("target.bin");
        fs::write(&source, b"original detected content").unwrap();
        let item = q.stage(&source).unwrap();

        fs::write(&source, b"an unrelated user document").unwrap();
        match q.commit(&item, &source) {
            Err(QuarantineError::SourceRetained { .. }) => {}
            other => panic!("expected SourceRetained, got {other:?}"),
        }
        assert_eq!(fs::read(&source).unwrap(), b"an unrelated user document");
        assert!(item.stored_path.is_file(), "the verified blob is kept");
    }

    #[test]
    fn commit_deletes_the_unchanged_source() {
        let (dir, q) = setup();
        let source = dir.path().join("unchanged.bin");
        fs::write(&source, b"payload").unwrap();
        let item = q.stage(&source).unwrap();
        q.commit(&item, &source).unwrap();
        assert!(!source.exists());
    }

    #[test]
    fn non_uuid_item_ids_are_refused() {
        let (_dir, q) = setup();
        q.ensure_layout().unwrap();
        for id in ["..\\quarantine", "../key", "abc", ""] {
            assert!(q.purge(id).is_err(), "{id:?} must be refused");
            assert!(q.verify_blob(id, "00").is_err(), "{id:?} must be refused");
        }
    }

    #[test]
    fn store_encrypts_and_removes_source() {
        let (dir, q) = setup();
        let source = dir.path().join("suspicious.bin");
        fs::write(&source, b"harmless test content").unwrap();

        let outcome = q.store(&source).unwrap();
        assert!(
            outcome.source_removed,
            "the source must be removed on success"
        );
        let item = outcome.item;
        assert!(!source.exists());
        assert!(item.stored_path.is_file());
        assert_eq!(item.size_bytes, 21);
        assert_eq!(item.file_name, "suspicious.bin");

        let raw = fs::read(&item.stored_path).unwrap();
        assert!(raw.starts_with(MAGIC));
        assert!(!raw
            .windows(b"harmless test content".len())
            .any(|window| window == b"harmless test content"));
    }

    #[test]
    fn restore_roundtrip_preserves_content_and_refuses_overwrite() {
        let (dir, q) = setup();
        let source = dir.path().join("doc.txt");
        fs::write(&source, b"content to restore").unwrap();
        let outcome = q.store(&source).unwrap();
        assert!(
            outcome.source_removed,
            "the source must be removed on success"
        );
        let item = outcome.item;

        let destination = dir.path().join("restored.txt");
        q.restore(&item.item_id, &destination, Some(&item.sha256))
            .unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"content to restore");
        assert!(!item.stored_path.exists());

        assert!(matches!(
            q.restore(&item.item_id, &destination, None),
            Err(QuarantineError::AlreadyExists(_))
        ));
    }

    #[test]
    fn restore_rejects_wrong_hash() {
        let (dir, q) = setup();
        let source = dir.path().join("doc.txt");
        fs::write(&source, b"integrity").unwrap();
        let outcome = q.store(&source).unwrap();
        assert!(
            outcome.source_removed,
            "the source must be removed on success"
        );
        let item = outcome.item;

        let result = q.restore(
            &item.item_id,
            &dir.path().join("restored.txt"),
            Some("0000"),
        );
        assert!(matches!(result, Err(QuarantineError::InvalidVault(_))));
    }

    #[test]
    fn aad_binds_blob_to_item_id() {
        let (dir, q) = setup();
        let source = dir.path().join("doc.txt");
        fs::write(&source, b"binding").unwrap();
        let outcome = q.store(&source).unwrap();
        assert!(
            outcome.source_removed,
            "the source must be removed on success"
        );
        let item = outcome.item;

        let other = "00000000-0000-0000-0000-000000000000";
        let copied = q.root().join(format!("{other}.cbsq"));
        fs::copy(&item.stored_path, &copied).unwrap();

        let result = q.restore(other, &dir.path().join("out.txt"), None);
        assert!(matches!(result, Err(QuarantineError::Crypto(_))));
    }

    #[test]
    fn purge_removes_blob_and_is_idempotent() {
        let (dir, q) = setup();
        let source = dir.path().join("doc.txt");
        fs::write(&source, b"purge me").unwrap();
        let outcome = q.store(&source).unwrap();
        assert!(
            outcome.source_removed,
            "the source must be removed on success"
        );
        let item = outcome.item;

        q.purge(&item.item_id).unwrap();
        assert!(!item.stored_path.exists());
        q.purge(&item.item_id).unwrap();
    }

    #[test]
    fn refuses_directories_and_symlinks_are_not_followed() {
        let (dir, q) = setup();
        let folder = dir.path().join("folder");
        fs::create_dir(&folder).unwrap();
        assert!(matches!(
            q.store(&folder),
            Err(QuarantineError::NotAFile(_))
        ));
    }

    #[test]
    fn missing_source_is_reported() {
        let (_dir, q) = setup();
        let missing = PathBuf::from(r"C:\nope\missing.bin");
        assert!(matches!(
            q.store(&missing),
            Err(QuarantineError::NotFound(_))
        ));
    }

    #[test]
    fn stale_temp_blobs_are_cleaned_on_layout_ensure() {
        // Simulates a crash during `store`: the temporary blob was written but
        // the atomic rename never happened.
        let (_dir, q) = setup();
        q.ensure_layout().unwrap();
        let orphan = q.root().join(".0b9e9c9a-dead-4a5f-8e30-000000000001.tmp");
        fs::write(&orphan, b"partial encrypted blob").unwrap();

        q.ensure_layout().unwrap();
        assert!(!orphan.exists(), "orphaned temp blob must be removed");

        // Ordinary blobs and unrelated files are never touched.
        let kept = q.root().join("readme.txt");
        fs::write(&kept, b"keep me").unwrap();
        q.ensure_layout().unwrap();
        assert!(kept.exists());
    }

    #[test]
    fn truncated_and_corrupt_blobs_fail_cleanly() {
        let (dir, q) = setup();
        q.ensure_layout().unwrap();

        // Blob cut short by a disk-full crash: unknown format, no panic.
        let truncated_id = "00000000-0000-4000-8000-000000000001";
        let truncated = q.root().join(format!("{truncated_id}.cbsq"));
        fs::write(&truncated, b"CBS").unwrap();
        let result = q.restore(truncated_id, &dir.path().join("out1.txt"), None);
        assert!(matches!(result, Err(QuarantineError::InvalidVault(_))));

        // Blob with a valid header but altered ciphertext: authenticated
        // decryption must refuse instead of writing garbage to disk.
        let corrupt_id = "00000000-0000-4000-8000-000000000002";
        let corrupt = q.root().join(format!("{corrupt_id}.cbsq"));
        let mut payload = MAGIC.to_vec();
        payload.resize(MAGIC.len() + NONCE_LEN + 32, 0xAB);
        fs::write(&corrupt, &payload).unwrap();
        let result = q.restore(corrupt_id, &dir.path().join("out2.txt"), None);
        assert!(matches!(result, Err(QuarantineError::Crypto(_))));
        assert!(!dir.path().join("out2.txt").exists());
    }

    // ---- Sprint 9.3 / A3 regression: the vault must never destroy data ----

    #[test]
    fn stage_leaves_the_source_untouched() {
        let (dir, q) = setup();
        let source = dir.path().join("staged.txt");
        fs::write(&source, b"staging only").unwrap();

        let item = q.stage(&source).unwrap();
        assert!(source.exists(), "stage() must not remove the source");
        assert!(item.stored_path.is_file());
        assert!(fs::read(&item.stored_path).unwrap().starts_with(MAGIC));

        // The staged blob is already usable for a restore.
        let out = dir.path().join("back.txt");
        q.restore(&item.item_id, &out, Some(&item.sha256)).unwrap();
        assert_eq!(fs::read(&out).unwrap(), b"staging only");
    }

    #[test]
    fn commit_treats_a_vanished_source_as_success() {
        let (dir, q) = setup();
        let source = dir.path().join("vanishing.txt");
        fs::write(&source, b"deleted by another scanner").unwrap();

        let item = q.stage(&source).unwrap();
        // Simulate a third-party antivirus removing the file between the
        // encryption and the deletion step.
        fs::remove_file(&source).unwrap();
        q.commit(&item, &source).unwrap();

        assert!(item.stored_path.is_file(), "blob must be kept");
        let out = dir.path().join("recovered.txt");
        q.restore(&item.item_id, &out, Some(&item.sha256)).unwrap();
        assert_eq!(fs::read(&out).unwrap(), b"deleted by another scanner");
    }

    #[cfg(windows)]
    #[test]
    fn locked_source_is_retained_and_blob_preserved() {
        use std::os::windows::fs::OpenOptionsExt;

        let (dir, q) = setup();
        let source = dir.path().join("locked.txt");
        fs::write(&source, b"locked by another process").unwrap();

        // Hold the file open without FILE_SHARE_DELETE: any deletion attempt
        // fails with a sharing violation until the handle is closed.
        let holder = fs::OpenOptions::new()
            .read(true)
            .share_mode(0x1) // FILE_SHARE_READ only
            .open(&source)
            .unwrap();

        let outcome = q.store(&source).unwrap();
        assert!(
            !outcome.source_removed,
            "a locked file cannot be deleted on Windows"
        );
        assert!(outcome.item.stored_path.is_file(), "blob must be preserved");
        assert!(source.exists(), "source must still be there");

        // Once the lock is released the same item can be committed for real:
        // the verified blob is still there and the source is finally removed.
        drop(holder);
        q.commit(&outcome.item, &source).unwrap();
        assert!(!source.exists());

        // The preserved blob still restores the exact original content.
        let copy = dir.path().join("copy.txt");
        q.restore(&outcome.item.item_id, &copy, Some(&outcome.item.sha256))
            .unwrap();
        assert_eq!(fs::read(&copy).unwrap(), b"locked by another process");
    }

    #[test]
    fn commit_refuses_when_the_blob_is_missing_or_corrupted() {
        let (dir, q) = setup();
        let source = dir.path().join("source.txt");
        fs::write(&source, b"original").unwrap();

        let item = q.stage(&source).unwrap();
        // Corrupt the blob after staging: the source must not be deleted.
        fs::write(&item.stored_path, b"not a valid blob").unwrap();
        let result = q.commit(&item, &source);
        assert!(matches!(result, Err(QuarantineError::InvalidVault(_))));
        assert!(
            source.exists(),
            "a corrupt blob must never destroy the source"
        );
        assert_eq!(fs::read(&source).unwrap(), b"original");

        // Missing blob behaves the same way.
        fs::remove_file(&item.stored_path).unwrap();
        let result = q.commit(&item, &source);
        assert!(matches!(result, Err(QuarantineError::NotFound(_))));
        assert!(source.exists());
        let _ = dir;
    }

    #[test]
    fn concurrent_stores_are_serialized_and_leave_no_temp_files() {
        let (dir, q) = setup();
        q.ensure_layout().unwrap();
        let mut handles = Vec::new();
        for index in 0..8 {
            let q = q.clone();
            let path = dir.path().join(format!("concurrent-{index}.txt"));
            fs::write(&path, format!("payload {index}")).unwrap();
            handles.push(std::thread::spawn(move || {
                let outcome = q.store(&path).unwrap();
                assert!(outcome.source_removed);
                outcome.item
            }));
        }
        let items: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        assert_eq!(items.len(), 8);

        let leftover_temp = fs::read_dir(q.root())
            .unwrap()
            .flatten()
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .count();
        assert_eq!(leftover_temp, 0, "no temporary blob may survive a store");
        let blobs = fs::read_dir(q.root())
            .unwrap()
            .flatten()
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".cbsq"))
            .count();
        assert_eq!(blobs, 8);
    }
}
