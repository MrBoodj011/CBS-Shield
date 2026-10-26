//! Documented scan profiles and a bounded file indexer used only to make
//! progress measurable.
//!
//! The index is **not** a security decision: ClamAV receives the directories
//! themselves and applies its own traversal rules. The indexer exists so the UI
//! can show a real `files scanned / files indexed` ratio when a complete count
//! could be obtained within a small budget. When the budget is exceeded the
//! count is reported as unavailable instead of inventing a percentage.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::model::ScanProfile;

/// Quick scan locations. Order is stable for the UI and the report.
pub fn quick_targets() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(profile) = std::env::var_os("USERPROFILE") {
        let profile = PathBuf::from(profile);
        candidates.push(profile.join("Downloads"));
        candidates.push(profile.join("Desktop"));
        candidates.push(profile.join("Documents"));
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let local = PathBuf::from(local);
        candidates.push(local.join("Temp"));
        candidates.push(local.join(r"Microsoft\Windows\Start Menu\Programs\Startup"));
    }
    if let Some(program_data) = std::env::var_os("ProgramData") {
        candidates.push(
            PathBuf::from(program_data).join(r"Microsoft\Windows\Start Menu\Programs\StartUp"),
        );
    }

    let mut targets: Vec<PathBuf> = Vec::new();
    for candidate in candidates {
        if candidate.is_dir()
            && !targets
                .iter()
                .any(|existing| path_key(existing) == path_key(&candidate))
        {
            targets.push(candidate);
        }
    }
    if targets.is_empty() {
        if let Some(profile) = std::env::var_os("USERPROFILE") {
            let profile = PathBuf::from(profile);
            if profile.is_dir() {
                targets.push(profile);
            }
        }
    }
    targets
}

/// Full scan roots: every **fixed** local drive (network, removable and optical
/// drives are excluded). Windows-only; an empty result is reported honestly.
#[cfg(windows)]
pub fn full_scan_roots() -> Vec<PathBuf> {
    use windows_sys::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDrives};
    use windows_sys::Win32::System::WindowsProgramming::DRIVE_FIXED;

    let mask = unsafe { GetLogicalDrives() };
    let mut roots = Vec::new();
    for index in 0..26u32 {
        if mask & (1 << index) == 0 {
            continue;
        }
        let letter = (b'A' + index as u8) as char;
        let root = format!("{letter}:\\");
        let wide: Vec<u16> = root.encode_utf16().chain(std::iter::once(0)).collect();
        let drive_type = unsafe { GetDriveTypeW(wide.as_ptr()) };
        if drive_type == DRIVE_FIXED {
            roots.push(PathBuf::from(root));
        }
    }
    roots
}

#[cfg(not(windows))]
pub fn full_scan_roots() -> Vec<PathBuf> {
    vec![PathBuf::from("/")]
}

/// Default exclusions for a Full scan. They are applied by both the indexer and
/// ClamAV so that the report reflects the real coverage.
///
/// - the CBS Shield data directory (quarantine + signature database + logs);
/// - the Windows component store (`WinSxS`, hard-linked system payloads);
/// - the protected registry hive directory (`System32\config`);
/// - per-drive recycle bin and `System Volume Information`.
pub fn default_exclusions(data_dir: &Path) -> Vec<PathBuf> {
    let mut excluded = vec![data_dir.to_path_buf()];
    let mut roots = full_scan_roots();
    if let Some(system_root) = std::env::var_os("SystemRoot") {
        roots.push(PathBuf::from(system_root));
    }
    for root in roots {
        for suffix in [
            r"WinSxS",
            r"System32\config",
            r"$Recycle.Bin",
            r"System Volume Information",
        ] {
            let candidate = root.join(suffix);
            if !excluded
                .iter()
                .any(|existing| path_key(existing) == path_key(&candidate))
            {
                excluded.push(candidate);
            }
        }
    }
    excluded
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedTargets {
    pub profile: String,
    pub targets: Vec<String>,
    pub excluded: Vec<String>,
}

pub fn resolve_profile(profile: ScanProfile, data_dir: &Path) -> ResolvedTargets {
    let (targets, excluded) = match profile {
        ScanProfile::Quick => (quick_targets(), default_exclusions(data_dir)),
        ScanProfile::Full => (full_scan_roots(), default_exclusions(data_dir)),
        ScanProfile::Custom => (Vec::new(), default_exclusions(data_dir)),
    };
    ResolvedTargets {
        profile: profile.as_str().to_string(),
        targets: targets
            .iter()
            .map(|path| path.display().to_string())
            .collect(),
        excluded: excluded
            .iter()
            .map(|path| path.display().to_string())
            .collect(),
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexResult {
    /// Files counted before the budget/cap was reached.
    pub total_files: u64,
    /// True when the walk stopped early: the count is a lower bound only and
    /// must not be used as a progress denominator.
    pub truncated: bool,
    pub elapsed_ms: u64,
    pub skipped_directories: u64,
}

/// Count regular files under `targets`, stopping at `max_files` or after
/// `budget`. Reparse points/symlinks are never followed.
pub fn index_files(
    targets: &[PathBuf],
    excluded: &[PathBuf],
    max_files: u64,
    budget: Duration,
) -> IndexResult {
    let started = Instant::now();
    let mut result = IndexResult::default();
    let mut stack: Vec<PathBuf> = targets.to_vec();

    while let Some(path) = stack.pop() {
        if result.total_files >= max_files || started.elapsed() >= budget {
            result.truncated = true;
            break;
        }
        if is_excluded(&path, excluded) {
            result.skipped_directories += 1;
            continue;
        }
        let extended = extended_path(&path);
        let Ok(metadata) = std::fs::symlink_metadata(&extended) else {
            result.skipped_directories += 1;
            continue;
        };
        if metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
            continue;
        }
        if metadata.is_dir() {
            match std::fs::read_dir(&extended) {
                Ok(entries) => {
                    for entry in entries.flatten() {
                        stack.push(path.join(entry.file_name()));
                    }
                }
                Err(_) => result.skipped_directories += 1,
            }
        } else if metadata.is_file() {
            result.total_files += 1;
        }
    }

    result.elapsed_ms = started.elapsed().as_millis() as u64;
    result
}

/// Prefix a long Windows path with `\\?\` so `std::fs` can traverse paths over
/// the legacy MAX_PATH limit. UNC paths use `\\?\UNC\`.
pub fn extended_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let text = path.as_os_str().to_string_lossy();
        if text.starts_with(r"\\?\") || text.chars().count() < 240 {
            return path.to_path_buf();
        }
        if let Some(rest) = text.strip_prefix(r"\\") {
            return PathBuf::from(format!(r"\\?\UNC\{rest}"));
        }
        if text.as_bytes().get(1) == Some(&b':') {
            return PathBuf::from(format!(r"\\?\{text}"));
        }
    }
    path.to_path_buf()
}

