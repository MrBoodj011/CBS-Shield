use std::sync::{Arc, Mutex};

use cbs_netmon::InterfaceTraffic;
use cbs_quarantine::Quarantine;
use cbs_store::Store;
use tokio::sync::Notify;
use uuid::Uuid;

use crate::error::CommandError;
use crate::paths::AppPaths;

struct ActiveScan {
    scan_id: String,
    cancel: Arc<Notify>,
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
    scan_slot: Arc<Mutex<Option<ActiveScan>>>,
    /// Last observed interface counters, used to compute measured traffic
    /// deltas between two Network Monitor captures.
    netmon_last: Arc<Mutex<Option<Vec<InterfaceTraffic>>>>,
}

impl AppState {
    pub fn new(paths: AppPaths, store: Arc<Store>, quarantine: Quarantine) -> Self {
        Self {
            paths,
            store,
            quarantine,
            scan_slot: Arc::new(Mutex::new(None)),
            netmon_last: Arc::new(Mutex::new(None)),
        }
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
