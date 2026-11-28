//! CBS Proactive Monitor (Sprint 9).
//!
//! This is **not** real-time antivirus protection, not a kernel driver and not
//! an execution blocker. It watches user-chosen directories, records new or
//! modified files in a bounded review queue, and lets the user hand that queue
//! to the existing manual ClamAV workflow. System-wide enforcement is always
//! reported `false`.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, UNIX_EPOCH};

use chrono::Utc;
use serde::{Deserialize, Serialize};

pub const MAX_DIRECTORIES: usize = 10;
pub const MAX_DEPTH: u32 = 8;
pub const MAX_TRACKED: usize = 5_000;
pub const MAX_EVENTS: usize = 120;
pub const MAX_QUEUE: usize = 80;

#[derive(Debug, thiserror::Error)]
pub enum MonitorError {
    #[error("configuration invalide : {0}")]
    InvalidConfig(String),
    #[error("{0}")]
    Internal(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EventKind {
    Created,
    Modified,
    Rejected,
}

impl EventKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Created => "created",
            Self::Modified => "modified",
            Self::Rejected => "rejected",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorEvent {
    pub id: String,
    pub occurred_at: String,
    pub kind: EventKind,
    pub path: String,
    pub detail: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorConfig {
    pub cycle_seconds: u64,
    pub max_files_per_cycle: usize,
    pub max_file_size_mb: u64,
    pub max_depth: u32,
}

/// Accepted bounds for user-supplied settings. Values outside these ranges
/// used to make stop/set-directories wait for hours (`cycle_seconds`) or
/// overflow the size computation (`max_file_size_mb`).
pub const MAX_CYCLE_SECONDS: u64 = 3_600;
pub const MAX_FILE_SIZE_MB: u64 = 4_096;

impl MonitorConfig {
    /// Reject out-of-range settings coming from the UI.
    pub fn validated(self) -> Result<Self, MonitorError> {
        if !(1..=MAX_CYCLE_SECONDS).contains(&self.cycle_seconds) {
            return Err(MonitorError::InvalidConfig(format!(
                "intervalle de cycle invalide (1 à {MAX_CYCLE_SECONDS} s)"
            )));
        }
        if !(1..=MAX_TRACKED).contains(&self.max_files_per_cycle) {
            return Err(MonitorError::InvalidConfig(format!(
                "nombre de fichiers par cycle invalide (1 à {MAX_TRACKED})"
            )));
        }
        if !(1..=MAX_FILE_SIZE_MB).contains(&self.max_file_size_mb) {
            return Err(MonitorError::InvalidConfig(format!(
                "taille maximale invalide (1 à {MAX_FILE_SIZE_MB} Mo)"
            )));
        }
        if self.max_depth > MAX_DEPTH {
            return Err(MonitorError::InvalidConfig(format!(
                "profondeur invalide (0 à {MAX_DEPTH})"
            )));
        }
        Ok(self)
    }

    /// Clamp a persisted (possibly hand-edited) configuration into range.
    fn clamped(self) -> Self {
        Self {
            cycle_seconds: self.cycle_seconds.clamp(1, MAX_CYCLE_SECONDS),
            max_files_per_cycle: self.max_files_per_cycle.clamp(1, MAX_TRACKED),
            max_file_size_mb: self.max_file_size_mb.clamp(1, MAX_FILE_SIZE_MB),
            max_depth: self.max_depth.min(MAX_DEPTH),
        }
    }

    fn max_file_bytes(&self) -> u64 {
        self.max_file_size_mb.saturating_mul(1_048_576)
    }
}

impl Default for MonitorConfig {
    fn default() -> Self {
        Self {
            cycle_seconds: 3,
            max_files_per_cycle: 250,
            max_file_size_mb: 16,
            max_depth: 4,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorStatus {
    pub running: bool,
    pub paused: bool,
    pub auto_watch: bool,
    pub config: MonitorConfig,
    pub directories: Vec<String>,
    pub tracked_files: usize,
    pub queue_count: usize,
    pub events: Vec<MonitorEvent>,
    pub last_cycle_at: Option<String>,
    pub last_error: Option<String>,
    pub active_enforcement: bool,
    pub not_real_time: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedState {
    config: MonitorConfig,
    directories: Vec<String>,
    auto_watch: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct FileStamp {
    size: u64,
    modified: u64,
}

struct Runtime {
    persisted: PersistedState,
    cycle_count: u64,
    last_cycle: Option<String>,
    last_error: Option<String>,
    tracking: BTreeMap<PathBuf, FileStamp>,
    queue: Vec<PathBuf>,
    events: Vec<MonitorEvent>,
    running: bool,
    paused: bool,
    /// False until the first complete cycle over the current directory set has
    /// been recorded. The first pass establishes the baseline and must NOT
    /// push every pre-existing file into the review queue.
    seeded: bool,
}

impl Default for Runtime {
    fn default() -> Self {
        Self {
            persisted: PersistedState {
                config: MonitorConfig::default(),
                directories: Vec::new(),
                auto_watch: false,
            },
            cycle_count: 0,
            last_cycle: None,
            last_error: None,
            tracking: BTreeMap::new(),
            queue: Vec::new(),
            events: Vec::new(),
            running: false,
            paused: false,
            seeded: false,
        }
    }
}

impl Runtime {
    fn status(&self) -> MonitorStatus {
        MonitorStatus {
            running: self.running,
            paused: self.paused,
            auto_watch: self.persisted.auto_watch,
            config: self.persisted.config,
            directories: self.persisted.directories.clone(),
            tracked_files: self.tracking.len(),
            queue_count: self.queue.len(),
            events: self.events.clone(),
            last_cycle_at: self.last_cycle.clone(),
            last_error: self.last_error.clone(),
            active_enforcement: false,
            not_real_time: true,
        }
    }
}

impl Runtime {
    fn push_event(&mut self, kind: EventKind, path: &Path, detail: String) {
        let id = format!("p{}e{}", self.cycle_count, self.events.len());
        let event = MonitorEvent {
            id,
            occurred_at: Utc::now().to_rfc3339(),
            kind,
            path: path.display().to_string(),
            detail,
        };
        self.events.insert(0, event);
        self.events.truncate(MAX_EVENTS);
    }
}

fn stamp(metadata: &fs::Metadata) -> Option<FileStamp> {
    let size = metadata.len();
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)?;
    Some(FileStamp { size, modified })
}

fn ignore(path: &Path) -> bool {
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    matches!(
        name.as_str(),
        "cbs-shield.db"
            | "cbs-shield.db-wal"
            | "cbs-shield.db-shm"
            | "proactive.json"
            | "webguard.json"
    )
}

/// Generate the periodic snapshot of the watched directory.
fn walk(
    dir: &Path,
    depth: u32,
    max_depth: u32,
    files: &mut BTreeMap<PathBuf, FileStamp>,
    budget: &mut usize,
) {
    if depth > max_depth || *budget == 0 {
        return;
    }
    for entry in match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    } {
        if *budget == 0 {
            return;
        }
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        if ignore(&path) {
            continue;
        }
        if entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
            walk(&path, depth + 1, max_depth, files, budget);
        } else if path.is_file() {
            if let Ok(metadata) = entry.metadata() {
                if let Some(value) = stamp(&metadata) {
                    files.insert(path, value);
                    *budget -= 1;
                }
            }
        }
    }
}

fn persist(path: &Path, state: &PersistedState) -> Result<(), MonitorError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| MonitorError::InvalidConfig(format!("dossier de config : {err}")))?;
    }
    let json = serde_json::to_vec_pretty(state)
        .map_err(|err| MonitorError::Internal(format!("sérialisation : {err}")))?;
    let temp = path.with_extension("tmp");
    fs::write(&temp, json)
        .map_err(|err| MonitorError::Internal(format!("écriture temporaire : {err}")))?;
    fs::rename(temp, path).map_err(|err| MonitorError::Internal(format!("dépôt config : {err}")))
}

/// Polling watcher. The design is deliberately simple: bounded queue, explicit
/// pause, safe on locked files, no system-wide claim.
pub struct ProactiveMonitor {
    runtime: Arc<Mutex<Runtime>>,
    stop_flag: Arc<AtomicBool>,
    worker: Mutex<Option<JoinHandle<()>>>,
    config_path: PathBuf,
}

fn sanitize(directories: Vec<String>) -> Result<Vec<PathBuf>, MonitorError> {
    if directories.len() > MAX_DIRECTORIES {
        return Err(MonitorError::InvalidConfig(format!(
            "Maximum de {MAX_DIRECTORIES} dossiers surveillés."
        )));
    }
    let mut unique: Vec<PathBuf> = Vec::new();
    for directory in directories {
        let raw = directory.trim();
        if raw.is_empty() {
            continue;
        }
        let path = PathBuf::from(raw);
        if !path.is_dir() {
            return Err(MonitorError::InvalidConfig(format!(
                "Dossier inexistant : {}",
                path.display()
            )));
        }
        let canonical = path
            .canonicalize()
            .map_err(|err| MonitorError::Internal(format!("accès au dossier : {err}")))?;
        if unique.contains(&canonical) {
            continue;
        }
        unique.push(canonical);
    }
    Ok(unique)
}

/// Filesystem walk for one cycle. Runs **without** the runtime lock so that
/// snapshot/pause/stop commands never wait for a slow directory scan; the
/// number of entries visited is bounded by the per-cycle file budget.
fn walk_dirs(dirs: &[PathBuf], config: &MonitorConfig) -> Vec<BTreeMap<PathBuf, FileStamp>> {
    // One extra entry lets the apply step detect (and report) a partial cycle.
    let mut budget = config.max_files_per_cycle.saturating_add(1);
    dirs.iter()
        .map(|dir| {
            let mut files = BTreeMap::new();
            walk(dir, 0, config.max_depth, &mut files, &mut budget);
            files
        })
        .collect()
}

#[cfg(test)]
fn cycle_impl(dirs: &[PathBuf], config: &MonitorConfig, runtime: &mut Runtime) {
    let walked = walk_dirs(dirs, config);
    apply_cycle(walked, config, runtime);
}

fn apply_cycle(
    walked: Vec<BTreeMap<PathBuf, FileStamp>>,
    config: &MonitorConfig,
    runtime: &mut Runtime,
) {
    runtime.cycle_count = runtime.cycle_count.saturating_add(1);
    let seeding = !runtime.seeded;
    let mut processed = 0usize;
    'outer: for files in walked {
        for (path, current) in files.into_iter() {
            if processed >= config.max_files_per_cycle {
                runtime.last_error =
                    Some("Limite de fichiers par cycle atteinte ; cycle partiel.".into());
                break 'outer;
            }
            if runtime.tracking.len() >= MAX_TRACKED {
                runtime.last_error =
                    Some("Maximum de fichiers surveillés atteint ; cycle partiel.".into());
                break 'outer;
            }
            processed += 1;
            if current.size > config.max_file_bytes() {
                runtime.push_event(
                    EventKind::Rejected,
                    &path,
                    format!("taille {} Mo", current.size / 1_048_576),
                );
                runtime.tracking.insert(path, current);
                continue;
            }
            match runtime.tracking.get(&path).copied() {
                None => {
                    // Baseline pass: record without emitting events so the
                    // initial content of the directory is not reported as
                    // "created" activity nor queued for review.
                    if !seeding {
                        runtime.push_event(EventKind::Created, &path, String::new());
                        enqueue(runtime, path.clone());
                    }
                    runtime.tracking.insert(path, current);
                }
                Some(previous) if previous != current => {
                    if !seeding {
                        runtime.push_event(EventKind::Modified, &path, String::new());
                        enqueue(runtime, path.clone());
                    }
                    runtime.tracking.insert(path, current);
                }
                Some(_) => {}
            }
        }
    }
    runtime.seeded = true;
    runtime.last_cycle = Some(Utc::now().to_rfc3339());
}

/// Granularity of the worker's sleep: a stop request is honoured within this
/// delay instead of after a full (up to one hour) cycle interval.
const STOP_POLL: Duration = Duration::from_millis(200);

fn spawn_worker(runtime: Arc<Mutex<Runtime>>, stop_flag: Arc<AtomicBool>) -> JoinHandle<()> {
    thread::spawn(move || {
        while !stop_flag.load(Ordering::SeqCst) {
            let (directories, config, paused) = {
                let state = runtime.lock().unwrap_or_else(|p| p.into_inner());
                (
                    state.persisted.directories.clone(),
                    state.persisted.config,
                    state.paused,
                )
            };
            if !directories.is_empty() && !paused {
                let paths: Vec<PathBuf> = directories.iter().map(PathBuf::from).collect();
                let walked = walk_dirs(&paths, &config);
                if stop_flag.load(Ordering::SeqCst) {
                    break;
                }
                let mut state = runtime.lock().unwrap_or_else(|p| p.into_inner());
                if !state.paused {
                    apply_cycle(walked, &config, &mut state);
                }
            }
            let deadline = std::time::Instant::now() + Duration::from_secs(config.cycle_seconds);
            while !stop_flag.load(Ordering::SeqCst) && std::time::Instant::now() < deadline {
                thread::sleep(STOP_POLL);
            }
        }
    })
}

/// Bounded queue with explicit backpressure: when the review queue is full the
/// file change is still recorded as an event, but the queue reports the
/// overload instead of growing without limit.
fn enqueue(runtime: &mut Runtime, path: PathBuf) {
    if runtime.queue.len() >= MAX_QUEUE {
        runtime.last_error = Some(
            "File d'analyse pleine : modifications non ajoutées tant que la file n'est pas vidée."
                .into(),
        );
        return;
    }
    if !runtime.queue.contains(&path) {
        runtime.queue.push(path);
    }
}

impl ProactiveMonitor {
    pub fn load(config_path: &Path) -> Self {
        let persisted = fs::read(config_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<PersistedState>(&bytes).ok())
            .unwrap_or_else(|| PersistedState {
                config: MonitorConfig::default(),
                directories: Vec::new(),
                auto_watch: false,
            });

        let mut persisted = persisted;
        persisted.config = persisted.config.clamped();
        let runtime = Runtime {
            persisted,
            ..Runtime::default()
        };

        let config_path = config_path.to_path_buf();
        let runtime = Arc::new(Mutex::new(runtime));
        let stop_flag = Arc::new(AtomicBool::new(false));

        let worker = {
            let persisted = {
                let runtime = runtime.lock().unwrap_or_else(|p| p.into_inner());
                runtime.persisted.clone()
            };
            if persisted.auto_watch && !persisted.directories.is_empty() {
                // The worker below really is a running monitor. Reflect that in
                // the status immediately, otherwise the UI reports "stopped"
                // while cycles keep executing after a restart (Sprint 9.6).
                {
                    let mut state = runtime
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    state.running = true;
                    state.paused = false;
                }
                let runtime = Arc::clone(&runtime);
                let stop_flag = Arc::clone(&stop_flag);
                Some(spawn_worker(runtime, stop_flag))
            } else {
                None
            }
        };

        Self {
            runtime,
            stop_flag,
            worker: Mutex::new(worker),
            config_path,
        }
    }

