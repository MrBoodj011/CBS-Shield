//! CBS Shield Web Guard — **non-invasive** DNS filtering prototype.
//!
//! Safety model
//! ------------
//! * CBS Shield never edits the Windows DNS configuration, the hosts file,
//!   WinHTTP/WinINET proxy settings, firewall rules or TLS stores.
//! * The prototype resolver listens on `127.0.0.1:5353` only (or the next free
//!   loopback port when mDNS already owns 5353), and only after
//!   the user explicitly enables monitoring. Applications keep using the
//!   system resolver unless the user manually points a test client at that
//!   loopback endpoint.
//! * No HTTPS traffic is intercepted and no certificate is installed.
//! * Blocklists are imported from local files chosen by the user. No browsing
//!   history or domain list is transmitted to a remote service.
//!
//! This is deliberately not a system-wide DNS enforcement service. The UI
//! reports that limitation instead of claiming complete protection.

use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::io;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, UdpSocket};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

mod sys;

pub use sys::DnsHealth;

pub const MAX_BLOCKLIST_ENTRIES: usize = 200_000;
pub const MAX_ALLOWLIST_ENTRIES: usize = 5_000;
pub const MAX_HISTORY_EVENTS: usize = 300;
pub const MAX_IMPORT_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_IMPORT_LINE_BYTES: usize = 1_024;
pub const PROXY_PORT: u16 = 5_353;
pub const PROXY_ENDPOINT: &str = "127.0.0.1:5353";
const PROXY_READ_TIMEOUT: Duration = Duration::from_millis(350);
const UPSTREAM_TIMEOUT: Duration = Duration::from_millis(1_200);
const MAX_DNS_PACKET: usize = 4_096;
const STATE_VERSION: u32 = 1;

