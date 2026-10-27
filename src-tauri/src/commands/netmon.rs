//! CBS Network Monitor commands — read-only observation of network activity.
//!
//! Each invocation captures one snapshot via documented Windows APIs and
//! persists a bounded summary in the local SQLite history. Traffic deltas are
//! measured between two capturings of the cumulative NDIS counters; they are
//! never estimated.

use std::collections::HashMap;

use cbs_netmon::{capture_snapshot, traffic_delta, NetSnapshot};
use cbs_store::{NetmonProcessCount, NetmonSnapshotRecord, NewNetmonSnapshot};
use serde::Serialize;
use tauri::State;

use crate::error::CommandError;
use crate::state::AppState;

/// Upper bound returned to the UI so a long session cannot overflow the IPC.
const MAX_HISTORY_ROWS: u32 = 200;
const TOP_PROCESSES_COUNT: usize = 8;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetmonSnapshotPayload {
    pub snapshot: NetSnapshot,
    pub tcp_total: u64,
    /// Connections whose TCP state is ESTABLISHED (a stable honest metric).
    pub tcp_established: u64,
    pub udp_total: u64,
    /// Measured lifetime of incoming bytes between this capture and the
    /// previous one (0 on the first capture of the session).
    pub rx_bytes_delta: u64,
    pub tx_bytes_delta: u64,
    pub top_processes: Vec<NetmonProcessCount>,
    pub history_rows: u64,
    pub persistence_error: Option<String>,
}

#[tauri::command]
pub async fn netmon_snapshot(
    state: State<'_, AppState>,
) -> Result<NetmonSnapshotPayload, CommandError> {
    // Capture happens on a blocking thread; the UI stays responsive.
    let snapshot = tokio::task::spawn_blocking(capture_snapshot)
        .await
        .map_err(|err| CommandError::internal(format!("capture réseau interrompue : {err}")))?
        .map_err(|err| CommandError::new("netmonUnavailable", err.to_string()))?;

    let previous = state.last_netmon_interfaces();
    let (rx_bytes_delta, tx_bytes_delta) = traffic_delta(previous.as_deref(), &snapshot.interfaces);
    state.remember_netmon_interfaces(snapshot.interfaces.clone());

    let tcp_total = snapshot.tcp_connections.len() as u64;
    let tcp_established = snapshot
        .tcp_connections
        .iter()
        .filter(|connection| connection.state.as_deref() == Some("ESTABLISHED"))
        .count() as u64;
    let udp_total = snapshot.udp_bindings.len() as u64;

    let top_processes = top_processes(&snapshot.tcp_connections, &snapshot.udp_bindings);

    let record = NewNetmonSnapshot {
        captured_at: snapshot.captured_at.clone(),
        tcp_total,
        tcp_established,
        udp_total,
        rx_bytes_delta,
        tx_bytes_delta,
        top_processes: top_processes.clone(),
    };
    let store = state.store.clone();
    let persistence_result =
        tokio::task::spawn_blocking(move || store.insert_netmon_snapshot(&record))
            .await
            .map_err(|err| {
                CommandError::internal(format!("écriture historique interrompue : {err}"))
            });
    let persistence_error = match persistence_result {
        Ok(Ok(_)) => None,
        Ok(Err(err)) => Some(err.to_string()),
        Err(_) => None, // already mapped to a CommandError above
    };
    let history_rows = state.store.netmon_snapshot_count().unwrap_or(0);

    Ok(NetmonSnapshotPayload {
        snapshot,
        tcp_total,
        tcp_established,
        udp_total,
        rx_bytes_delta,
        tx_bytes_delta,
        top_processes,
        history_rows,
        persistence_error,
    })
}

#[tauri::command]
pub async fn netmon_history(
    state: State<'_, AppState>,
    limit: u32,
) -> Result<Vec<NetmonSnapshotRecord>, CommandError> {
    let limit = limit.clamp(1, MAX_HISTORY_ROWS);
    let store = state.store.clone();
    tokio::task::spawn_blocking(move || store.list_netmon_snapshots(limit))
        .await
        .map_err(|err| CommandError::internal(format!("lecture historique interrompue : {err}")))?
        .map_err(|err| CommandError::new("storageError", err.to_string()))
}

/// Aggregated process connection counts (bounded, excluding anonymous rows).
fn top_processes(
    tcp: &[cbs_netmon::NetConnection],
    udp: &[cbs_netmon::NetConnection],
) -> Vec<NetmonProcessCount> {
    let mut counts: HashMap<&str, u64> = HashMap::new();
    for connection in tcp.iter().chain(udp) {
        if let Some(name) = connection.process_name.as_deref() {
            *counts.entry(name).or_insert(0) += 1;
        }
    }
    let mut entries: Vec<NetmonProcessCount> = counts
        .into_iter()
        .map(|(name, connections)| NetmonProcessCount {
            name: name.to_string(),
            connections,
        })
        .collect();
    entries.sort_by(|a, b| {
        b.connections
            .cmp(&a.connections)
            .then_with(|| a.name.cmp(&b.name))
    });
    entries.truncate(TOP_PROCESSES_COUNT);
    entries
}

#[cfg(test)]
mod tests {
    use super::*;
    use cbs_netmon::{NetConnection, Transport};

    fn connection(process_name: Option<&str>) -> NetConnection {
        NetConnection {
            transport: Transport::Tcp,
            local_ip: "127.0.0.1".to_string(),
            local_port: 443,
            remote_ip: Some("93.184.216.34".to_string()),
            remote_port: Some(443),
            state: Some("ESTABLISHED".to_string()),
            pid: 1,
            process_name: process_name.map(str::to_string),
            process_path: process_name.map(|name| format!("C:\\Program Files\\Test\\{name}")),
        }
    }

    #[test]
    fn top_processes_ranks_by_connection_count() {
        let tcp = vec![
            connection(Some("chrome.exe")),
            connection(Some("chrome.exe")),
            connection(Some("chrome.exe")),
            connection(Some("explorer.exe")),
            connection(None),
        ];
        let udp = vec![connection(Some("explorer.exe"))];
        let top = top_processes(&tcp, &udp);
        assert_eq!(top.len(), 2);
        assert_eq!(top[0].name, "chrome.exe");
        assert_eq!(top[0].connections, 3);
        assert_eq!(top[1].name, "explorer.exe");
        assert_eq!(top[1].connections, 2);
        // Anonymous rows are never invented a process name.
        assert!(top.iter().all(|entry| !entry.name.is_empty()));
    }
}