    pub fn snapshot(&self) -> Result<MonitorStatus, MonitorError> {
        let state = self
            .runtime
            .lock()
            .map_err(|err| MonitorError::Internal(err.to_string()))?;
        Ok(state.status())
    }

    pub fn set_auto_watch(&self, enabled: bool) -> Result<MonitorStatus, MonitorError> {
        {
            let mut state = self
                .runtime
                .lock()
                .map_err(|err| MonitorError::Internal(err.to_string()))?;
            if enabled && state.persisted.directories.is_empty() {
                return Err(MonitorError::InvalidConfig(
                    "Aucun dossier surveillé : ajoutez d'abord un dossier.".into(),
                ));
            }
            state.persisted.auto_watch = enabled;
            // `auto_watch` only decides whether the monitor auto-starts the
            // next time the application launches. The current session is
            // controlled explicitly via start/stop.
            persist(&self.config_path, &state.persisted)?;
        }
        self.snapshot()
    }

    /// Stops and joins the worker thread if one is alive. Safe to call when no
    /// worker was ever spawned.
    fn halt_worker(&self) {
        self.stop_flag.store(true, Ordering::SeqCst);
        if let Ok(mut worker) = self.worker.lock() {
            if let Some(handle) = worker.take() {
                let _ = handle.join();
            }
        }
    }

