use std::path::PathBuf;

/// Errors returned by the scan engine. Messages are intentionally explicit so
/// the UI can display an actionable French message without guessing.
#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("aucune cible de scan fournie")]
    NoTargets,

    #[error("cible introuvable : {0}")]
    TargetNotFound(String),

    #[error("cible invalide : {0}")]
    InvalidTarget(String),

    #[error("moteur ClamAV introuvable. Installez ClamAV ou configurez le chemin de clamscan.exe dans les paramètres")]
    EngineNotFound,

    #[error("signatures ClamAV absentes ou inutilisables. Lancez freshclam avant de scanner")]
    SignaturesMissing,

    #[error("échec du lancement de ClamAV : {0}")]
    Spawn(String),

    #[error("échec d'entrée/sortie : {0}")]
    Io(#[from] std::io::Error),

    #[error("chemin refusé : {0}")]
    ForbiddenPath(String),
}

/// Validate and canonicalize scan targets.
///
/// Canonicalization prevents duplicate entries (`C:\x` vs `C:\x\..\x`) and
/// guarantees the path exists before spawning a process. Paths inside
/// `forbidden_root` (the quarantine vault) are rejected so encrypted vault
/// blobs are never scanned as if they were user files.
pub fn prepare_targets(
    paths: &[PathBuf],
    forbidden_root: Option<&std::path::Path>,
) -> Result<Vec<PathBuf>, CoreError> {
    if paths.is_empty() {
        return Err(CoreError::NoTargets);
    }

    // Canonicalize the forbidden root the same way as each target. On
    // Windows `canonicalize` yields verbatim `\\?\C:\...` paths while the app
    // passes a prefix-stripped root, so a raw `starts_with` never matched and
    // the vault guard was silently disabled.
    let forbidden_root: Option<PathBuf> =
        forbidden_root.map(|root| root.canonicalize().unwrap_or_else(|_| root.to_path_buf()));

    let mut targets: Vec<PathBuf> = Vec::with_capacity(paths.len());
    for path in paths {
        if !path.exists() {
            return Err(CoreError::TargetNotFound(path.display().to_string()));
        }
        let canonical = path
            .canonicalize()
            .map_err(|err| CoreError::InvalidTarget(format!("{} ({err})", path.display())))?;

        if let Some(root) = forbidden_root.as_deref() {
            if canonical.starts_with(root) {
                return Err(CoreError::ForbiddenPath(format!(
                    "{} se trouve dans le coffre de quarantaine",
                    canonical.display()
                )));
            }
        }

        if !targets.contains(&canonical) {
            targets.push(canonical);
        }
    }
    Ok(targets)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn targets_inside_the_vault_are_refused_even_with_a_plain_root() {
        // Regression: the app passes a prefix-stripped root while targets are
        // canonicalized to `\\?\` form on Windows; the guard never matched.
        let dir = tempfile::tempdir().unwrap();
        let vault = dir.path().join("vault");
        std::fs::create_dir_all(&vault).unwrap();
        let blob = vault.join("item.cbsq");
        std::fs::write(&blob, b"x").unwrap();
        let plain_root = {
            let canonical = vault.canonicalize().unwrap();
            let text = canonical.to_string_lossy().to_string();
            PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(&text).to_string())
        };
        let result = prepare_targets(&[blob], Some(&plain_root));
        assert!(
            matches!(result, Err(CoreError::ForbiddenPath(_))),
            "{result:?}"
        );

        let outside = dir.path().join("user.txt");
        std::fs::write(&outside, b"y").unwrap();
        assert!(prepare_targets(&[outside], Some(&plain_root)).is_ok());
    }
}
