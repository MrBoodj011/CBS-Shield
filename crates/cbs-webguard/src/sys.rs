//! Read-only Windows DNS diagnostics.
//!
//! All network configuration is obtained through documented Win32 APIs
//! (`GetAdaptersAddresses`) or read-only registry queries. No DNS setting,
//! adapter, hosts file, proxy setting or service is ever modified.

use serde::{Deserialize, Serialize};

const MAX_ADAPTERS: usize = 64;
const MAX_DNS_SERVERS_PER_ADAPTER: usize = 8;
const MAX_BUFFER_BYTES: u32 = 16 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsAdapter {
    pub name: String,
    pub description: String,
    pub interface_kind: String,
    pub up: bool,
    pub dns_servers: Vec<String>,
    pub dns_suffix: String,
    pub probable_vpn: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsHealth {
    pub checked_at: String,
    /// `running`, `stopped` or `unknown`.
    pub service: String,
    pub service_observable: bool,
    pub adapters: Vec<DnsAdapter>,
    /// Unique DNS servers across all adapters, IPv4 first.
    pub resolvers: Vec<String>,
    pub probable_vpn: bool,
    /// `Some(true)` when Windows' auto-DoH registry value is enabled.
    /// `None` means the value could not be read; absence is not proof of DoH.
    pub encrypted_dns_evidence: Option<bool>,
    pub proxy_configured: Option<String>,
    pub healthy: bool,
    pub read_only: bool,
}

impl DnsHealth {
    /// Resolvers that may safely receive forwarded queries. Loopback,
    /// unspecified and multicast addresses are excluded so the prototype can
    /// never forward a query back into its own loopback socket.
    pub fn forwarders(&self) -> Vec<std::net::SocketAddr> {
        let mut result = Vec::new();
        for adapter in self.adapters.iter().filter(|adapter| adapter.up) {
            for server in &adapter.dns_servers {
                let Ok(ip) = server.parse::<std::net::IpAddr>() else {
                    continue;
                };
                if ip.is_loopback() || ip.is_unspecified() || ip.is_multicast() {
                    continue;
                }
                let address = std::net::SocketAddr::new(ip, 53);
                if !result.contains(&address) {
                    result.push(address);
                }
            }
        }
        result
    }
}

pub fn dns_health() -> DnsHealth {
    let checked_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    #[cfg(windows)]
    {
        let adapters = windows_adapters();
        let mut resolvers: Vec<String> = Vec::new();
        for adapter in &adapters {
            for server in &adapter.dns_servers {
                if !resolvers.contains(server) {
                    resolvers.push(server.clone());
                }
            }
        }
        resolvers.sort_by_key(|value| (value.contains(':'), value.clone()));
        let service = service_state("Dnscache");
        let service_observable = service != "unknown";
        let probable_vpn = adapters.iter().any(|adapter| adapter.probable_vpn);
        let has_up_resolver = adapters
            .iter()
            .any(|adapter| adapter.up && !adapter.dns_servers.is_empty());
        let healthy = service == "running" && has_up_resolver;
        DnsHealth {
            checked_at,
            service,
            service_observable,
            adapters,
            resolvers,
            probable_vpn,
            encrypted_dns_evidence: auto_doh_enabled(),
            proxy_configured: proxy_server(),
            healthy,
            read_only: true,
        }
    }
    #[cfg(not(windows))]
    {
        DnsHealth {
            checked_at,
            service: "unknown".to_string(),
            service_observable: false,
            adapters: Vec::new(),
            resolvers: Vec::new(),
            probable_vpn: false,
            encrypted_dns_evidence: None,
            proxy_configured: None,
            healthy: false,
            read_only: true,
        }
    }
}

#[cfg(windows)]
fn service_state(name: &str) -> String {
    use std::os::windows::process::CommandExt;
    let mut command = std::process::Command::new(cbs_core::fsutil::system_tool("sc.exe"));
    command
        .args(["query", name])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    command.creation_flags(0x0800_0000);
    let Ok(output) = command.output() else {
        return "unknown".to_string();
    };
    let text = String::from_utf8_lossy(&output.stdout);
    // `STATE : 4 RUNNING` — the numeric token is frozen by the Service
    // Control Manager API, unlike the localized display name.
    for line in text.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("STATE") {
            let upper = rest.to_ascii_uppercase();
            if upper.contains("RUNNING") || upper.contains(" 4 ") {
                return "running".to_string();
            }
            if upper.contains("STOPPED") || upper.contains(" 1 ") {
                return "stopped".to_string();
            }
            return "unknown".to_string();
        }
    }
    "unknown".to_string()
}

