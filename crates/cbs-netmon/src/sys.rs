//! Windows implementation, built strictly on documented `iphlpapi` entry
//! points. Every constant's numeric value is frozen by the Win32
//! documentation (see `MIB_TCP_STATE`, `TCP_TABLE_CLASS`, `UDP_TABLE_CLASS`,
//! `IF_OPER_STATUS`, `IF_TYPE`).

use std::collections::HashMap;
use std::net::{Ipv4Addr, Ipv6Addr};

use chrono::{SecondsFormat, Utc};
use windows_sys::Win32::Foundation::{CloseHandle, ERROR_INSUFFICIENT_BUFFER};
use windows_sys::Win32::NetworkManagement::IpHelper::{
    FreeMibTable, GetExtendedTcpTable, GetExtendedUdpTable, GetIfTable2, MIB_IF_TABLE2,
    MIB_TCP6ROW_OWNER_PID, MIB_TCP6TABLE_OWNER_PID, MIB_TCPROW_OWNER_PID, MIB_TCPTABLE_OWNER_PID,
    MIB_UDP6ROW_OWNER_PID, MIB_UDP6TABLE_OWNER_PID, MIB_UDPROW_OWNER_PID, MIB_UDPTABLE_OWNER_PID,
};
use windows_sys::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
};

use super::{InterfaceTraffic, NetConnection, NetSnapshot, NetmonError, Transport};

// Frozen Win32 values (msdn):
const AF_INET: u32 = 2;
const AF_INET6: u32 = 23;
/// `TCP_TABLE_OWNER_PID_ALL`: TCP connections of every socket, owning PID.
const TCP_TABLE_OWNER_PID_ALL: i32 = 3;
/// `UDP_TABLE_OWNER_PID`: UDP bindings, owning PID.
const UDP_TABLE_OWNER_PID: i32 = 1;
/// `IfOperStatusUp`: interface is operational.
const IF_OPER_STATUS_UP: i32 = 1;
/// `IF_TYPE_SOFTWARE_LOOPBACK`: loopback is not real external traffic.
const IF_TYPE_SOFTWARE_LOOPBACK: u32 = 24;
/// The kernel System process owns no readable user image path.
const SYSTEM_PID: u32 = 4;

/// Upper bounds so an anomalous API answer can never blow up memory.
const MAX_TABLE_ENTRIES: usize = 20_000;
const MAX_INTERFACE_ROWS: usize = 512;
const MAX_TABLE_BYTES: u32 = 128 * 1024 * 1024;

fn syscall(detail: impl std::fmt::Display) -> NetmonError {
    NetmonError::Syscall(detail.to_string())
}

/// True when no endpoint is attached (bound/listening socket).
fn all_zero(bytes: &[u8]) -> bool {
    bytes.iter().all(|byte| *byte == 0)
}

/// Ports are stored in network byte order in the low 16 bits of the field.
fn field_port(field: u32) -> u16 {
    u16::from_be((field & 0xFFFF) as u16)
}

fn ipv4_string(field: u32) -> String {
    let octets = field.to_le_bytes();
    Ipv4Addr::new(octets[0], octets[1], octets[2], octets[3]).to_string()
}

/// `MIB_TCP_STATE` numeric value to a stable display string.
pub fn tcp_state_name(state: u32) -> &'static str {
    match state {
        0 => "CLOSED",
        1 => "LISTEN",
        2 => "SYN-SENT",
        3 => "SYN-RECEIVED",
        4 => "ESTABLISHED",
        5 => "FIN-WAIT-1",
        6 => "FIN-WAIT-2",
        7 => "CLOSE-WAIT",
        8 => "CLOSING",
        9 => "LAST-ACK",
        10 => "TIME-WAIT",
        11 => "DELETE-TCB",
        _ => "UNKNOWN-STATE",
    }
}