    pub fn set_directories(&self, directories: Vec<String>) -> Result<MonitorStatus, MonitorError> {
        let paths = sanitize(directories)?;
        let directories: Vec<String> = paths
            .iter()
            .map(|path| path.display().to_string())
            .collect();
        self.halt_worker();
        {
            let mut state = self
                .runtime
                .lock()
                .map_err(|err| MonitorError::Internal(err.to_string()))?;
            state.persisted.directories = directories;
            // Changing the watched set always stops the monitor and invalidates
            // the baseline: the user must explicitly restart it.
            state.running = false;
            state.paused = false;
            state.seeded = false;
            state.tracking.clear();
            state.queue.clear();
            state.last_error = None;
            persist(&self.config_path, &state.persisted)?;
        }
        self.snapshot()
    }

    pub fn set_config(&self, config: MonitorConfig) -> Result<MonitorStatus, MonitorError> {
        let config = config.validated()?;
        {
            let mut state = self
                .runtime
                .lock()
                .map_err(|err| MonitorError::Internal(err.to_string()))?;
            state.persisted.config = config;
            persist(&self.config_path, &state.persisted)?;
        }
        self.snapshot()
    }

    pub fn start(&self) -> Result<MonitorStatus, MonitorError> {
        {
            let mut state = self
                .runtime
                .lock()
                .map_err(|err| MonitorError::Internal(err.to_string()))?;
            if state.persisted.directories.is_empty() {
                return Err(MonitorError::InvalidConfig(
                    "Aucun dossier surveillé : ajoutez d'abord un dossier.".into(),
                ));
            }
            // (Re)seed the baseline on every start so restarting the monitor
            // after a pause does not replay the whole directory as activity.
            state.seeded = false;
            state.tracking.clear();
            state.queue.clear();
            state.last_error = None;
            state.running = true;
            state.paused = false;
        }
        self.stop_flag.store(false, Ordering::SeqCst);
        {
            let mut worker_lock = self
                .worker
                .lock()
                .map_err(|err| MonitorError::Internal(err.to_string()))?;
            if worker_lock.is_none() {
                let runtime = Arc::clone(&self.runtime);
                let stop_flag = Arc::clone(&self.stop_flag);
                *worker_lock = Some(spawn_worker(runtime, stop_flag));
            }
        }
        self.snapshot()
    }