#[derive(Debug, thiserror::Error)]
pub enum WebGuardError {
    #[error("domaine invalide : {0}")]
    InvalidDomain(String),
    #[error("catégorie de filtre invalide : {0}")]
    InvalidCategory(String),
    #[error("import trop volumineux : {0} octets (maximum {MAX_IMPORT_BYTES})")]
    ImportTooLarge(u64),
    #[error("aucun domaine exploitable dans le fichier importé")]
    ImportEmpty,
    #[error("le fichier importé n'est pas du texte UTF-8 valide")]
    InvalidEncoding,
    #[error("confirmation explicite requise")]
    ConfirmationRequired,
    #[error("le prototype DNS est déjà en cours d'exécution")]
    ProxyAlreadyRunning,
    #[error("le prototype DNS n'est pas en cours d'exécution")]
    ProxyNotRunning,
    #[error("impossible de démarrer le prototype DNS : {0}")]
    ProxyStart(String),
    #[error("aucun résolveur DNS système utilisable n'a été trouvé")]
    NoUpstreamResolver,
    #[error("erreur d'entrée/sortie : {0}")]
    Io(#[from] io::Error),
    #[error("état Web Guard illisible : {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BlockEntry {
    pub domain: String,
    pub category: String,
    pub source: String,
    pub imported_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AllowEntry {
    pub domain: String,
    pub note: String,
    pub added_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FilterSource {
    pub id: String,
    pub name: String,
    pub category: String,
    pub imported_at: String,
    pub entry_count: usize,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WebGuardEvent {
    pub id: String,
    pub occurred_at: String,
    pub domain: String,
    /// `blocked`, `allowed` or `error`.
    pub action: String,
    pub category: Option<String>,
    pub matched_rule: Option<String>,
    pub source: String,
    pub upstream: Option<String>,
    pub latency_ms: Option<u64>,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainVerdict {
    /// `blocked` or `allowed`.
    pub action: String,
    /// `blocklist`, `allowlist` or `notListed`.
    pub reason: String,
    pub category: Option<String>,
    pub matched_rule: Option<String>,
    pub allowlist_rule: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyStatus {
    pub running: bool,
    pub endpoint: String,
    pub mode: String,
    pub started_at: Option<String>,
    pub last_error: Option<String>,
    /// Always false in this sprint: no system DNS setting is changed.
    pub system_dns_modified: bool,
    /// Always false in this sprint: the loopback prototype is not enforcement.
    pub active_enforcement: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebGuardCounts {
    pub blocklist: usize,
    pub allowlist: usize,
    pub filters: usize,
    pub malware: usize,
    pub phishing: usize,
    pub events: usize,
    pub blocked_events: usize,
    pub allowed_events: usize,
    pub error_events: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebGuardView {
    pub checked_at: String,
    pub health: DnsHealth,
    pub proxy: ProxyStatus,
    pub counts: WebGuardCounts,
    pub filters: Vec<FilterSource>,
    pub events: Vec<WebGuardEvent>,
    pub allowlist: Vec<AllowEntry>,
    /// Bounded extract; `blocklist_total` is authoritative.
    pub blocklist: Vec<BlockEntry>,
    pub blocklist_total: usize,
    pub blocklist_truncated: bool,
    pub state_error: Option<String>,
    pub system_dns_modified: bool,
    pub restoration_required: bool,
    pub active_enforcement: bool,
    pub limitation_codes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub source: FilterSource,
    pub added: usize,
    pub updated: usize,
    pub ignored_lines: usize,
    pub total_blocklist: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainTestResult {
    pub domain: String,
    pub verdict: DomainVerdict,
    pub proxy_running: bool,
    pub endpoint: String,
    /// `blocked`, `allowed`, `upstreamFailure`, `notRunning` or `error`.
    pub query_outcome: String,
    pub rcode: Option<u8>,
    pub latency_ms: Option<u64>,
    pub detail: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct PersistedState {
    version: u32,
    blocklist: Vec<BlockEntry>,
    allowlist: Vec<AllowEntry>,
    filters: Vec<FilterSource>,
    events: Vec<WebGuardEvent>,
    last_monitor_at: Option<String>,
}

#[derive(Debug, Default)]
struct ProxyRuntime {
    stop: Option<Arc<AtomicBool>>,
    join: Option<JoinHandle<()>>,
    started_at: Option<String>,
    endpoint: Option<String>,
    last_error: Option<String>,
}

/// Local Web Guard state. The structure is cheap to share; mutations are
/// serialized and persisted atomically to a single JSON file.
pub struct WebGuard {
    path: PathBuf,
    state: RwLock<PersistedState>,
    state_error: Mutex<Option<String>>,
    proxy: Mutex<ProxyRuntime>,
}

impl WebGuard {
    pub fn load(path: impl Into<PathBuf>) -> Self {
        let path = path.into();
        let (state, error) = match fs::read(&path) {
            Ok(bytes) if bytes.len() > 32 * 1024 * 1024 => (
                PersistedState::default(),
                Some("fichier d'état Web Guard trop volumineux".to_string()),
            ),
            Ok(bytes) => match serde_json::from_slice::<PersistedState>(&bytes) {
                Ok(mut state) => {
                    state.version = STATE_VERSION;
                    normalize_loaded_state(&mut state);
                    (state, None)
                }
                Err(err) => (
                    PersistedState::default(),
                    Some(format!("état Web Guard illisible : {err}")),
                ),
            },
            Err(err) if err.kind() == io::ErrorKind::NotFound => (PersistedState::default(), None),
            Err(err) => (
                PersistedState::default(),
                Some(format!("lecture impossible : {err}")),
            ),
        };

        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        Self {
            path,
            state: RwLock::new(state),
            state_error: Mutex::new(error),
            proxy: Mutex::new(ProxyRuntime::default()),
        }
    }

    pub fn state_path(&self) -> &Path {
        &self.path
    }

    fn read_state(&self) -> std::sync::RwLockReadGuard<'_, PersistedState> {
        self.state
            .read()
            .unwrap_or_else(|poison| poison.into_inner())
    }

    fn write_state(&self) -> std::sync::RwLockWriteGuard<'_, PersistedState> {
        self.state
            .write()
            .unwrap_or_else(|poison| poison.into_inner())
    }

    fn save(&self) -> Result<(), WebGuardError> {
        let snapshot = {
            let state = self.read_state();
            PersistedState {
                version: STATE_VERSION,
                blocklist: state.blocklist.clone(),
                allowlist: state.allowlist.clone(),
                filters: state.filters.clone(),
                events: state.events.clone(),
                last_monitor_at: state.last_monitor_at.clone(),
            }
        };
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let tmp = self.path.with_extension("json.tmp");
        let bytes = serde_json::to_vec_pretty(&snapshot)?;
        fs::write(&tmp, bytes)?;
        // std::fs::rename replaces the destination on Windows (MoveFileEx with
        // MOVEFILE_REPLACE_EXISTING), so a partially-written state can never be
        // observed under the real file name.
        fs::rename(&tmp, &self.path)?;
        if let Ok(mut error) = self.state_error.lock() {
            *error = None;
        }
        Ok(())
    }

    pub fn health(&self) -> DnsHealth {
        sys::dns_health()
    }

    pub fn proxy_status(&self) -> ProxyStatus {
        let proxy = self.proxy.lock().unwrap_or_else(|p| p.into_inner());
        ProxyStatus {
            running: proxy.join.is_some(),
            endpoint: proxy
                .endpoint
                .clone()
                .unwrap_or_else(|| PROXY_ENDPOINT.to_string()),
            mode: "prototypeLoopback".to_string(),
            started_at: proxy.started_at.clone(),
            last_error: proxy.last_error.clone(),
            system_dns_modified: false,
            active_enforcement: false,
        }
    }

    pub fn view(&self) -> WebGuardView {
        let state = self.read_state();
        let health = self.health();
        let proxy = self.proxy_status();
        let mut filters = state.filters.clone();
        filters.sort_by(|a, b| b.imported_at.cmp(&a.imported_at));
        let allowlist = state.allowlist.clone();
        let blocklist_total = state.blocklist.len();
        let blocklist = state
            .blocklist
            .iter()
            .take(1_000)
            .cloned()
            .collect::<Vec<_>>();
        let events = state
            .events
            .iter()
            .take(MAX_HISTORY_EVENTS)
            .cloned()
            .collect();
        let malware = state
            .blocklist
            .iter()
            .filter(|entry| entry.category == "malware")
            .count();
        let phishing = state
            .blocklist
            .iter()
            .filter(|entry| entry.category == "phishing")
            .count();
        let blocked_events = state
            .events
            .iter()
            .filter(|event| event.action == "blocked")
            .count();
        let allowed_events = state
            .events
            .iter()
            .filter(|event| event.action == "allowed")
            .count();
        let error_events = state
            .events
            .iter()
            .filter(|event| event.action == "error")
            .count();
        let state_error = self.state_error.lock().ok().and_then(|error| error.clone());

        WebGuardView {
            checked_at: now(),
            health,
            proxy,
            counts: WebGuardCounts {
                blocklist: blocklist_total,
                allowlist: state.allowlist.len(),
                filters: state.filters.len(),
                malware,
                phishing,
                events: state.events.len(),
                blocked_events,
                allowed_events,
                error_events,
            },
            filters,
            events,
            allowlist,
            blocklist,
            blocklist_total,
            blocklist_truncated: blocklist_total > 1_000,
            state_error,
            system_dns_modified: false,
            restoration_required: false,
            active_enforcement: false,
            limitation_codes: vec![
                "loopbackOnly".to_string(),
                "noHttpsInterception".to_string(),
                "encryptedDnsBypass".to_string(),
                "vpnBypass".to_string(),
                "notSystemWide".to_string(),
                "noMalwareGuarantee".to_string(),
            ],
        }
    }

    /// Classify a hostname. Allowlist wins over blocklist (intentional
    /// false-positive escape hatch).
    pub fn classify(&self, domain: &str) -> Result<DomainVerdict, WebGuardError> {
        let host = normalize_domain(domain)?;
        let state = self.read_state();

        if let Some(entry) = state
            .allowlist
            .iter()
            .find(|entry| domain_matches(&entry.domain, &host))
        {
            let blocked = state
                .blocklist
                .iter()
                .find(|blocked| domain_matches(&blocked.domain, &host));
            return Ok(DomainVerdict {
                action: "allowed".to_string(),
                reason: "allowlist".to_string(),
                category: blocked.map(|entry| entry.category.clone()),
                matched_rule: blocked.map(|entry| entry.domain.clone()),
                allowlist_rule: Some(entry.domain.clone()),
            });
        }

        if let Some(entry) = state
            .blocklist
            .iter()
            .find(|entry| domain_matches(&entry.domain, &host))
        {
            return Ok(DomainVerdict {
                action: "blocked".to_string(),
                reason: "blocklist".to_string(),
                category: Some(entry.category.clone()),
                matched_rule: Some(entry.domain.clone()),
                allowlist_rule: None,
            });
        }

        Ok(DomainVerdict {
            action: "allowed".to_string(),
            reason: "notListed".to_string(),
            category: None,
            matched_rule: None,
            allowlist_rule: None,
        })
    }

    pub fn import_filter(
        &self,
        path: &Path,
        category: &str,
        confirm: bool,
        source_name: Option<String>,
    ) -> Result<ImportResult, WebGuardError> {
        if !confirm {
            return Err(WebGuardError::ConfirmationRequired);
        }
        let category = normalize_category(category)?;
        let metadata = fs::metadata(path)?;
        if metadata.len() > MAX_IMPORT_BYTES as u64 {
            return Err(WebGuardError::ImportTooLarge(metadata.len()));
        }
        let bytes = fs::read(path)?;
        if bytes.len() > MAX_IMPORT_BYTES {
            return Err(WebGuardError::ImportTooLarge(bytes.len() as u64));
        }
        let parsed = parse_filter(&bytes)?;
        if parsed.domains.is_empty() {
            return Err(WebGuardError::ImportEmpty);
        }
        let total_after = {
            let state = self.read_state();
            let existing: BTreeSet<&str> = state
                .blocklist
                .iter()
                .map(|entry| entry.domain.as_str())
                .collect();
            let new_entries = parsed
                .domains
                .iter()
                .filter(|domain| !existing.contains(domain.as_str()))
                .count();
            state.blocklist.len() + new_entries
        };
        if total_after > MAX_BLOCKLIST_ENTRIES {
            return Err(WebGuardError::ImportTooLarge(total_after as u64));
        }

        let imported_at = now();
        let sha256 = hex_sha256(&bytes);
        let name = source_name
            .or_else(|| {
                path.file_name()
                    .map(|name| name.to_string_lossy().to_string())
            })
            .map(|name| sanitize_source_name(&name))
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| "liste-locale".to_string());
        let source = FilterSource {
            id: format!("{}-{}", imported_at.replace([':', '.'], "-"), &sha256[..12]),
            name,
            category: category.clone(),
            imported_at: imported_at.clone(),
            entry_count: parsed.domains.len(),
            sha256,
        };

        let mut added = 0usize;
        let mut updated = 0usize;
        {
            let mut state = self.write_state();
            let mut index: HashMap<String, usize> = state
                .blocklist
                .iter()
                .enumerate()
                .map(|(position, entry)| (entry.domain.clone(), position))
                .collect();
            for domain in &parsed.domains {
                if let Some(position) = index.get(domain).copied() {
                    let entry = &mut state.blocklist[position];
                    entry.category = category.clone();
                    entry.source = source.name.clone();
                    entry.imported_at = imported_at.clone();
                    updated += 1;
                } else {
                    index.insert(domain.clone(), state.blocklist.len());
                    state.blocklist.push(BlockEntry {
                        domain: domain.clone(),
                        category: category.clone(),
                        source: source.name.clone(),
                        imported_at: imported_at.clone(),
                    });
                    added += 1;
                }
            }
            state.filters.push(source.clone());
            state
                .filters
                .sort_by(|a, b| b.imported_at.cmp(&a.imported_at));
            state.filters.truncate(64);
        }
        self.save()?;
        let total_blocklist = self.read_state().blocklist.len();
        Ok(ImportResult {
            source,
            added,
            updated,
            ignored_lines: parsed.ignored_lines,
            total_blocklist,
        })
    }

    pub fn add_allowlist(&self, domain: &str, note: &str) -> Result<AllowEntry, WebGuardError> {
        let domain = normalize_domain(domain)?;
        let note = sanitize_note(note);
        let mut state = self.write_state();
        if state.allowlist.len() >= MAX_ALLOWLIST_ENTRIES {
            return Err(WebGuardError::ImportTooLarge(MAX_ALLOWLIST_ENTRIES as u64));
        }
        if let Some(existing) = state
            .allowlist
            .iter_mut()
            .find(|entry| entry.domain == domain)
        {
            existing.note = note;
            let entry = existing.clone();
            drop(state);
            self.save()?;
            return Ok(entry);
        }
        let entry = AllowEntry {
            domain,
            note,
            added_at: now(),
        };
        state.allowlist.push(entry.clone());
        state.allowlist.sort_by(|a, b| a.domain.cmp(&b.domain));
        drop(state);
        self.save()?;
        Ok(entry)
    }

    pub fn remove_allowlist(&self, domain: &str) -> Result<bool, WebGuardError> {
        let domain = normalize_domain(domain)?;
        let removed = {
            let mut state = self.write_state();
            let before = state.allowlist.len();
            state.allowlist.retain(|entry| entry.domain != domain);
            before != state.allowlist.len()
        };
        if removed {
            self.save()?;
        }
        Ok(removed)
    }

    pub fn clear_history(&self, confirm: bool) -> Result<(), WebGuardError> {
        if !confirm {
            return Err(WebGuardError::ConfirmationRequired);
        }
        self.write_state().events.clear();
        self.save()
    }

    pub fn clear_blocklist(&self, confirm: bool) -> Result<(), WebGuardError> {
        if !confirm {
            return Err(WebGuardError::ConfirmationRequired);
        }
        {
            let mut state = self.write_state();
            state.blocklist.clear();
            state.filters.clear();
        }
        self.save()
    }

    pub fn record_event(&self, event: WebGuardEvent) {
        {
            let mut state = self.write_state();
            state.events.insert(0, event);
            state.events.truncate(MAX_HISTORY_EVENTS);
        }
        if let Err(err) = self.save() {
            if let Ok(mut error) = self.state_error.lock() {
                *error = Some(format!("historique non enregistré : {err}"));
            }
        }
    }

    /// Start the loopback DNS prototype. This never edits system settings.
    pub fn start_monitor(self: &Arc<Self>) -> Result<ProxyStatus, WebGuardError> {
        let mut proxy = self.proxy.lock().unwrap_or_else(|p| p.into_inner());
        if proxy.join.is_some() {
            return Err(WebGuardError::ProxyAlreadyRunning);
        }

        let health = self.health();
        let upstreams = health.forwarders();
        if upstreams.is_empty() {
            return Err(WebGuardError::NoUpstreamResolver);
        }

        let (socket, endpoint) = bind_proxy_socket()?;
        socket.set_read_timeout(Some(PROXY_READ_TIMEOUT))?;
        let stop = Arc::new(AtomicBool::new(false));
        let stop_thread = stop.clone();
        let guard = Arc::clone(self);
        let started_at = now();
        let join = thread::Builder::new()
            .name("cbs-webguard-dns".to_string())
            .spawn(move || proxy_loop(guard, socket, upstreams, stop_thread))
            .map_err(|err| WebGuardError::ProxyStart(err.to_string()))?;

        proxy.stop = Some(stop);
        proxy.join = Some(join);
        proxy.started_at = Some(started_at.clone());
        proxy.endpoint = Some(endpoint.to_string());
        proxy.last_error = None;
        if let Ok(mut state) = self.state.try_write() {
            state.last_monitor_at = Some(started_at.clone());
        }
        let _ = self.save();
        Ok(ProxyStatus {
            running: true,
            endpoint: endpoint.to_string(),
            mode: "prototypeLoopback".to_string(),
            started_at: Some(started_at),
            last_error: None,
            system_dns_modified: false,
            active_enforcement: false,
        })
    }

    pub fn stop_monitor(&self) -> Result<ProxyStatus, WebGuardError> {
        let mut proxy = self.proxy.lock().unwrap_or_else(|p| p.into_inner());
        if proxy.join.is_none() {
            return Err(WebGuardError::ProxyNotRunning);
        }
        if let Some(stop) = &proxy.stop {
            stop.store(true, Ordering::SeqCst);
        }
        if let Some(join) = proxy.join.take() {
            let _ = join.join();
        }
        proxy.stop = None;
        proxy.started_at = None;
        Ok(ProxyStatus {
            running: false,
            endpoint: proxy
                .endpoint
                .clone()
                .unwrap_or_else(|| PROXY_ENDPOINT.to_string()),
            mode: "prototypeLoopback".to_string(),
            started_at: None,
            last_error: proxy.last_error.clone(),
            system_dns_modified: false,
            active_enforcement: false,
        })
    }

    pub fn test_domain(&self, domain: &str) -> Result<DomainTestResult, WebGuardError> {
        let host = normalize_domain(domain)?;
        let verdict = self.classify(&host)?;
        let proxy = self.proxy_status();
        let running = proxy.running;
        let endpoint = proxy.endpoint;
        if !running {
            return Ok(DomainTestResult {
                domain: host,
                verdict,
                proxy_running: false,
                endpoint,
                query_outcome: "notRunning".to_string(),
                rcode: None,
                latency_ms: None,
                detail: "Le prototype loopback est arrêté : seul le classificateur local a été évalué. Aucune requête réseau n'a été envoyée.".to_string(),
            });
        }

        match query_loopback(&host, &endpoint) {
            Ok((rcode, latency_ms)) => {
                let blocked = verdict.action == "blocked";
                Ok(DomainTestResult {
                    domain: host,
                    verdict,
                    proxy_running: true,
                    endpoint,
                    query_outcome: if blocked {
                        "blocked".to_string()
                    } else if rcode == 0 {
                        "allowed".to_string()
                    } else {
                        "upstreamFailure".to_string()
                    },
                    rcode: Some(rcode),
                    latency_ms: Some(latency_ms),
                    detail: if blocked {
                        "Requête réelle envoyée au prototype loopback : réponse NXDOMAIN locale, sans transmission à Internet.".to_string()
                    } else if rcode == 0 {
                        "Requête réelle relayée au résolveur système configuré ; réponse DNS reçue."
                            .to_string()
                    } else {
                        format!("Le résolveur système n'a pas fourni de réponse exploitable (RCODE {rcode}).")
                    },
                })
            }
            Err(err) => Ok(DomainTestResult {
                domain: host,
                verdict,
                proxy_running: true,
                endpoint,
                query_outcome: "error".to_string(),
                rcode: None,
                latency_ms: None,
                detail: format!("Le prototype loopback n'a pas répondu : {err}"),
            }),
        }
    }
}

impl Drop for WebGuard {
    fn drop(&mut self) {
        let mut proxy = self.proxy.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(stop) = &proxy.stop {
            stop.store(true, Ordering::SeqCst);
        }
        if let Some(join) = proxy.join.take() {
            let _ = join.join();
        }
    }
}

fn normalize_loaded_state(state: &mut PersistedState) {
    state.version = STATE_VERSION;
    state
        .blocklist
        .retain(|entry| normalize_domain(&entry.domain).is_ok());
    state.blocklist.truncate(MAX_BLOCKLIST_ENTRIES);
    state
        .allowlist
        .retain(|entry| normalize_domain(&entry.domain).is_ok());
    state.allowlist.truncate(MAX_ALLOWLIST_ENTRIES);
    state.events.truncate(MAX_HISTORY_EVENTS);
    state.filters.truncate(64);
    state.allowlist.sort_by(|a, b| a.domain.cmp(&b.domain));
}

pub fn normalize_domain(input: &str) -> Result<String, WebGuardError> {
    let mut value = input.trim().to_ascii_lowercase();
    if let Some(rest) = value.strip_prefix("||") {
        value = rest.to_string();
    }
    if let Some(rest) = value.strip_suffix('^') {
        value = rest.to_string();
    }
    if let Some(rest) = value.strip_prefix("*.") {
        value = rest.to_string();
    }
    while value.starts_with('.') {
        value.remove(0);
    }
    while value.ends_with('.') {
        value.pop();
    }
    if value.is_empty() || value.len() > 253 {
        return Err(WebGuardError::InvalidDomain(input.to_string()));
    }
    if !value.is_ascii() {
        return Err(WebGuardError::InvalidDomain(format!(
            "{input} (les noms internationalisés doivent être fournis en Punycode ASCII)"
        )));
    }
    if value.contains(['/', ':', '@', '?', '#', '\\', ' ', '\t', '\r', '\n']) {
        return Err(WebGuardError::InvalidDomain(input.to_string()));
    }
    let labels: Vec<&str> = value.split('.').collect();
    if labels.len() > 127 {
        return Err(WebGuardError::InvalidDomain(input.to_string()));
    }
    for label in labels {
        if label.is_empty() || label.len() > 63 {
            return Err(WebGuardError::InvalidDomain(input.to_string()));
        }
        if label.starts_with('-') || label.ends_with('-') {
            return Err(WebGuardError::InvalidDomain(input.to_string()));
        }
        if !label
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
        {
            return Err(WebGuardError::InvalidDomain(input.to_string()));
        }
    }
    Ok(value)
}

/// A blocklist rule also covers its subdomains. `example.com` matches
/// `example.com` and `cdn.example.com`, but never `notexample.com`.
pub fn domain_matches(rule: &str, host: &str) -> bool {
    host == rule || host.ends_with(&format!(".{rule}"))
}

fn normalize_category(category: &str) -> Result<String, WebGuardError> {
    match category.trim().to_ascii_lowercase().as_str() {
        "malware" => Ok("malware".to_string()),
        "phishing" => Ok("phishing".to_string()),
        other => Err(WebGuardError::InvalidCategory(other.to_string())),
    }
}

fn sanitize_source_name(name: &str) -> String {
    let mut value: String = name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_' | ' ') {
                character
            } else {
                '_'
            }
        })
        .collect();
    value = value.trim().trim_matches('.').to_string();
    if value.len() > 80 {
        value.truncate(80);
    }
    value
}

fn sanitize_note(note: &str) -> String {
    let mut value: String = note
        .chars()
        .filter(|character| !character.is_control())
        .take(200)
        .collect();
    value = value.trim().to_string();
    value
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn hex_sha256(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[derive(Debug, Default)]
struct ParsedFilter {
    domains: BTreeSet<String>,
    ignored_lines: usize,
}

fn parse_filter(bytes: &[u8]) -> Result<ParsedFilter, WebGuardError> {
    let text = std::str::from_utf8(bytes).map_err(|_| WebGuardError::InvalidEncoding)?;
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut parsed = ParsedFilter::default();
    for (index, line) in text.lines().enumerate() {
        if index > 500_000 {
            break;
        }
        if line.len() > MAX_IMPORT_LINE_BYTES {
            parsed.ignored_lines += 1;
            continue;
        }
        let without_comment = line
            .split(['#', '!', ';'])
            .next()
            .unwrap_or_default()
            .trim();
        if without_comment.is_empty() {
            continue;
        }
        let tokens: Vec<&str> = without_comment.split_whitespace().collect();
        if tokens.is_empty() {
            continue;
        }
        let mut candidates: Vec<&str> = if tokens.len() > 1 && looks_like_ip(tokens[0]) {
            tokens[1..].to_vec()
        } else {
            vec![without_comment]
        };
        if candidates.len() > 16 {
            candidates.truncate(16);
        }
        for token in candidates {
            match normalize_domain(token) {
                Ok(domain) => {
                    parsed.domains.insert(domain);
                }
                Err(_) => parsed.ignored_lines += 1,
            }
        }
    }
    Ok(parsed)
}

fn looks_like_ip(token: &str) -> bool {
    token.parse::<Ipv4Addr>().is_ok() || token.parse::<Ipv6Addr>().is_ok()
}

// ---------------------------------------------------------------------------
// DNS wire format and loopback prototype
// ---------------------------------------------------------------------------

#[derive(Debug)]
struct ParsedQuery {
    qname: String,
    question_end: usize,
}

fn parse_query(packet: &[u8]) -> Result<ParsedQuery, String> {
    if packet.len() < 12 {
        return Err("en-tête DNS trop court".to_string());
    }
    let qdcount = u16::from_be_bytes([packet[4], packet[5]]);
    if qdcount != 1 {
        return Err("une seule question DNS est acceptée".to_string());
    }
    let mut offset = 12usize;
    let mut labels: Vec<String> = Vec::new();
    let mut wire_len = 0usize;
    loop {
        if offset >= packet.len() {
            return Err("question DNS tronquée".to_string());
        }
        let length = packet[offset] as usize;
        offset += 1;
        if length == 0 {
            break;
        }
        if length & 0xC0 != 0 {
            return Err("compression DNS non acceptée dans la question".to_string());
        }
        if length > 63 || offset + length > packet.len() {
            return Err("label DNS invalide".to_string());
        }
        wire_len += length + 1;
        if wire_len > 255 {
            return Err("nom DNS trop long".to_string());
        }
        let label = std::str::from_utf8(&packet[offset..offset + length])
            .map_err(|_| "label DNS non UTF-8".to_string())?;
        labels.push(label.to_string());
        offset += length;
    }
    if offset + 4 > packet.len() {
        return Err("type/classe DNS tronqué".to_string());
    }
    let question_end = offset + 4;
    let qname = normalize_domain(&labels.join(".")).map_err(|err| err.to_string())?;
    Ok(ParsedQuery {
        qname,
        question_end,
    })
}

fn error_response(packet: &[u8], question_end: usize, rcode: u8) -> Vec<u8> {
    let question_end = question_end.min(packet.len());
    let mut response = Vec::with_capacity(question_end);
    response.extend_from_slice(&packet[..2]);
    let request_flags = if packet.len() >= 4 {
        u16::from_be_bytes([packet[2], packet[3]])
    } else {
        0
    };
    let flags = 0x8000u16 | (request_flags & 0x0100) | 0x0080u16 | (rcode as u16 & 0x000F);
    response.extend_from_slice(&flags.to_be_bytes());
    response.extend_from_slice(&[0, 1, 0, 0, 0, 0, 0, 0]);
    if question_end > 12 {
        response.extend_from_slice(&packet[12..question_end]);
    }
    response
}

fn build_query(domain: &str, id: u16) -> Result<Vec<u8>, WebGuardError> {
    let host = normalize_domain(domain)?;
    let mut packet = Vec::with_capacity(64);
    packet.extend_from_slice(&id.to_be_bytes());
    packet.extend_from_slice(&0x0100u16.to_be_bytes()); // recursion desired
    packet.extend_from_slice(&1u16.to_be_bytes()); // QDCOUNT
    packet.extend_from_slice(&[0; 6]);
    for label in host.split('.') {
        if label.len() > 63 {
            return Err(WebGuardError::InvalidDomain(domain.to_string()));
        }
        packet.push(label.len() as u8);
        packet.extend_from_slice(label.as_bytes());
    }
    packet.push(0);
    packet.extend_from_slice(&1u16.to_be_bytes()); // A
    packet.extend_from_slice(&1u16.to_be_bytes()); // IN
    Ok(packet)
}

fn response_rcode(packet: &[u8]) -> Option<u8> {
    if packet.len() < 4 || packet[2] & 0x80 == 0 {
        None
    } else {
        Some(packet[3] & 0x0F)
    }
}

fn upstream_response(
    query: &[u8],
    upstreams: &[SocketAddr],
) -> Result<(Vec<u8>, SocketAddr), String> {
    let mut last_error = "aucun résolveur disponible".to_string();
    for upstream in upstreams {
        let local: SocketAddr = if upstream.is_ipv6() {
            SocketAddr::new(IpAddr::V6(Ipv6Addr::UNSPECIFIED), 0)
        } else {
            SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), 0)
        };
        let socket = match UdpSocket::bind(local) {
            Ok(socket) => socket,
            Err(err) => {
                last_error = err.to_string();
                continue;
            }
        };
        if let Err(err) = socket.set_read_timeout(Some(UPSTREAM_TIMEOUT)) {
            last_error = err.to_string();
            continue;
        }
        if let Err(err) = socket.send_to(query, upstream) {
            last_error = err.to_string();
            continue;
        }
        let mut buffer = [0u8; MAX_DNS_PACKET];
        match socket.recv_from(&mut buffer) {
            Ok((size, _)) if size >= 12 && buffer[..2] == query[..2] => {
                return Ok((buffer[..size].to_vec(), *upstream));
            }
            Ok((_, _)) => {
                last_error = "réponse DNS inattendue".to_string();
            }
            Err(err) => {
                last_error = err.to_string();
            }
        }
    }
    Err(last_error)
}

fn proxy_loop(
    guard: Arc<WebGuard>,
    socket: UdpSocket,
    upstreams: Vec<SocketAddr>,
    stop: Arc<AtomicBool>,
) {
    let mut buffer = [0u8; MAX_DNS_PACKET];
    while !stop.load(Ordering::SeqCst) {
        let (size, peer) = match socket.recv_from(&mut buffer) {
            Ok(value) => value,
            Err(err)
                if matches!(
                    err.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                ) =>
            {
                continue;
            }
            Err(_) => break,
        };
        if !peer.ip().is_loopback() || size < 12 {
            continue;
        }
        let started = Instant::now();
        let query = &buffer[..size];
        let parsed = match parse_query(query) {
            Ok(value) => value,
            Err(err) => {
                let _ = socket.send_to(&error_response(query, query.len(), 1), peer);
                guard.record_event(WebGuardEvent {
                    id: event_id(),
                    occurred_at: now(),
                    domain: "?".to_string(),
                    action: "error".to_string(),
                    category: None,
                    matched_rule: None,
                    source: "prototypeProxy".to_string(),
                    upstream: None,
                    latency_ms: None,
                    detail: format!("requête DNS refusée : {err}"),
                });
                continue;
            }
        };

        let verdict = guard.classify(&parsed.qname).ok();
        let blocked = verdict
            .as_ref()
            .map(|verdict| verdict.action == "blocked")
            .unwrap_or(false);
        if blocked {
            let response = error_response(query, parsed.question_end, 3);
            let _ = socket.send_to(&response, peer);
            if let Some(verdict) = verdict {
                guard.record_event(WebGuardEvent {
                    id: event_id(),
                    occurred_at: now(),
                    domain: parsed.qname,
                    action: "blocked".to_string(),
                    category: verdict.category,
                    matched_rule: verdict.matched_rule,
                    source: "prototypeProxy".to_string(),
                    upstream: None,
                    latency_ms: Some(started.elapsed().as_millis() as u64),
                    detail: "réponse NXDOMAIN locale ; aucune requête envoyée au résolveur système"
                        .to_string(),
                });
            }
            continue;
        }

        match upstream_response(query, &upstreams) {
            Ok((response, upstream)) => {
                let rcode = response_rcode(&response).unwrap_or(255);
                let _ = socket.send_to(&response, peer);
                guard.record_event(WebGuardEvent {
                    id: event_id(),
                    occurred_at: now(),
                    domain: parsed.qname,
                    action: if rcode == 0 { "allowed" } else { "error" }.to_string(),
                    category: verdict
                        .as_ref()
                        .and_then(|verdict| verdict.category.clone()),
                    matched_rule: None,
                    source: "prototypeProxy".to_string(),
                    upstream: Some(upstream.to_string()),
                    latency_ms: Some(started.elapsed().as_millis() as u64),
                    detail: if rcode == 0 {
                        "réponse relayée depuis le résolveur système".to_string()
                    } else {
                        format!("le résolveur a répondu RCODE {rcode}")
                    },
                });
            }
            Err(err) => {
                let _ = socket.send_to(&error_response(query, parsed.question_end, 2), peer);
                guard.record_event(WebGuardEvent {
                    id: event_id(),
                    occurred_at: now(),
                    domain: parsed.qname,
                    action: "error".to_string(),
                    category: None,
                    matched_rule: None,
                    source: "prototypeProxy".to_string(),
                    upstream: None,
                    latency_ms: Some(started.elapsed().as_millis() as u64),
                    detail: format!("résolveur système indisponible : {err}"),
                });
            }
        }
    }
    if let Ok(mut runtime) = guard.proxy.lock() {
        if let Some(stop) = runtime.stop.as_ref() {
            if stop.load(Ordering::SeqCst) {
                runtime.last_error = None;
            }
        }
    }
}

/// Bind the loopback resolver on 5353, then on the next free port. Windows
/// mDNS/Bonjour commonly owns UDP 5353; failing the whole prototype in that
/// case would make the feature unusable without any security benefit.
fn bind_proxy_socket() -> Result<(UdpSocket, SocketAddr), WebGuardError> {
    const LAST_PORT: u16 = PROXY_PORT + 7;
    let mut last: Option<(SocketAddr, io::Error)> = None;
    for port in PROXY_PORT..=LAST_PORT {
        let bind = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
        match UdpSocket::bind(bind) {
            Ok(socket) => return Ok((socket, bind)),
            Err(err) => last = Some((bind, err)),
        }
    }
    let (bind, err) = last.expect("the port range is never empty");
    Err(WebGuardError::ProxyStart(format!(
        "{bind} : {err} (ports {PROXY_PORT}-{LAST_PORT} indisponibles)"
    )))
}

fn query_loopback(domain: &str, endpoint: &str) -> Result<(u8, u64), String> {
    let id = (Utc::now().timestamp_millis() as u16) ^ 0xA5C3;
    let packet = build_query(domain, id).map_err(|err| err.to_string())?;
    let bind = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0);
    let socket = UdpSocket::bind(bind).map_err(|err| err.to_string())?;
    socket
        .set_read_timeout(Some(Duration::from_secs(4)))
        .map_err(|err| err.to_string())?;
    let endpoint: SocketAddr = endpoint
        .parse()
        .map_err(|err: std::net::AddrParseError| err.to_string())?;
    let started = Instant::now();
    socket
        .send_to(&packet, endpoint)
        .map_err(|err| err.to_string())?;
    let mut buffer = [0u8; MAX_DNS_PACKET];
    let (size, _) = socket
        .recv_from(&mut buffer)
        .map_err(|err| err.to_string())?;
    if size < 12 || buffer[..2] != packet[..2] {
        return Err("réponse DNS locale invalide".to_string());
    }
    let rcode = response_rcode(&buffer[..size]).unwrap_or(255);
    Ok((rcode, started.elapsed().as_millis() as u64))
}

fn event_id() -> String {
    format!(
        "{}-{}",
        Utc::now().timestamp_nanos_opt().unwrap_or_default(),
        std::process::id()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn guard() -> (tempfile::TempDir, Arc<WebGuard>) {
        let dir = tempfile::tempdir().unwrap();
        let guard = Arc::new(WebGuard::load(dir.path().join("webguard.json")));
        (dir, guard)
    }

    #[test]
    fn normalizes_and_rejects_domains() {
        assert_eq!(normalize_domain(" Example.COM. ").unwrap(), "example.com");
        assert_eq!(
            normalize_domain("||Ads.Example.com^").unwrap(),
            "ads.example.com"
        );
        assert_eq!(normalize_domain("*.example.com").unwrap(), "example.com");
        assert!(normalize_domain("https://example.com").is_err());
        assert!(normalize_domain("exa mple.com").is_err());
        assert!(normalize_domain("example..com").is_err());
        assert!(normalize_domain("-bad.example").is_err());
        assert!(normalize_domain("example.com:443").is_err());
    }

    #[test]
    fn subdomain_matching_is_label_aware() {
        assert!(domain_matches("example.com", "example.com"));
        assert!(domain_matches("example.com", "cdn.example.com"));
        assert!(!domain_matches("example.com", "notexample.com"));
        assert!(!domain_matches("example.com", "example.com.evil.test"));
    }

    #[test]
    fn allowlist_wins_over_blocklist() {
        let (_dir, guard) = guard();
        guard
            .import_filter(
                &write_filter("0.0.0.0 ads.example.test\nphishing.test\n"),
                "malware",
                true,
                Some("fixture".to_string()),
            )
            .unwrap();
        assert_eq!(
            guard.classify("cdn.ads.example.test").unwrap().action,
            "blocked"
        );
        guard
            .add_allowlist("ads.example.test", "faux positif documenté")
            .unwrap();
        let verdict = guard.classify("cdn.ads.example.test").unwrap();
        assert_eq!(verdict.action, "allowed");
        assert_eq!(verdict.reason, "allowlist");
        assert_eq!(verdict.allowlist_rule.as_deref(), Some("ads.example.test"));
    }

    #[test]
    fn hosts_file_import_is_deduplicated_and_metadata_is_bounded() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hosts.txt");
        fs::write(
            &path,
            "# fixture\n0.0.0.0 ads.test\n127.0.0.1 tracker.test\n0.0.0.0 ads.test\ninvalid domain\n",
        )
        .unwrap();
        let guard = WebGuard::load(dir.path().join("state.json"));
        let result = guard.import_filter(&path, "phishing", true, None).unwrap();
        assert_eq!(result.added, 2);
        assert_eq!(result.ignored_lines, 1);
        assert_eq!(result.total_blocklist, 2);
        assert_eq!(guard.view().filters[0].entry_count, 2);
        assert!(guard.view().filters[0].name.starts_with("hosts"));
    }

    #[test]
    fn corrupt_import_keeps_previous_list() {
        let (_dir, guard) = guard();
        let valid = write_filter("blocked.test\n");
        guard.import_filter(&valid, "malware", true, None).unwrap();
        let invalid = write_filter("this is not a domain\n");
        assert!(matches!(
            guard.import_filter(&invalid, "malware", true, None),
            Err(WebGuardError::ImportEmpty)
        ));
        assert_eq!(guard.view().counts.blocklist, 1);
    }

    #[test]
    fn non_utf8_import_is_rejected_without_replacing_the_previous_list() {
        let dir = tempfile::tempdir().unwrap();
        let guard = WebGuard::load(dir.path().join("state.json"));
        let valid = dir.path().join("valid.txt");
        fs::write(&valid, "blocked.test\n").unwrap();
        guard.import_filter(&valid, "malware", true, None).unwrap();

        let corrupt = dir.path().join("corrupt.txt");
        fs::write(&corrupt, [0xff, 0xfe, 0x00, 0x62, 0x6c, 0x6f, 0x63, 0x6b]).unwrap();
        assert!(matches!(
            guard.import_filter(&corrupt, "malware", true, None),
            Err(WebGuardError::InvalidEncoding)
        ));
        assert_eq!(guard.view().counts.blocklist, 1);
    }

    #[test]
    fn confirmation_is_mandatory_for_destructive_actions() {
        let (_dir, guard) = guard();
        assert!(matches!(
            guard.clear_history(false),
            Err(WebGuardError::ConfirmationRequired)
        ));
        assert!(matches!(
            guard.clear_blocklist(false),
            Err(WebGuardError::ConfirmationRequired)
        ));
    }

    #[test]
    fn history_is_bounded_and_persisted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("webguard.json");
        let guard = Arc::new(WebGuard::load(&path));
        for index in 0..(MAX_HISTORY_EVENTS + 5) {
            guard.record_event(WebGuardEvent {
                id: format!("e{index}"),
                occurred_at: now(),
                domain: "example.test".to_string(),
                action: "allowed".to_string(),
                category: None,
                matched_rule: None,
                source: "test".to_string(),
                upstream: None,
                latency_ms: Some(1),
                detail: String::new(),
            });
        }
        let view = guard.view();
        assert_eq!(view.events.len(), MAX_HISTORY_EVENTS);
        assert_eq!(view.events[0].id, format!("e{}", MAX_HISTORY_EVENTS + 4));
        drop(guard);
        let reloaded = WebGuard::load(&path);
        assert_eq!(reloaded.view().events.len(), MAX_HISTORY_EVENTS);
    }

    #[test]
    fn proxy_bind_stays_on_loopback_and_in_the_expected_port_range() {
        let (_socket, endpoint) = bind_proxy_socket().unwrap();
        assert!(endpoint.ip().is_loopback());
        assert!((PROXY_PORT..=PROXY_PORT + 7).contains(&endpoint.port()));
    }

    #[test]
    fn dns_parser_accepts_a_single_question_and_builds_error_response() {
        let query = build_query("ads.example.test", 0x1234).unwrap();
        let parsed = parse_query(&query).unwrap();
        assert_eq!(parsed.qname, "ads.example.test");
        let response = error_response(&query, parsed.question_end, 3);
        assert_eq!(response[..2], [0x12, 0x34]);
        assert_eq!(response[3] & 0x0F, 3);
        assert_eq!(response_rcode(&response), Some(3));
        assert_eq!(
            parse_query(&query[..10]).unwrap_err(),
            "en-tête DNS trop court"
        );
    }

    #[test]
    fn import_rejects_wrong_category() {
        let (_dir, guard) = guard();
        let valid = write_filter("blocked.test\n");
        assert!(matches!(
            guard.import_filter(&valid, "unknown", true, None),
            Err(WebGuardError::InvalidCategory(_))
        ));
    }

    fn write_filter(contents: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "cbs-webguard-fixture-{}.txt",
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::write(&path, contents).unwrap();
        path
    }
}
