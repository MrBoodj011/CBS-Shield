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
    pub bundled_clamav_dir: Option<PathBuf>,
}

impl AppPaths {
    pub fn discover() -> io::Result<Self> {
        let data_dir = if let Some(value) = env::var_os(ENV_DATA_DIR) {
            PathBuf::from(value)
        } else {
            let local = env::var_os("LOCALAPPDATA").ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::NotFound,
                    "LOCALAPPDATA est introuvable ; impossible de choisir un dossier de données",
                )
            })?;
            PathBuf::from(local).join("Cybrense").join("CBS Shield")
        };

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
        Ok(())
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