    pub fn pause(&self) -> Result<MonitorStatus, MonitorError> {
        {
            let mut state = self
                .runtime
                .lock()
                .map_err(|err| MonitorError::Internal(err.to_string()))?;
            state.paused = true;
        }
        self.snapshot()
    }

    pub fn resume(&self) -> Result<MonitorStatus, MonitorError> {
        {
            let mut state = self
                .runtime
                .lock()
                .map_err(|err| MonitorError::Internal(err.to_string()))?;
            state.paused = false;
        }
        self.snapshot()
    }

    pub fn stop(&self) -> Result<MonitorStatus, MonitorError> {
        self.halt_worker();
        {
            let mut state = self
                .runtime
                .lock()
                .map_err(|err| MonitorError::Internal(err.to_string()))?;
            state.running = false;
        }
        self.snapshot()
    }

    pub fn drain_queue(&self) -> Result<Vec<PathBuf>, MonitorError> {
        let mut state = self
            .runtime
            .lock()
            .map_err(|err| MonitorError::Internal(err.to_string()))?;
        Ok(std::mem::take(&mut state.queue))
    }

    /// Put paths back at the front of the review queue (used when a drained
    /// batch could not be scanned, e.g. the worker was replaced or the scan
    /// slot was busy). Bounded by the queue size like regular enqueues.
    pub fn requeue(&self, paths: Vec<PathBuf>) -> Result<(), MonitorError> {
        let mut state = self
            .runtime
            .lock()
            .map_err(|err| MonitorError::Internal(err.to_string()))?;
        let mut merged: Vec<PathBuf> = Vec::with_capacity(paths.len() + state.queue.len());
        for path in paths.into_iter().chain(std::mem::take(&mut state.queue)) {
            if merged.len() >= MAX_QUEUE {
                break;
            }
            if !merged.contains(&path) {
                merged.push(path);
            }
        }
        state.queue = merged;
        Ok(())
    }

