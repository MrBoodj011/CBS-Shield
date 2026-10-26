//! Official ClamAV signature database inventory.
//!
//! `clamscan --version` reports `ClamAV <engine>/<daily version>/<date>`.
//! The number after the engine is the **daily CVD revision** (for example
//! `28164`), not a signature count. This module reads the real counts from the
//! CVD headers with `sigtool --info`, verifies the embedded digital signature
//! marker and lists custom/test signature files separately.

use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::{SecondsFormat, Utc};
use serde::Serialize;

use crate::engine::execute_with_timeout;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureComponent {
    pub file: String,
    pub version: Option<String>,
    pub signatures: Option<u64>,
    pub build_time: Option<String>,
    pub verified: bool,
    pub md5: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomSignatureFile {
    pub file: String,
    pub signatures: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureInventory {
    pub database_dir: Option<String>,
    pub sigtool_available: bool,
    /// Official `.cvd`/`.cld` components with the counts declared in their
    /// headers. Their sum is the documented signature total.
    pub official_components: Vec<SignatureComponent>,
    pub official_signatures: u64,
    /// Local `.ndb`/`.hdb`/`.ldb`/... files. These are *not* official
    /// signatures; they are normally test fixtures created by the user.
    pub custom_signature_files: Vec<CustomSignatureFile>,
    pub custom_signatures: u64,
    pub checked_at: String,
    pub notes: Vec<String>,
}

impl Default for SignatureInventory {
    fn default() -> Self {
        Self {
            database_dir: None,
            sigtool_available: false,
            official_components: Vec::new(),
            official_signatures: 0,
            custom_signature_files: Vec::new(),
            custom_signatures: 0,
            checked_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
            notes: Vec::new(),
        }
    }
}

/// Read the full inventory. Missing tools/directories never produce fake data:
/// the corresponding fields stay empty and a note explains why.
pub fn read_inventory(database: Option<&Path>, sigtool: Option<&Path>) -> SignatureInventory {
    let mut inventory = SignatureInventory {
        database_dir: database.map(|path| path.display().to_string()),
        sigtool_available: sigtool.map(Path::is_file).unwrap_or(false),
        ..SignatureInventory::default()
    };

    let Some(database) = database else {
        inventory
            .notes
            .push("Aucun dossier de signatures n'a été localisé.".to_string());
        return inventory;
    };
    let Ok(entries) = std::fs::read_dir(database) else {
        inventory.notes.push(format!(
            "Le dossier de signatures est illisible : {}",
            database.display()
        ));
        return inventory;
    };

    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_file())
        .collect();
    files.sort();

    for file in &files {
        let extension = file
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if matches!(extension.as_str(), "ndb" | "hdb" | "hsb" | "ldb" | "sdb") {
            let count = count_custom_signatures(file).unwrap_or(0);
            inventory.custom_signatures += count;
            inventory.custom_signature_files.push(CustomSignatureFile {
                file: file
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string())
                    .unwrap_or_else(|| file.display().to_string()),
                signatures: count,
            });
            continue;
        }
        if !matches!(extension.as_str(), "cvd" | "cld") {
            continue;
        }
        let component = match sigtool.filter(|path| path.is_file()) {
            Some(sigtool) => read_component(sigtool, file),
            None => SignatureComponent {
                file: file_name(file),
                version: None,
                signatures: None,
                build_time: None,
                verified: false,
                md5: None,
            },
        };
        inventory.official_signatures += component.signatures.unwrap_or(0);
        inventory.official_components.push(component);
    }

    if !inventory.sigtool_available {
        inventory.notes.push(
            "sigtool.exe est absent : les versions sont listées mais les nombres de signatures ne peuvent pas être vérifiés.".to_string(),
        );
    }
    if inventory.official_components.is_empty() {
        inventory
            .notes
            .push("Aucun fichier officiel .cvd/.cld n'est présent.".to_string());
    }
    inventory
}