#[cfg(windows)]
fn windows_adapters() -> Vec<DnsAdapter> {
    use windows_sys::Win32::Foundation::{ERROR_BUFFER_OVERFLOW, ERROR_SUCCESS};
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetAdaptersAddresses, GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_MULTICAST,
        IP_ADAPTER_ADDRESSES_LH,
    };
    use windows_sys::Win32::Networking::WinSock::AF_UNSPEC;

    unsafe {
        let mut size: u32 = 16 * 1024;
        let mut buffer: Vec<u64> = vec![0; size as usize / 8 + 1];
        let mut first = GetAdaptersAddresses(
            AF_UNSPEC as u32,
            GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST,
            std::ptr::null(),
            buffer.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH,
            &mut size,
        );
        if first == ERROR_BUFFER_OVERFLOW {
            if size == 0 || size > MAX_BUFFER_BYTES {
                return Vec::new();
            }
            buffer = vec![0; size as usize / 8 + 1];
            first = GetAdaptersAddresses(
                AF_UNSPEC as u32,
                GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST,
                std::ptr::null(),
                buffer.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH,
                &mut size,
            );
        }
        if first != ERROR_SUCCESS {
            return Vec::new();
        }

        let mut adapters: Vec<DnsAdapter> = Vec::new();
        let mut current = buffer.as_ptr() as *const IP_ADAPTER_ADDRESSES_LH;
        while !current.is_null() && adapters.len() < MAX_ADAPTERS {
            let index = adapters.len();
            let adapter = &*current;
            let name = wide_string(adapter.FriendlyName);
            let description = wide_string(adapter.Description);
            let suffix = wide_string(adapter.DnsSuffix);
            let mut dns_servers = Vec::new();
            let mut dns = adapter.FirstDnsServerAddress;
            while !dns.is_null() && dns_servers.len() < MAX_DNS_SERVERS_PER_ADAPTER {
                let address = &*dns;
                if let Some(server) = sockaddr_string(address.Address.lpSockaddr) {
                    if !dns_servers.contains(&server) {
                        dns_servers.push(server);
                    }
                }
                dns = address.Next;
            }
            let probable_vpn = looks_like_vpn(&name, &description);
            adapters.push(DnsAdapter {
                name: if name.is_empty() {
                    format!("interface-{index}")
                } else {
                    name
                },
                description,
                interface_kind: interface_type_name(adapter.IfType),
                up: adapter.OperStatus == 1,
                dns_servers,
                dns_suffix: suffix,
                probable_vpn,
            });
            current = adapter.Next;
        }
        adapters
    }
}

#[cfg(windows)]
unsafe fn sockaddr_string(
    pointer: *const windows_sys::Win32::Networking::WinSock::SOCKADDR,
) -> Option<String> {
    use std::net::{Ipv4Addr, Ipv6Addr};
    use windows_sys::Win32::Networking::WinSock::{AF_INET, AF_INET6, SOCKADDR_IN, SOCKADDR_IN6};

    if pointer.is_null() {
        return None;
    }
    let family = (*pointer).sa_family;
    if family == AF_INET {
        let address = &*(pointer as *const SOCKADDR_IN);
        let octets = address.sin_addr.S_un.S_addr.to_ne_bytes();
        Some(Ipv4Addr::from(octets).to_string())
    } else if family == AF_INET6 {
        let address = &*(pointer as *const SOCKADDR_IN6);
        Some(Ipv6Addr::from(address.sin6_addr.u.Byte).to_string())
    } else {
        None
    }
}

/// # Safety
/// `pointer` must be null or point to a readable, NUL-terminated UTF-16
/// string (at most 512 units are read).
unsafe fn wide_string(pointer: *const u16) -> String {
    if pointer.is_null() {
        return String::new();
    }
    let mut length = 0usize;
    unsafe {
        while length < 512 && *pointer.add(length) != 0 {
            length += 1;
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(pointer, length))
    }
}

fn interface_type_name(kind: u32) -> String {
    match kind {
        6 => "ethernet".to_string(),
        10 => "ieee802.3".to_string(),
        12 => "tunnel".to_string(),
        23 => "ppp".to_string(),
        24 => "loopback".to_string(),
        54 => "virtual".to_string(),
        71 => "wifi".to_string(),
        243 => "wifiDirect".to_string(),
        other => format!("type-{other}"),
    }
}

fn looks_like_vpn(name: &str, description: &str) -> bool {
    let haystack = format!("{name} {description}").to_ascii_lowercase();
    [
        "vpn",
        "wireguard",
        "openvpn",
        "tap-",
        "tap adapter",
        "wintun",
        "tailscale",
        "zerotier",
        "anyconnect",
        "fortinet",
        "globalprotect",
        "nordlynx",
        "proton",
        "mullvad",
    ]
    .iter()
    .any(|needle| haystack.contains(needle))
}

