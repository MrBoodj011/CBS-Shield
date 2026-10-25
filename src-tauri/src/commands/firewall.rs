//! CBS Firewall foundation commands — strictly read-only inspection.
//!
//! Every read goes through `cbs_firewall::inspect` (documented COM API
//! `INetFwPolicy2`). Nothing is ever modified: this module only reads, and it
//! stores a fingerprint of the rule set in the local settings to detect
//! configuration changes between observations.

use cbs_firewall::FirewallStatus;
use serde::Serialize;
use tauri::State;

use crate::error::CommandError;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FirewallObservation {
    pub status: FirewallStatus,
    /// RFC 3339 timestamp of the previous fingerprint if known.
    pub previous_checked_at: Option<String>,
    /// True when the rule fingerprint differs from the previous observation.
    pub changed_since_last: bool,
    /// True when the displayed rule list is a bounded extract.
    pub listed_truncated: bool,
}

#[tauri::command]
pub async fn firewall_status(
    state: State<'_, AppState>,
) -> Result<FirewallObservation, CommandError> {
    let status = tokio::task::spawn_blocking(cbs_firewall::inspect)
        .await
        .map_err(|err| {
            CommandError::internal(format!("inspection du pare-feu interrompue : {err}"))
        })
        .and_then(|inner| {
            inner.map_err(|err| CommandError::new("firewallUnavailable", err.to_string()))
        })?;

    let previous_hash: Option<String> = state.store.setting("firewallRulesHash")?;
    let previous_checked_at: Option<String> = state.store.setting("firewallCheckedAt")?;
    let changed_since_last = previous_hash
        .as_deref()
        .map(|hash| hash != status.rules_hash)
        .unwrap_or(false);

    // The fingerprint history is best-effort bookkeeping; a storage failure
    // never blocks observation.
    let _ = state
        .store
        .set_setting("firewallRulesHash", &status.rules_hash);
    let _ = state
        .store
        .set_setting("firewallCheckedAt", &status.checked_at);

    let listed_truncated = (status.rules.len() as u32) < status.rules_total_count;
    Ok(FirewallObservation {
        status,
        previous_checked_at,
        changed_since_last,
        listed_truncated,
    })
}