fn read_component(sigtool: &Path, file: &Path) -> SignatureComponent {
    let mut command = std::process::Command::new(sigtool);
    command.arg("--info").arg(file);
    let mut component = SignatureComponent {
        file: file_name(file),
        version: None,
        signatures: None,
        build_time: None,
        verified: false,
        md5: None,
    };
    if let Ok(output) = execute_with_timeout(&mut command, Duration::from_secs(15)) {
        let text = format!(
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let parsed = parse_info(&text);
        component.version = parsed.version;
        component.signatures = parsed.signatures;
        component.build_time = parsed.build_time;
        component.verified = parsed.verified;
        component.md5 = parsed.md5;
    }
    component
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct ParsedInfo {
    pub version: Option<String>,
    pub signatures: Option<u64>,
    pub build_time: Option<String>,
    pub verified: bool,
    pub md5: Option<String>,
}

pub fn parse_info(text: &str) -> ParsedInfo {
    let mut parsed = ParsedInfo::default();
    for line in text.lines() {
        let line = line.trim();
        if line.eq_ignore_ascii_case("Verification OK.") {
            parsed.verified = true;
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = value.trim();
        match key.trim() {
            "Version" => {
                if !value.is_empty() && value != "0" {
                    parsed.version = Some(value.to_string());
                }
            }
            "Signatures" => {
                parsed.signatures = value.replace([',', ' '], "").parse::<u64>().ok();
            }
            "Build time" => parsed.build_time = Some(value.to_string()),
            "MD5" => parsed.md5 = Some(value.to_string()),
            _ => {}
        }
    }
    parsed
}

/// Number of active signature lines in a custom ClamAV database. Blank lines and
/// comments are ignored; the file is never loaded by CBS Shield itself.
fn count_custom_signatures(path: &Path) -> std::io::Result<u64> {
    use std::io::BufRead;
    let file = std::fs::File::open(path)?;
    let mut count = 0u64;
    for line in std::io::BufReader::new(file).lines() {
        let line = line?;
        let trimmed = line.trim();
        if !trimmed.is_empty() && !trimmed.starts_with('#') {
            count += 1;
        }
    }
    Ok(count)
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_real_sigtool_info_payload() {
        let text = "File: C:\\db\\daily.cvd\n\
                    Build time: 25 Oct 2026 06:24 +0000\n\
                    Version: 28164\n\
                    Signatures: 355788\n\
                    Functionality level: 90\n\
                    Builder: svc.clamav-publisher\n\
                    MD5: c80bc7dd272862181af0181b0f0f4423\n\
                    Digital signature: abc\n\
                    Verification OK.\n";
        let parsed = parse_info(text);
        assert_eq!(parsed.version.as_deref(), Some("28164"));
        assert_eq!(parsed.signatures, Some(355_788));
        assert!(parsed.verified);
        assert_eq!(
            parsed.md5.as_deref(),
            Some("c80bc7dd272862181af0181b0f0f4423")
        );
    }

    #[test]
    fn a_missing_sigtool_never_invents_counts() {
        let inventory = read_inventory(Some(Path::new(r"C:\does\not\exist")), None);
        assert_eq!(inventory.official_signatures, 0);
        assert!(inventory.official_components.is_empty());
        assert!(!inventory.sigtool_available);
    }

    #[test]
    fn counts_custom_signature_lines_ignoring_comments() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("test.ndb");
        std::fs::write(
            &file,
            b"# custom test fixture\nTest.Sig:0:*:41424344\n\nOther.Sig:0:*:45464748\n",
        )
        .unwrap();
        assert_eq!(count_custom_signatures(&file).unwrap(), 2);

        let inventory = read_inventory(Some(dir.path()), None);
        assert_eq!(inventory.custom_signatures, 2);
        assert_eq!(inventory.custom_signature_files.len(), 1);
        assert_eq!(inventory.official_signatures, 0);
    }
}