    pub fn clear(&self) -> Result<MonitorStatus, MonitorError> {
        {
            let mut state = self
                .runtime
                .lock()
                .map_err(|err| MonitorError::Internal(err.to_string()))?;
            state.tracking.clear();
            state.queue.clear();
            state.events.clear();
            state.last_error = None;
            // The next cycle re-establishes a silent baseline instead of
            // replaying the whole tree as "created" activity.
            state.seeded = false;
        }
        self.snapshot()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config_in(dir: &Path) -> PathBuf {
        dir.join("proactive.json")
    }

    fn runtime_with(config: &MonitorConfig, dirs: &[PathBuf]) -> Runtime {
        let mut runtime = Runtime::default();
        runtime.persisted.config = *config;
        runtime.persisted.directories = dirs.iter().map(|p| p.display().to_string()).collect();
        runtime
    }

    #[test]
    fn out_of_range_config_is_rejected() {
        let temp = tempfile::tempdir().unwrap();
        let monitor = ProactiveMonitor::load(&config_in(temp.path()));
        for bad in [
            MonitorConfig {
                cycle_seconds: u64::MAX,
                ..MonitorConfig::default()
            },
            MonitorConfig {
                cycle_seconds: 0,
                ..MonitorConfig::default()
            },
            MonitorConfig {
                max_file_size_mb: u64::MAX,
                ..MonitorConfig::default()
            },
            MonitorConfig {
                max_depth: MAX_DEPTH + 1,
                ..MonitorConfig::default()
            },
            MonitorConfig {
                max_files_per_cycle: 0,
                ..MonitorConfig::default()
            },
        ] {
            assert!(monitor.set_config(bad).is_err(), "{bad:?}");
        }
        assert!(monitor.set_config(MonitorConfig::default()).is_ok());
    }

    #[test]
    fn hand_edited_config_is_clamped_on_load() {
        let temp = tempfile::tempdir().unwrap();
        let path = config_in(temp.path());
        fs::write(
            &path,
            r#"{"config":{"cycleSeconds":99999999,"maxFilesPerCycle":250,"maxFileSizeMb":18446744073709551615,"maxDepth":99},"directories":[],"autoWatch":false}"#,
        )
        .unwrap();
        let status = ProactiveMonitor::load(&path).snapshot().unwrap();
        assert_eq!(status.config.cycle_seconds, MAX_CYCLE_SECONDS);
        assert_eq!(status.config.max_file_size_mb, MAX_FILE_SIZE_MB);
        assert_eq!(status.config.max_depth, MAX_DEPTH);
    }

    #[test]
    fn requeue_puts_paths_back_first_without_duplicates() {
        let temp = tempfile::tempdir().unwrap();
        let monitor = ProactiveMonitor::load(&config_in(temp.path()));
        monitor
            .requeue(vec![PathBuf::from("a"), PathBuf::from("b")])
            .unwrap();
        monitor
            .requeue(vec![PathBuf::from("c"), PathBuf::from("a")])
            .unwrap();
        assert_eq!(
            monitor.drain_queue().unwrap(),
            vec![PathBuf::from("c"), PathBuf::from("a"), PathBuf::from("b")]
        );
    }

    #[test]
    fn sanitize_rejects_missing_dir() {
        let error = sanitize(vec!["C:\\__cbs_missing_dir__".to_string()]).unwrap_err();
        assert!(matches!(error, MonitorError::InvalidConfig(_)));
    }

    #[test]
    fn sanitize_deduplicates_and_canonicalizes() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().to_path_buf();
        let twice = sanitize(vec![path.display().to_string(), path.display().to_string()]).unwrap();
        assert_eq!(twice.len(), 1);
    }

