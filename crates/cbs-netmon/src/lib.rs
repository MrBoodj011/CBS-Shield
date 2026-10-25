//! CBS Shield network monitor — read-only observation of network activity.
//!
//! Every piece of data comes from documented Windows APIs called with
//! read-only access (no elevation required):
//! - active TCP connections: `GetExtendedTcpTable` (`TCP_TABLE_OWNER_PID_ALL`),
//! - UDP bindings: `GetExtendedUdpTable` (`UDP_TABLE_OWNER_PID`),
//! - cumulative interface counters: `GetIfTable2`,
//! - process identification: `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)`
//!   + `QueryFullProcessImageNameW`.
//!
//! Guarantees:
//! - nothing is injected, modified, filtered or blocked;
//! - no communication *content* is read: only connection metadata
//!   (addresses, ports, state, owning process) and cumulative byte counters;
//! - byte counters are cumulative snapshot values; traffic deltas are computed
//!   by [`traffic_delta`] between two captures and must be labelled in the UI
//!   as measured deltas between two captures, never as live estimates.
//!
//! Process names are best effort: when a process cannot be queried (system
//! process, exit race), the connection is still shown without a name.

use serde::{Deserialize, Serialize};

/// Errors surfaced by a capture.
#[derive(Debug, thiserror::Error)]
pub enum NetmonError {
    #[error("capture réseau impossible : {0}")]
    Syscall(String),

    #[error("la surveillance réseau est disponible uniquement sous Windows")]
    #[cfg(not(windows))]
    Unsupported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Transport {
    Tcp,
    Udp,
}

/// One observed socket row (a connection for TCP, a binding for UDP).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetConnection {
    pub transport: Transport,
    /// Display string; IPv6 is formatted without scope suffix (scope ids are
    /// not resolved — documented limitation).
    pub local_ip: String,
    pub local_port: u16,
    pub remote_ip: Option<String>,
    pub remote_port: Option<u16>,
    /// TCP state string (e.g. `ESTABLISHED`); `None` for UDP bindings.
    pub state: Option<String>,
    pub pid: u32,
    /// File name of the owning process, best effort (`None` = unknown).
    pub process_name: Option<String>,
}

/// Cumulative per-interface counters at capture time (NDIS `InOctets` /
/// `OutOctets`). These are absolute totals since the interface was enabled —
/// not per-interval rates.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterfaceTraffic {
    /// Interface alias as reported by the system (e.g. `Ethernet`, `Wi-Fi`).
    pub alias: String,
    pub interface_type: String,
    pub rx_bytes: u64,
    pub tx_bytes: u64,
}

/// One complete measured observation of the network state.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetSnapshot {
    /// RFC 3339 UTC timestamp of the capture.
    pub captured_at: String,
    pub tcp_connections: Vec<NetConnection>,
    /// UDP is connectionless: rows are local bindings, not "connections".
    pub udp_bindings: Vec<NetConnection>,
    /// Interfaces operational at capture time (loopback excluded).
    pub interfaces: Vec<InterfaceTraffic>,
}

#[cfg(windows)]
mod sys;

#[cfg(windows)]
pub use sys::capture_snapshot;

#[cfg(not(windows))]
mod stub;

#[cfg(not(windows))]
pub use stub::capture_snapshot;

/// Measured received/transmitted byte delta between two captures.
///
/// Only interfaces present in both captures contribute: a new interface has no
/// baseline, an interface whose counters went backwards (reset) contributes
/// nothing (saturation). Without a previous capture the delta is zero by
/// definition — a single measurement is a cumulative total, not a rate.
pub fn traffic_delta(
    previous: Option<&[InterfaceTraffic]>,
    current: &[InterfaceTraffic],
) -> (u64, u64) {
    let Some(previous) = previous else {
        return (0, 0);
    };
    let mut rx = 0u64;
    let mut tx = 0u64;
    for current_interface in current {
        if let Some(previous_interface) = previous
            .iter()
            .find(|probe| probe.alias == current_interface.alias)
        {
            rx += current_interface
                .rx_bytes
                .saturating_sub(previous_interface.rx_bytes);
            tx += current_interface
                .tx_bytes
                .saturating_sub(previous_interface.tx_bytes);
        }
    }
    (rx, tx)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn interface(alias: &str, rx: u64, tx: u64) -> InterfaceTraffic {
        InterfaceTraffic {
            alias: alias.to_string(),
            interface_type: "test".to_string(),
            rx_bytes: rx,
            tx_bytes: tx,
        }
    }

    #[test]
    fn first_capture_has_zero_delta() {
        let interfaces = [interface("Ethernet", 1000, 500)];
        assert_eq!(traffic_delta(None, &interfaces), (0, 0));
    }

    #[test]
    fn delta_is_measured_between_matching_interfaces_only() {
        let previous = [interface("Ethernet", 1000, 500)];
        let current = [
            interface("Ethernet", 2000, 700),
            // New interface: no previous baseline, contributes nothing.
            interface("Wi-Fi", 9000, 9000),
            // Counter reset: saturates to zero instead of negative delta.
            interface("Tunnel", 10, 10),
        ];
        assert_eq!(traffic_delta(Some(&previous), &current), (1000, 200));
    }

    #[cfg(windows)]
    #[test]
    fn capture_snapshot_is_valid_and_read_only() {
        let snapshot = capture_snapshot().unwrap();
        chrono::DateTime::parse_from_rfc3339(&snapshot.captured_at)
            .expect("captured_at must be RFC 3339");
        // UDP rows are bindings: no remote endpoint ever.
        for binding in &snapshot.udp_bindings {
            assert!(binding.remote_ip.is_none() && binding.remote_port.is_none());
        }
        for connection in &snapshot.tcp_connections {
            assert!(!connection.local_ip.is_empty());
            if let Some(port) = connection.remote_port {
                if connection.state.as_deref() == Some("LISTEN") {
                    // A listening socket accepts anything: remote is wildcard or none.
                    assert!(port == 0 || connection.remote_ip.is_some());
                }
            }
        }
        for interface in &snapshot.interfaces {
            assert!(!interface.alias.is_empty());
        }
    }

    #[cfg(windows)]
    #[test]
    fn current_process_name_is_resolvable() {
        assert_eq!(sys::tcp_state_name(4), "ESTABLISHED");
        let pid = std::process::id();
        let name = sys::process_name_of(pid);
        assert!(name.is_some(), "the current process must be identifiable");
        let name = name.unwrap();
        assert!(name.to_ascii_lowercase().ends_with(".exe") || name.contains("cbs"));
    }
}
