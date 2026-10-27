use std::env;
use std::io;
use std::path::PathBuf;

pub const ENV_DATA_DIR: &str = "CBS_SHIELD_DATA_DIR";

/// All on-disk locations used by CBS Shield. Everything lives under the current
/// user's local application data, so no administrator rights are required.
#[derive(Debug, Clone)]
pub struct AppPaths {
    pub data_dir: PathBuf,
    pub history_db: PathBuf,
    pub quarantine_dir: PathBuf,
    pub clamav_dir: PathBuf,
    pub signature_db: PathBuf,
    pub freshclam_conf: PathBuf,
    pub freshclam_log: PathBuf,
    pub firewall_backups: PathBuf,
    pub bundled_clamav_dir: Option<PathBuf>,
}

impl AppPaths {
    pub fn discover() -> io::Result<Self> {
        let data_dir = if let Some(value) = env::var_os(ENV_DATA_DIR) {
            // Audit fix: an override must resolve to an absolute, canonical
            // location. A relative value used to silently resolve against the
            // current working directory, which changes depending on how the
            // app was started (shortcut, service, manual run).
            match std::path::absolute(&value) {
                Ok(absolute) => absolute,
                Err(_) => PathBuf::from(value),
            }
        } else {
            let local = env::var_os("LOCALAPPDATA").ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::NotFound,
                    "LOCALAPPDATA est introuvable ; impossible de choisir un dossier de données",
                )
            })?;
            PathBuf::from(local).join("Cybrense").join("CBS Shield")
        };

        Self::from_data_dir(data_dir)
    }

    fn from_data_dir(data_dir: PathBuf) -> io::Result<Self> {
        let clamav_dir = data_dir.join("clamav");
        let bundled_clamav_dir = env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|parent| parent.join("clamav")))
            .filter(|dir| dir.is_dir());

        Ok(Self {
            history_db: data_dir.join("cbs-shield.db"),
            quarantine_dir: data_dir.join("quarantine"),
            signature_db: clamav_dir.join("database"),
            freshclam_conf: clamav_dir.join("freshclam.conf"),
            freshclam_log: clamav_dir.join("freshclam.log"),
            firewall_backups: data_dir.join("firewall-backups"),
            clamav_dir,
            bundled_clamav_dir,
            data_dir,
        })
    }

    pub fn ensure(&self) -> io::Result<()> {
        std::fs::create_dir_all(&self.data_dir)?;
        std::fs::create_dir_all(&self.clamav_dir)?;
        std::fs::create_dir_all(&self.signature_db)?;
        std::fs::create_dir_all(&self.quarantine_dir)?;
        std::fs::create_dir_all(&self.firewall_backups)?;
        Ok(())
    }

    /// Audit fix: canonicalize the data directory once, at startup, so every
    /// prefix comparison (`starts_with(data_dir)`) in quarantine and restore
    /// validation compares like with like. Without this, a drive letter
    /// casing difference (`c:\` vs `C:\`), an 8.3 short name (`PROGRA~1`) or
    /// a trailing junction could make `contains` checks silently fail and
    /// allow a protected location to slip through.
    pub fn canonicalized(self) -> io::Result<Self> {
        self.ensure()?;
        match self.data_dir.canonicalize() {
            Ok(canonical) => {
                // Strip the Windows verbatim prefix for user-facing paths.
                let text = canonical.as_os_str().to_string_lossy();
                let stripped = text.strip_prefix(r"\\?\").unwrap_or(&text);
                let canonical = PathBuf::from(stripped.to_string());
                if canonical != self.data_dir {
                    Self::from_data_dir(canonical)
                } else {
                    Ok(self)
                }
            }
            Err(err) => Err(err),
        }
    }

    /// Additional places where a portable/app-local ClamAV build can live.
    pub fn engine_search_dirs(&self) -> Vec<PathBuf> {
        let mut dirs = vec![self.clamav_dir.clone()];
        if let Some(dir) = &self.bundled_clamav_dir {
            if !dirs.contains(dir) {
                dirs.push(dir.clone());
            }
        }
        dirs
    }
}