/// `IF_TYPE` numeric value to a short display label (common interfaces only;
/// exotic values keep their numeric form rather than a guess).
pub fn interface_type_name(kind: u32) -> String {
    match kind {
        6 => "ethernet".to_string(),
        10 => "ieee-802.3".to_string(),
        12 => "tunnel".to_string(),
        23 => "ppp".to_string(),
        24 => "loopback".to_string(),
        54 => "virtual".to_string(),
        71 => "wi-fi".to_string(),
        131 => "tunnel-mclil".to_string(),
        234 => "tunnel-wan".to_string(),
        243 => "wifi-direct".to_string(),
        other => format!("type-{other}"),
    }
}

fn u16s_to_string(buffer: &[u16]) -> String {
    let length = buffer
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..length])
}

/// Best-effort file name of the owning process.
pub fn process_name_of(pid: u32) -> Option<String> {
    match pid {
        0 => None,
        SYSTEM_PID => Some("System".to_string()),
        _ => unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return None;
            }
            let mut path = [0u16; 1024];
            let mut length = path.len() as u32;
            let ok = QueryFullProcessImageNameW(handle, 0, path.as_mut_ptr(), &mut length);
            CloseHandle(handle);
            if ok == 0 {
                return None;
            }
            let full = u16s_to_string(&path[..length as usize]);
            full.rsplit(['\\', '/']).next().map(str::to_string)
        },
    }
}

fn assign_process_names(mut connections: Vec<NetConnection>) -> Vec<NetConnection> {
    let mut names: HashMap<u32, Option<String>> = HashMap::new();
    for connection in &connections {
        names
            .entry(connection.pid)
            .or_insert_with(|| process_name_of(connection.pid));
    }
    for connection in &mut connections {
        if let Some(name) = names.get(&connection.pid).cloned().flatten() {
            connection.process_name = Some(name);
        }
    }
    connections
}

unsafe fn tcp_rows_v4() -> Result<Vec<NetConnection>, NetmonError> {
    let mut size: u32 = 0;
    let first = GetExtendedTcpTable(
        std::ptr::null_mut(),
        &mut size,
        0,
        AF_INET,
        TCP_TABLE_OWNER_PID_ALL,
        0,
    );
    if first != ERROR_INSUFFICIENT_BUFFER {
        return Err(syscall(format!(
            "GetExtendedTcpTable (IPv4) a renvoyé le code {first}"
        )));
    }
    if size > MAX_TABLE_BYTES {
        return Err(syscall("table TCP IPv4 anormalement grande"));
    }
    let mut buffer: Vec<u64> = vec![0; size as usize / 8 + 1];
    let result = GetExtendedTcpTable(
        buffer.as_mut_ptr() as *mut _,
        &mut size,
        0,
        AF_INET,
        TCP_TABLE_OWNER_PID_ALL,
        0,
    );
    if result != 0 {
        return Err(syscall(format!(
            "GetExtendedTcpTable (IPv4) a renvoyé le code {result}"
        )));
    }

    let table = buffer.as_ptr() as *const MIB_TCPTABLE_OWNER_PID;
    let entries = ((*table).dwNumEntries as usize).min(MAX_TABLE_ENTRIES);
    let rows = (*table).table.as_ptr();
    let connections = (0..entries)
        .map(|index| -> NetConnection {
            let row: MIB_TCPROW_OWNER_PID = *rows.add(index);
            let remote_octets = row.dwRemoteAddr.to_le_bytes();
            let remote_port = field_port(row.dwRemotePort);
            let has_remote = !all_zero(&remote_octets) || remote_port != 0;
            NetConnection {
                transport: Transport::Tcp,
                local_ip: ipv4_string(row.dwLocalAddr),
                local_port: field_port(row.dwLocalPort),
                remote_ip: has_remote.then(|| ipv4_string(row.dwRemoteAddr)),
                remote_port: has_remote.then_some(remote_port),
                state: Some(tcp_state_name(row.dwState).to_string()),
                pid: row.dwOwningPid,
                process_name: None,
            }
        })
        .collect();
    Ok(connections)
}

