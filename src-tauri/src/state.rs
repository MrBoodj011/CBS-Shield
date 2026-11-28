use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use cbs_netmon::InterfaceTraffic;
use cbs_proactive::ProactiveMonitor;
use cbs_quarantine::Quarantine;
use cbs_store::Store;
use cbs_webguard::WebGuard;
use tokio::sync::Notify;
use uuid::Uuid;

use crate::error::CommandError;
use crate::paths::AppPaths;

struct ActiveScan {
    scan_id: String,
    cancel: Arc<Notify>,
}

/// Aggregate result of one proactive background batch (Sprint 9.1).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchSummary {
    pub files: usize,
    pub files_scanned: u64,
    pub detections: usize,
    pub failures: usize,
    pub outcome: String,
    pub record_id: Option<i64>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub error: Option<String>,
}

/// Runtime snapshot of the consent-controlled proactive auto-scan worker.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoScanStatus {
    pub enabled: bool,
    pub running: bool,
    pub cancel_requested: bool,
    pub busy_files: Option<Vec<String>>,
    pub last_error: Option<String>,
    pub last_batch: Option<BatchSummary>,
}

/// Mutable worker coordination state (guarded by the AppState mutex).
pub struct AutoScanState {
    pub enabled: bool,
    pub running: bool,
    pub cancel_requested: bool,
    /// Worker identity; bumped on every start so a stale worker can never
    /// mutate current state or run concurrently with a new one.
    pub generation: u64,
    pub cancel: Arc<Notify>,
    pub busy: Option<Vec<String>>,
    pub last_error: Option<String>,
    pub last_batch: Option<BatchSummary>,
}

impl Default for AutoScanState {
    fn default() -> Self {
        Self {
            enabled: false,
            running: false,
            cancel_requested: false,
            generation: 0,
            cancel: Arc::new(Notify::new()),
            busy: None,
            last_error: None,
            last_batch: None,
        }
    }
}

/// Clears the active scan slot even if the command returns early or panics.
pub struct ScanLease {
    slot: Arc<Mutex<Option<ActiveScan>>>,
    scan_id: String,
}

impl Drop for ScanLease {
    fn drop(&mut self) {
        if let Ok(mut slot) = self.slot.lock() {
            if slot
                .as_ref()
                .map(|active| active.scan_id == self.scan_id)
                .unwrap_or(false)
            {
                *slot = None;
            }
        }
    }
}

pub struct AppState {
    pub paths: AppPaths,
    pub store: Arc<Store>,
    pub quarantine: Quarantine,
    pub webguard: Arc<WebGuard>,
    pub proactive: ProactiveMonitor,
    /// De-duplication for native notifications (Sprint 9).
    pub notify_ring: Mutex<crate::notify::NotifyRing>,
    /// Consent-controlled proactive auto-scan worker state (Sprint 9.1).
    pub auto_scan: Mutex<AutoScanState>,
    scan_slot: Arc<Mutex<Option<ActiveScan>>>,
    /// Last observed interface counters, used to compute measured traffic
    /// deltas between two Network Monitor captures.
    netmon_last: Arc<Mutex<Option<Vec<InterfaceTraffic>>>>,
    update_running: Arc<AtomicBool>,
    /// Serializes quarantine/restore/delete commands end to end, so the
    /// "already quarantined?" check and the insert cannot interleave between
    /// two concurrent requests for the same file.
    pub vault_ops: tokio::sync::Mutex<()>,
}

/// Releases the single update slot on every exit path (success, error, panic).
pub struct UpdateLease {
    flag: Arc<AtomicBool>,
}

impl Drop for UpdateLease {
    fn drop(&mut self) {
        self.flag.store(false, Ordering::SeqCst);
    }
}

impl AppState {
    pub fn new(paths: AppPaths, store: Arc<Store>, quarantine: Quarantine) -> Self {
        let webguard = Arc::new(WebGuard::load(paths.webguard_dir.join("state.json")));
        let proactive = ProactiveMonitor::load(&paths.proactive_config);
        Self {
            paths,
            store,
            quarantine,
            webguard,
            proactive,
            notify_ring: Mutex::new(crate::notify::NotifyRing::default()),
            auto_scan: Mutex::new(AutoScanState::default()),
            scan_slot: Arc::new(Mutex::new(None)),
            netmon_last: Arc::new(Mutex::new(None)),
            update_running: Arc::new(AtomicBool::new(false)),
            vault_ops: tokio::sync::Mutex::new(()),
        }
    }

    /// Acquire the exclusive freshclam slot. Manual and automatic updates share
    /// it so two freshclam processes can never rewrite the database at once.
    pub fn begin_update(&self) -> Option<UpdateLease> {
        // Decide under the scan-slot lock: `begin_scan` checks the update flag
        // under the same lock, so a scan and an update can never both start.
        let slot = self.scan_slot.lock().unwrap_or_else(|p| p.into_inner());
        if slot.is_some() {
            return None;
        }
        if self
            .update_running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            Some(UpdateLease {
                flag: self.update_running.clone(),
            })
        } else {
            None
        }
    }

    pub fn is_updating(&self) -> bool {
        self.update_running.load(Ordering::SeqCst)
    }

    /// Only one ClamAV process at a time: simpler cancellation and predictable
    /// CPU usage on laptops.
    pub fn begin_scan(&self) -> Result<(String, Arc<Notify>, ScanLease), CommandError> {
        let mut slot = self
            .scan_slot
            .lock()
            .map_err(|err| CommandError::internal(format!("état de scan verrouillé : {err}")))?;
        if slot.is_some() {
            return Err(CommandError::new(
                "scanInProgress",
                "Un scan est déjà en cours. Attendez sa fin ou annulez-le.",
            ));
        }
        // clamscan must never read the signature database while freshclam is
        // rewriting it (manual and automatic updates both hold this flag).
        if self.is_updating() {
            return Err(CommandError::new(
                "updateInProgress",
                "Une mise à jour des signatures est en cours : le scan pourra démarrer dès qu'elle sera terminée.",
            ));
        }
        let scan_id = Uuid::new_v4().to_string();
        let cancel = Arc::new(Notify::new());
        *slot = Some(ActiveScan {
            scan_id: scan_id.clone(),
            cancel: cancel.clone(),
        });
        let lease = ScanLease {
            slot: self.scan_slot.clone(),
            scan_id: scan_id.clone(),
        };
        Ok((scan_id, cancel, lease))
    }

    pub fn cancel_scan(&self) -> Result<bool, CommandError> {
        let slot = self
            .scan_slot
            .lock()
            .map_err(|err| CommandError::internal(format!("état de scan verrouillé : {err}")))?;
        if let Some(active) = slot.as_ref() {
            active.cancel.notify_one();
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// True while a scan owns the slot. Used by `update_signatures` to refuse
    /// concurrent signature updates (freshclam rewrites the database while
    /// clamscan is reading it — documented race condition fixed in Sprint 2).
    pub fn is_scanning(&self) -> bool {
        self.scan_slot
            .lock()
            .map(|slot| slot.is_some())
            .unwrap_or(false)
    }

    /// Interfaces observed during the previous Network Monitor capture.
    pub fn last_netmon_interfaces(&self) -> Option<Vec<InterfaceTraffic>> {
        self.netmon_last.lock().ok()?.clone()
    }

    pub fn remember_netmon_interfaces(&self, interfaces: Vec<InterfaceTraffic>) {
        if let Ok(mut last) = self.netmon_last.lock() {
            *last = Some(interfaces);
        }
    }
}