    #[test]
    fn baseline_pass_does_not_queue_existing_files() {
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("existing.txt");
        fs::write(&file, b"hello").unwrap();
        let dirs = vec![temp.path().to_path_buf()];
        let config = MonitorConfig::default();
        let mut runtime = runtime_with(&config, &dirs);

        cycle_impl(&dirs, &config, &mut runtime);
        assert!(runtime.events.is_empty(), "baseline must be silent");
        assert!(runtime.queue.is_empty(), "baseline must not enqueue");
        assert_eq!(runtime.tracking.len(), 1);

        // Second cycle without changes: still nothing.
        cycle_impl(&dirs, &config, &mut runtime);
        assert!(runtime.events.is_empty());
        assert!(runtime.queue.is_empty());

        // A real modification is detected exactly once.
        fs::write(&file, b"much longer different content").unwrap();
        cycle_impl(&dirs, &config, &mut runtime);
        assert_eq!(runtime.queue.len(), 1);
        assert_eq!(runtime.events.len(), 1);
        assert_eq!(runtime.events[0].kind, EventKind::Modified);

        // Unchanged files are never rescanned or re-queued.
        cycle_impl(&dirs, &config, &mut runtime);
        assert_eq!(runtime.queue.len(), 1);

        // Draining empties the queue.
        assert_eq!(drain_queue_test(&mut runtime).len(), 1);
        assert!(runtime.queue.is_empty());
    }