pub fn is_excluded(path: &Path, excluded: &[PathBuf]) -> bool {
    let candidate = path_key(path);
    excluded.iter().any(|excluded| {
        let excluded = path_key(excluded);
        candidate == excluded || candidate.starts_with(&(excluded.clone() + "\\"))
    })
}

fn path_key(path: &Path) -> String {
    let text = path.display().to_string();
    let text = text.strip_prefix(r"\\?\").unwrap_or(&text);
    let normalized = text.replace('/', "\\");
    let normalized = normalized.trim_end_matches('\\');
    if cfg!(windows) {
        normalized.to_lowercase()
    } else {
        normalized.to_string()
    }
}

#[cfg(windows)]
fn is_reparse_point(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_metadata: &std::fs::Metadata) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quick_targets_are_existing_directories() {
        let targets = quick_targets();
        for target in &targets {
            assert!(
                target.is_dir(),
                "quick target must exist: {}",
                target.display()
            );
        }
    }

    #[test]
    fn excludes_paths_case_insensitively_on_windows() {
        let excluded = vec![PathBuf::from(r"C:\Users\Test\AppData\Local\CBS")];
        assert!(is_excluded(
            Path::new(r"c:\users\test\appdata\local\cbs\quarantine\x.bin"),
            &excluded
        ));
        assert!(!is_excluded(
            Path::new(r"C:\Users\Test\AppData\Local\CBSOther\x.bin"),
            &excluded
        ));
    }

    #[test]
    fn index_counts_files_and_skips_excluded_directories() {
        let dir = tempfile::tempdir().unwrap();
        let included = dir.path().join("included");
        let excluded = dir.path().join("excluded");
        std::fs::create_dir_all(included.join("nested")).unwrap();
        std::fs::create_dir_all(&excluded).unwrap();
        std::fs::write(included.join("a.txt"), b"a").unwrap();
        std::fs::write(included.join("nested").join("b.txt"), b"b").unwrap();
        std::fs::write(excluded.join("c.txt"), b"c").unwrap();

        let result = index_files(
            &[dir.path().to_path_buf()],
            &[excluded],
            1_000,
            Duration::from_secs(5),
        );
        assert_eq!(result.total_files, 2);
        assert!(!result.truncated);
    }

    #[test]
    fn index_marks_truncated_when_the_file_cap_is_reached() {
        let dir = tempfile::tempdir().unwrap();
        for index in 0..5 {
            std::fs::write(dir.path().join(format!("f{index}.txt")), b"x").unwrap();
        }
        let result = index_files(&[dir.path().to_path_buf()], &[], 2, Duration::from_secs(5));
        assert!(result.truncated);
        assert_eq!(result.total_files, 2);
    }

    #[cfg(windows)]
    #[test]
    fn full_scan_roots_are_fixed_drives() {
        let roots = full_scan_roots();
        assert!(
            !roots.is_empty(),
            "at least the system drive must be reported"
        );
        assert!(roots.iter().all(|root| root.is_dir()));
    }

    #[cfg(windows)]
    #[test]
    fn long_paths_receive_the_verbatim_prefix() {
        let long = PathBuf::from(format!(r"C:\{}\file.txt", "a".repeat(300)));
        let extended = extended_path(&long);
        assert!(extended.display().to_string().starts_with(r"\\?\C:\"));
    }

    #[test]
    fn default_exclusions_include_the_application_data_directory() {
        let exclusions = default_exclusions(Path::new(r"C:\Users\x\AppData\Local\CBS"));
        assert!(exclusions
            .iter()
            .any(|path| path.ends_with("CBS") || path.ends_with("CBS\\")));
    }
}
