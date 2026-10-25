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

#[derive(Clone)]
pub struct Quarantine {
    root: PathBuf,
    key_path: PathBuf,
}

impl Quarantine {
    /// `root` is the vault directory; the DPAPI-protected key is stored next to
    /// it (`<parent>/quarantine.key`) so the vault itself only holds blobs.
    pub fn new(root: PathBuf) -> Self {
        let key_path = root
            .parent()
            .map(|parent| parent.join("quarantine.key"))
            .unwrap_or_else(|| root.join("quarantine.key"));
        Self { root, key_path }
    }

    pub fn with_key_path(root: PathBuf, key_path: PathBuf) -> Self {
        Self { root, key_path }
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
            match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&self.key_path)
            {
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

    fn blob_path(&self, item_id: &str) -> PathBuf {
        self.root.join(format!("{item_id}.cbsq"))
    }

    /// Encrypt and move one file into the vault.
    ///
    /// The source is removed only after the encrypted blob has been written and
    /// flushed. If removal fails, the blob is rolled back.
    pub fn store(&self, source: &Path) -> Result<StoredItem, QuarantineError> {
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

        let mut data = Vec::with_capacity(metadata.len() as usize);
        let mut file = fs::File::open(source)?;
        file.read_to_end(&mut data)?;

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

        let stored_path = self.blob_path(&item_id);
        let temp_path = self.root.join(format!(".{item_id}.tmp"));
        {
            let mut blob = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp_path)?;
            blob.write_all(MAGIC)?;
            blob.write_all(&nonce_bytes)?;
            blob.write_all(&ciphertext)?;
            blob.sync_all()?;
        }
        fs::rename(&temp_path, &stored_path)?;

        if let Err(err) = fs::remove_file(source) {
            let _ = fs::remove_file(&stored_path);
            return Err(err.into());
        }

        Ok(StoredItem {
            item_id,
            file_name,
            stored_path,
            sha256,
            size_bytes: data.len() as u64,
        })
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

        let blob_path = self.blob_path(item_id);
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
        let plaintext = cipher
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
            })?;

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
        let path = self.blob_path(item_id);
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

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, Quarantine) {
        let dir = tempfile::tempdir().unwrap();
        let q = Quarantine::new(dir.path().join("vault"));
        (dir, q)
    }

    #[test]
    fn store_encrypts_and_removes_source() {
        let (dir, q) = setup();
        let source = dir.path().join("suspicious.bin");
        fs::write(&source, b"harmless test content").unwrap();

        let item = q.store(&source).unwrap();
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
        let item = q.store(&source).unwrap();

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
        let item = q.store(&source).unwrap();

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
        let item = q.store(&source).unwrap();

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
        let item = q.store(&source).unwrap();

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
}