#[cfg(windows)]
fn registry_dword(
    root: windows_sys::Win32::System::Registry::HKEY,
    subkey: &str,
    value: &str,
) -> Option<u32> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, RRF_RT_REG_DWORD};
    let subkey = wide_null(subkey);
    let value = wide_null(value);
    let mut data: u32 = 0;
    let mut size = std::mem::size_of::<u32>() as u32;
    let result = unsafe {
        RegGetValueW(
            root,
            subkey.as_ptr(),
            value.as_ptr(),
            RRF_RT_REG_DWORD,
            std::ptr::null_mut(),
            (&mut data as *mut u32).cast(),
            &mut size,
        )
    };
    (result == 0).then_some(data)
}

#[cfg(windows)]
fn registry_string(
    root: windows_sys::Win32::System::Registry::HKEY,
    subkey: &str,
    value: &str,
) -> Option<String> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, RRF_RT_REG_SZ};
    let subkey = wide_null(subkey);
    let value = wide_null(value);
    let mut buffer = [0u16; 1024];
    let mut size = (buffer.len() * 2) as u32;
    let result = unsafe {
        RegGetValueW(
            root,
            subkey.as_ptr(),
            value.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            buffer.as_mut_ptr().cast(),
            &mut size,
        )
    };
    if result != 0 {
        return None;
    }
    let length = buffer
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(buffer.len());
    let text = String::from_utf16_lossy(&buffer[..length])
        .trim()
        .to_string();
    (!text.is_empty()).then_some(text)
}

#[cfg(windows)]
fn auto_doh_enabled() -> Option<bool> {
    registry_dword(
        windows_sys::Win32::System::Registry::HKEY_LOCAL_MACHINE,
        r"SYSTEM\CurrentControlSet\Services\Dnscache\Parameters",
        "EnableAutoDoh",
    )
    .map(|value| value > 0)
}

/// WinINET proxy settings are per user (HKCU). A machine-wide policy under
/// HKLM is only consulted as a fallback.
#[cfg(windows)]
fn proxy_server() -> Option<String> {
    use windows_sys::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    const KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings";
    for root in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        if registry_dword(root, KEY, "ProxyEnable").unwrap_or(0) == 0 {
            continue;
        }
        if let Some(server) = registry_string(root, KEY, "ProxyServer") {
            return Some(server);
        }
    }
    None
}

#[cfg(windows)]
fn wide_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vpn_names_are_recognised_without_case_sensitivity() {
        assert!(looks_like_vpn("Ethernet 2", "WireGuard Tunnel"));
        assert!(looks_like_vpn("Tailscale", "Tailscale Tunnel"));
        assert!(!looks_like_vpn("Wi-Fi", "Intel(R) Wi-Fi 6 AX201"));
    }

    #[test]
    fn forwarders_exclude_loopback_and_down_adapters() {
        let health = DnsHealth {
            checked_at: "2026-10-28T10:00:00Z".to_string(),
            service: "running".to_string(),
            service_observable: true,
            adapters: vec![
                DnsAdapter {
                    name: "Ethernet".to_string(),
                    description: "Intel".to_string(),
                    interface_kind: "ethernet".to_string(),
                    up: true,
                    dns_servers: vec![
                        "192.0.2.53".to_string(),
                        "127.0.0.1".to_string(),
                        "0.0.0.0".to_string(),
                        "::1".to_string(),
                    ],
                    dns_suffix: String::new(),
                    probable_vpn: false,
                },
                DnsAdapter {
                    name: "VPN".to_string(),
                    description: "WireGuard".to_string(),
                    interface_kind: "tunnel".to_string(),
                    up: false,
                    dns_servers: vec!["10.8.0.1".to_string()],
                    dns_suffix: String::new(),
                    probable_vpn: true,
                },
            ],
            resolvers: vec!["192.0.2.53".to_string(), "10.8.0.1".to_string()],
            probable_vpn: true,
            encrypted_dns_evidence: None,
            proxy_configured: None,
            healthy: true,
            read_only: true,
        };
        let forwarders = health.forwarders();
        assert_eq!(forwarders.len(), 1);
        assert_eq!(forwarders[0].to_string(), "192.0.2.53:53");
    }

    #[test]
    fn interface_types_are_stable_labels() {
        assert_eq!(interface_type_name(6), "ethernet");
        assert_eq!(interface_type_name(71), "wifi");
        assert_eq!(interface_type_name(9999), "type-9999");
    }
}