unsafe fn tcp_rows_v6() -> Result<Vec<NetConnection>, NetmonError> {
    let mut size: u32 = 0;
    let first = GetExtendedTcpTable(
        std::ptr::null_mut(),
        &mut size,
        0,
        AF_INET6,
        TCP_TABLE_OWNER_PID_ALL,
        0,
    );
    if first != ERROR_INSUFFICIENT_BUFFER {
        return Err(syscall(format!(
            "GetExtendedTcpTable (IPv6) a renvoyé le code {first}"
        )));
    }
    if size > MAX_TABLE_BYTES {
        return Err(syscall("table TCP IPv6 anormalement grande"));
    }
    let mut buffer: Vec<u64> = vec![0; size as usize / 8 + 1];
    let result = GetExtendedTcpTable(
        buffer.as_mut_ptr() as *mut _,
        &mut size,
        0,
        AF_INET6,
        TCP_TABLE_OWNER_PID_ALL,
        0,
    );
    if result != 0 {
        return Err(syscall(format!(
            "GetExtendedTcpTable (IPv6) a renvoyé le code {result}"
        )));
    }

    let table = buffer.as_ptr() as *const MIB_TCP6TABLE_OWNER_PID;
    let entries = ((*table).dwNumEntries as usize).min(MAX_TABLE_ENTRIES);
    let rows = (*table).table.as_ptr();
    let connections = (0..entries)
        .map(|index| -> NetConnection {
            let row: MIB_TCP6ROW_OWNER_PID = *rows.add(index);
            let has_remote = !all_zero(&row.ucRemoteAddr) || field_port(row.dwRemotePort) != 0;
            NetConnection {
                transport: Transport::Tcp,
                local_ip: Ipv6Addr::from(row.ucLocalAddr).to_string(),
                local_port: field_port(row.dwLocalPort),
                remote_ip: has_remote.then(|| Ipv6Addr::from(row.ucRemoteAddr).to_string()),
                remote_port: has_remote.then(|| field_port(row.dwRemotePort)),
                state: Some(tcp_state_name(row.dwState).to_string()),
                pid: row.dwOwningPid,
                process_name: None,
            }
        })
        .collect();
    Ok(connections)
}

unsafe fn udp_rows_v4() -> Result<Vec<NetConnection>, NetmonError> {
    let mut size: u32 = 0;
    let first = GetExtendedUdpTable(
        std::ptr::null_mut(),
        &mut size,
        0,
        AF_INET,
        UDP_TABLE_OWNER_PID,
        0,
    );
    if first != ERROR_INSUFFICIENT_BUFFER {
        return Err(syscall(format!(
            "GetExtendedUdpTable (IPv4) a renvoyé le code {first}"
        )));
    }
    if size > MAX_TABLE_BYTES {
        return Err(syscall("table UDP IPv4 anormalement grande"));
    }
    let mut buffer: Vec<u64> = vec![0; size as usize / 8 + 1];
    let result = GetExtendedUdpTable(
        buffer.as_mut_ptr() as *mut _,
        &mut size,
        0,
        AF_INET,
        UDP_TABLE_OWNER_PID,
        0,
    );
    if result != 0 {
        return Err(syscall(format!(
            "GetExtendedUdpTable (IPv4) a renvoyé le code {result}"
        )));
    }

    let table = buffer.as_ptr() as *const MIB_UDPTABLE_OWNER_PID;
    let entries = ((*table).dwNumEntries as usize).min(MAX_TABLE_ENTRIES);
    let rows = (*table).table.as_ptr();
    let bindings = (0..entries)
        .map(|index| -> NetConnection {
            let row: MIB_UDPROW_OWNER_PID = *rows.add(index);
            NetConnection {
                transport: Transport::Udp,
                local_ip: ipv4_string(row.dwLocalAddr),
                local_port: field_port(row.dwLocalPort),
                remote_ip: None,
                remote_port: None,
                state: None,
                pid: row.dwOwningPid,
                process_name: None,
            }
        })
        .collect();
    Ok(bindings)
}