    fn drain_queue_test(runtime: &mut Runtime) -> Vec<PathBuf> {
        std::mem::take(&mut runtime.queue)
    }

    #[test]
    fn queue_backpressure_is_bounded() {
        let temp = tempfile::tempdir().unwrap();
        let mut runtime = runtime_with(&MonitorConfig::default(), &[temp.path().to_path_buf()]);
        for index in 0..(MAX_QUEUE + 20) {
            enqueue(&mut runtime, temp.path().join(format!("file-{index}.txt")));
        }
        assert_eq!(runtime.queue.len(), MAX_QUEUE);
        assert!(runtime.last_error.is_some());
    }

    #[test]
    fn oversized_files_are_rejected_not_queued() {
        let temp = tempfile::tempdir().unwrap();
        let dirs = vec![temp.path().to_path_buf()];
        let config = MonitorConfig {
            max_file_size_mb: 0, // 0 MiB: any file is oversized
            ..MonitorConfig::default()
        };
        let file = temp.path().join("big.bin");
        fs::write(&file, b"data").unwrap();
        let mut runtime = runtime_with(&config, &dirs);
        cycle_impl(&dirs, &config, &mut runtime); // baseline
        fs::write(&file, b"data changed").unwrap();
        cycle_impl(&dirs, &config, &mut runtime);
        assert!(runtime.queue.is_empty());
        assert!(runtime
            .events
            .iter()
            .any(|event| event.kind == EventKind::Rejected));
    }

    #[test]
    fn per_cycle_limit_is_enforced() {
        let temp = tempfile::tempdir().unwrap();
        for index in 0..10 {
            fs::write(temp.path().join(format!("f{index}.txt")), b"x").unwrap();
        }
        let dirs = vec![temp.path().to_path_buf()];
        let config = MonitorConfig {
            max_files_per_cycle: 3,
            ..MonitorConfig::default()
        };
        let mut runtime = runtime_with(&config, &dirs);
        cycle_impl(&dirs, &config, &mut runtime);
        assert_eq!(runtime.tracking.len(), 3);
        assert_eq!(runtime.events.len(), 0); // baseline, limited
        assert!(runtime.last_error.is_some());
    }

    #[test]
    fn auto_watch_reload_reports_running_monitor() {
        // Regression: `load()` spawned the auto-watch worker but left
        // `running = false`, so the UI claimed surveillance was stopped while
        // cycles kept running in the background.
        let temp = tempfile::tempdir().unwrap();
        let config_path = config_in(temp.path());
        let watch_dir = tempfile::tempdir().unwrap();
        let persisted = PersistedState {
            config: MonitorConfig::default(),
            directories: vec![watch_dir.path().display().to_string()],
            auto_watch: true,
        };
        fs::write(&config_path, serde_json::to_vec(&persisted).unwrap()).unwrap();

        let monitor = ProactiveMonitor::load(&config_path);
        let status = monitor.snapshot().unwrap();
        assert!(
            status.running,
            "auto-watch must report the auto-started worker as running"
        );
        assert!(!status.paused);
        assert!(status.auto_watch);

        monitor.stop().unwrap();
        assert!(!monitor.snapshot().unwrap().running);
    }

    #[test]
    fn config_persists_across_reload() {
        let temp = tempfile::tempdir().unwrap();
        let config_path = config_in(temp.path());
        let watch_dir = tempfile::tempdir().unwrap();
        let monitor = ProactiveMonitor::load(&config_path);
        monitor
            .set_directories(vec![watch_dir.path().display().to_string()])
            .unwrap();
        monitor.set_auto_watch(true).unwrap();

        // Read the persisted configuration directly: it must survive a reload.
        let bytes = fs::read(&config_path).unwrap();
        let persisted: PersistedState = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(persisted.directories.len(), 1);
        assert!(persisted.auto_watch);
        assert!(serde_json::from_slice::<serde_json::Value>(&bytes)
            .unwrap()
            .get("config")
            .is_some());
    }
}
