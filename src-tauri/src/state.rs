use std::sync::{Arc, Mutex};

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
}

impl AppState {
    pub fn new(paths: AppPaths, store: Arc<Store>, quarantine: Quarantine) -> Self {
        Self {
            paths,
            store,
            quarantine,
            scan_slot: Arc::new(Mutex::new(None)),
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
}