unsafe fn udp_rows_v6() -> Result<Vec<NetConnection>, NetmonError> {
    let mut size: u32 = 0;
    let first = GetExtendedUdpTable(
        std::ptr::null_mut(),
        &mut size,
        0,
        AF_INET6,
        UDP_TABLE_OWNER_PID,
        0,
    );
    if first != ERROR_INSUFFICIENT_BUFFER {
        return Err(syscall(format!(
            "GetExtendedUdpTable (IPv6) a renvoyé le code {first}"
        )));
    }
    if size > MAX_TABLE_BYTES {
        return Err(syscall("table UDP IPv6 anormalement grande"));
    }
    let mut buffer: Vec<u64> = vec![0; size as usize / 8 + 1];
    let result = GetExtendedUdpTable(
        buffer.as_mut_ptr() as *mut _,
        &mut size,
        0,
        AF_INET6,
        UDP_TABLE_OWNER_PID,
        0,
    );
    if result != 0 {
        return Err(syscall(format!(
            "GetExtendedUdpTable (IPv6) a renvoyé le code {result}"
        )));
    }

    let table = buffer.as_ptr() as *const MIB_UDP6TABLE_OWNER_PID;
    let entries = ((*table).dwNumEntries as usize).min(MAX_TABLE_ENTRIES);
    let rows = (*table).table.as_ptr();
    let bindings = (0..entries)
        .map(|index| -> NetConnection {
            let row: MIB_UDP6ROW_OWNER_PID = *rows.add(index);
            NetConnection {
                transport: Transport::Udp,
                local_ip: Ipv6Addr::from(row.ucLocalAddr).to_string(),
                local_port: field_port(row.dwLocalPort),
                remote_ip: None,
                remote_port: None,
                state: None,
                pid: row.dwOwningPid,
                process_name: None,
            }
        })
        .collect();
    Ok(bindings)
}

/// Cumulative interface counters; best effort (empty vector on failure so a
/// counter glitch never hides the connection tables).
unsafe fn interface_rows() -> Vec<InterfaceTraffic> {
    let mut table: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
    if GetIfTable2(&mut table) != 0 || table.is_null() {
        return Vec::new();
    }
    let mut traffic = Vec::new();
    let entries = ((*table).NumEntries as usize).min(MAX_INTERFACE_ROWS);
    let rows = (*table).Table.as_mut_ptr();
    for index in 0..entries {
        let row = &*rows.add(index);
        if row.OperStatus != IF_OPER_STATUS_UP || row.Type == IF_TYPE_SOFTWARE_LOOPBACK {
            continue;
        }
        let alias = u16s_to_string(&row.Alias);
        if alias.is_empty() {
            continue;
        }
        traffic.push(InterfaceTraffic {
            alias,
            interface_type: interface_type_name(row.Type),
            rx_bytes: row.InOctets,
            tx_bytes: row.OutOctets,
        });
    }
    FreeMibTable(table as *mut _);
    traffic
}

/// Capture one complete read-only observation of the current network state.
pub fn capture_snapshot() -> Result<NetSnapshot, NetmonError> {
    // SAFETY: each call wraps documented Win32 APIs; every pointer is either
    // owned by this function (local buffer) or returned by the API and freed
    // via FreeMibTable below.
    let tcp = unsafe { tcp_rows_v4()?.into_iter().chain(tcp_rows_v6()?).collect() };
    let udp = unsafe { udp_rows_v4()?.into_iter().chain(udp_rows_v6()?).collect() };
    let interfaces = unsafe { interface_rows() };

    let tcp = assign_process_names(tcp);
    let udp = assign_process_names(udp);

    Ok(NetSnapshot {
        captured_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
        tcp_connections: tcp,
        udp_bindings: udp,
        interfaces,
    })
}
