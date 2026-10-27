//! CBS Shield firewall foundation — strictly read-only inspection of the
//! Microsoft Defender Firewall configuration.
//!
//! Sources: the documented COM API `INetFwPolicy2` (via the audited wrapper
//! crate `windows_firewall`, which only exposes the documented Win32 calls,
//! plus the `windows` crate for the per-profile default actions).
//!
//! Hard guarantees of this crate:
//! - no rule is ever created, modified, enabled or disabled — the crate
//!   deliberately does not depend on any mutation feature of the wrapper;
//! - no kernel driver, WFP filter or third-party firewall (Portmaster, …) is
//!   installed or loaded;
//! - Windows Defender itself is never touched (no exclusions, no state
//!   change): only firewall *profile* and *rule* state is read;
//! - reading does not require administrator privileges.
//!
//! Provided data (Phase 2 foundation):
//! - per-profile enable state (Domain, Private, Public) and default
//!   inbound/outbound actions,
//! - the active profile bitmask,
//! - the existing rules (bounded copy) plus the true total count,
//! - deterministic rule/profile fingerprints and a composite configuration
//!   fingerprint for change detection,
//! - honest, machine-readable security alerts derived from the live state.
//!
//! Sprint 5 adds the fingerprints and alerts only. Mutating the firewall is
//! still deliberately out of scope: no `put_*` call and no mutation feature of
//! the wrapper is linked into this crate.

use sha2::{Digest, Sha256};

/// Bound on rules returned for display; the true total is reported separately
/// so a truncated list can never be mistaken for the complete configuration.
pub const MAX_RULES_LISTED: usize = 1_000;

#[derive(Debug, thiserror::Error)]
pub enum FirewallError {
    #[error("pare-feu Windows indisponible : {0}")]
    Unavailable(String),
}

/// Enable state and default behaviour of one firewall profile.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileStatus {
    pub profile: String,
    pub enabled: bool,
    pub inbound_default: String,
    pub outbound_default: String,
}

/// One firewall rule, reduced to read-only display fields.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleSummary {
    pub name: String,
    pub grouping: String,
    pub description: String,
    pub application_name: String,
    pub service_name: String,
    pub direction: String,
    pub action: String,
    pub enabled: bool,
    pub protocol: String,
    pub local_ports: String,
    pub remote_ports: String,
    pub profiles: String,
}

/// One complete observation of the firewall configuration.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirewallStatus {
    pub checked_at: String,
    pub profiles: Vec<ProfileStatus>,
    /// Bitmask of profiles Windows currently applies, as display labels.
    pub active_profiles: Vec<String>,
    /// Rules listed for display (bounded by [`MAX_RULES_LISTED`]).
    pub rules: Vec<RuleSummary>,
    /// Actual number of rules in the policy — larger than `rules.len()`
    /// means the display list was truncated.
    pub rules_total_count: u32,
    /// Deterministic fingerprint of the full rule set (see `rules_fingerprint`).
    pub rules_hash: String,
    /// Deterministic fingerprint of the profile state and defaults.
    pub profiles_hash: String,
    /// Composite fingerprint covering profiles, defaults and rules.
    pub configuration_hash: String,
}

/// Machine-readable security alert. The UI owns the French/English wording.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FirewallAlert {
    /// Stable identifier, e.g. `all_profiles_disabled`.
    pub code: String,
    /// `danger`, `warning` or `info`.
    pub severity: String,
    /// Profile label when the alert is profile-specific.
    pub profile: Option<String>,
}

// ---------------------------------------------------------------------------
// Display mapping helpers (unit-tested, no COM involved).
// ---------------------------------------------------------------------------

/// Display label of the `Direction` enum.
pub fn direction_label(direction: &windows_firewall::Direction) -> String {
    use windows_firewall::Direction;
    match direction {
        Direction::In => "entrant".to_string(),
        Direction::Out => "sortant".to_string(),
        other => format!("{other:?}"),
    }
}

/// Display label of the `Action` enum.
pub fn action_label(action: &windows_firewall::Action) -> String {
    use windows_firewall::Action;
    match action {
        Action::Allow => "autoriser".to_string(),
        Action::Block => "bloquer".to_string(),
        other => format!("{other:?}"),
    }
}

/// Display label of the `Protocol` option (`None` on a rule means "any").
pub fn protocol_label(protocol: &Option<windows_firewall::Protocol>) -> String {
    use windows_firewall::Protocol;
    match protocol {
        Some(Protocol::Tcp) => "tcp".to_string(),
        Some(Protocol::Udp) => "udp".to_string(),
        Some(other) => format!("{other:?}").to_lowercase(),
        None => "tout".to_string(),
    }
}

/// Display label of the `Profile` option (`None` on a rule means "all").
pub fn rule_profile_label(profile: &Option<windows_firewall::Profile>) -> String {
    use windows_firewall::Profile;
    match profile {
        Some(Profile::Domain) => "domaine".to_string(),
        Some(Profile::Private) => "privé".to_string(),
        Some(Profile::Public) => "public".to_string(),
        Some(other) => format!("{other:?}"),
        None => "tous".to_string(),
    }
}

/// Display label of a `Port` token: plain numbers render bare (`443`), named
/// keywords keep their text.
fn port_token_label(port: &windows_firewall::Port) -> String {
    let debug = format!("{port:?}");
    if let Some(number) = debug
        .strip_prefix("Number(")
        .and_then(|rest| rest.strip_suffix(')'))
    {
        return number.to_string();
    }
    debug
}

pub fn ports_label(ports: Option<std::collections::HashSet<windows_firewall::Port>>) -> String {
    match ports {
        None => "tout".to_string(),
        Some(set) if set.is_empty() => String::new(),
        Some(set) => {
            let mut tokens: Vec<String> = set.iter().map(port_token_label).collect();
            tokens.sort();
            tokens.join(", ")
        }
    }
}

/// Display labels for a `NET_FW_PROFILE2_*` bitmask (whole-policy level).
pub fn profile_labels(mask: u32) -> Vec<String> {
    let mut labels = Vec::new();
    if mask & 0x1 != 0 {
        labels.push("domaine".to_string());
    }
    if mask & 0x2 != 0 {
        labels.push("privé".to_string());
    }
    if mask & 0x4 != 0 {
        labels.push("public".to_string());
    }
    labels
}

/// Deterministic fingerprint of a rule set, used for change detection.
///
/// The rule list is sorted by (name, application, direction, action) so the
/// fingerprint does not depend on COM enumeration order or on the bounded cut.
/// Extra rule properties (e.g. per-rule addresses) are not part of the
/// fingerprint — a documented, honest limitation.
pub fn rules_fingerprint(rules: &[RuleSummary], total_count: u32) -> String {
    let mut lines: Vec<String> = rules
        .iter()
        .map(|rule| {
            format!(
                "{}\x1f{}\x1f{}\x1f{}\x1f{}\x1f{}",
                rule.name.to_lowercase(),
                rule.enabled,
                rule.direction,
                rule.action,
                rule.application_name.to_lowercase(),
                rule.grouping.to_lowercase(),
            )
        })
        .collect();
    lines.sort();
    let mut hasher = Sha256::new();
    for line in lines {
        hasher.update(line.as_bytes());
        hasher.update(b"\x1e");
    }
    hasher.update(total_count.to_le_bytes());
    format!("{:x}", hasher.finalize())
}

/// Deterministic fingerprint of the per-profile enable state, default actions
/// and currently active profiles. Used together with [`rules_fingerprint`] so
/// that disabling a profile or changing its default action is also detected.
pub fn profiles_fingerprint(profiles: &[ProfileStatus], active_profiles: &[String]) -> String {
    let mut lines: Vec<String> = profiles
        .iter()
        .map(|profile| {
            format!(
                "{}\x1f{}\x1f{}\x1f{}",
                profile.profile.to_lowercase(),
                profile.enabled,
                profile.inbound_default.to_lowercase(),
                profile.outbound_default.to_lowercase(),
            )
        })
        .collect();
    lines.sort();
    let mut active = active_profiles
        .iter()
        .map(|label| label.to_lowercase())
        .collect::<Vec<_>>();
    active.sort();

    let mut hasher = Sha256::new();
    hasher.update(b"cbs-firewall-profiles-v1\x1e");
    for line in lines {
        hasher.update(line.as_bytes());
        hasher.update(b"\x1e");
    }
    hasher.update(b"active\x1e");
    for label in active {
        hasher.update(label.as_bytes());
        hasher.update(b"\x1e");
    }
    format!("{:x}", hasher.finalize())
}

/// Composite configuration fingerprint (profiles + defaults + rules).
pub fn configuration_fingerprint(
    profiles_hash: &str,
    rules_hash: &str,
    rules_total_count: u32,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"cbs-firewall-configuration-v2\x1e");
    hasher.update(profiles_hash.as_bytes());
    hasher.update(b"\x1e");
    hasher.update(rules_hash.as_bytes());
    hasher.update(b"\x1e");
    hasher.update(rules_total_count.to_le_bytes());
    format!("{:x}", hasher.finalize())
}

/// Derive honest security alerts from a real observation.
///
/// These are *observations*, not remediation advice. CBS Shield never changes
/// the Microsoft Defender Firewall state.
pub fn security_alerts(status: &FirewallStatus) -> Vec<FirewallAlert> {
    let mut alerts = Vec::new();
    let disabled: Vec<&str> = status
        .profiles
        .iter()
        .filter(|profile| !profile.enabled)
        .map(|profile| profile.profile.as_str())
        .collect();

    if status.profiles.len() >= 3 && disabled.len() == status.profiles.len() {
        alerts.push(FirewallAlert {
            code: "all_profiles_disabled".to_string(),
            severity: "danger".to_string(),
            profile: None,
        });
    } else {
        for profile in disabled {
            alerts.push(FirewallAlert {
                code: "profile_disabled".to_string(),
                severity: "warning".to_string(),
                profile: Some(profile.to_string()),
            });
        }
    }

    for profile in &status.profiles {
        if profile.enabled && profile.inbound_default == "autoriser" {
            alerts.push(FirewallAlert {
                code: "inbound_default_allow".to_string(),
                severity: "warning".to_string(),
                profile: Some(profile.profile.clone()),
            });
        }
    }

    alerts
}

// ---------------------------------------------------------------------------
// COM-backed capture.
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod inspect {
    use super::*;
    use windows::Win32::NetworkManagement::WindowsFirewall::{
        INetFwPolicy2, NetFwPolicy2, NET_FW_PROFILE_TYPE2,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_MULTITHREADED,
    };
    use windows_firewall::Profile;

    // Frozen Win32 values (msdn `NET_FW_PROFILE_TYPE2`): DOMAIN=0x1,
    // PRIVATE=0x2, PUBLIC=0x4. (0x3 is NOT a valid profile type — using it
    // made `get_DefaultInboundAction(0x3)` fail and silently blanked the
    // whole profile-details read.)
    const PROFILE_TYPE_DOMAIN: NET_FW_PROFILE_TYPE2 = NET_FW_PROFILE_TYPE2(1);
    const PROFILE_TYPE_PRIVATE: NET_FW_PROFILE_TYPE2 = NET_FW_PROFILE_TYPE2(2);
    const PROFILE_TYPE_PUBLIC: NET_FW_PROFILE_TYPE2 = NET_FW_PROFILE_TYPE2(4);

    fn rule_summary(rule: &windows_firewall::FirewallRule) -> RuleSummary {
        RuleSummary {
            name: rule.name().clone(),
            grouping: rule.grouping().clone().unwrap_or_default(),
            description: rule.description().clone().unwrap_or_default(),
            application_name: rule.application_name().clone().unwrap_or_default(),
            service_name: rule.service_name().clone().unwrap_or_default(),
            direction: direction_label(rule.direction()),
            action: action_label(rule.action()),
            enabled: *rule.enabled(),
            protocol: protocol_label(rule.protocol()),
            local_ports: ports_label(rule.local_ports().clone()),
            remote_ports: ports_label(rule.remote_ports().clone()),
            profiles: rule_profile_label(rule.profiles()),
        }
    }

    /// Profile defaults per label: `(label, inbound, outbound)`.
    type ProfileActions = Vec<(String, String, String)>;
    /// Read-only COM session collecting the per-profile default actions and
    /// the currently active profile bitmask.
    ///
    /// The COM apartment model MUST be multithreaded here: these reads run on
    /// reused tokio blocking threads that the `windows_firewall` calls have
    /// already initialised as MTA, and a conflicting `COINIT_APARTMENTTHREADED`
    /// request silently breaks every subsequent property read (observed live:
    /// the profile defaults came back as errors). `CoInitializeEx` may still
    /// fail for an unrelated reason; in that case we try the read anyway and
    /// simply never call `CoUninitialize` for an initialisation we do not own.
    /// If the policy object cannot be created either, "None" is returned — the
    /// UI then shows the honest "unknown" default-action label instead of an
    /// invented value.
    fn com_profile_details() -> Option<(ProfileActions, Option<Vec<String>>)> {
        // SAFETY: COM initialisation is balanced only when this call actually
        // succeeded; every interface call below is a documented read-only
        // property access (no put_* is ever invoked).
        let com_result = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        let owns_apartment = com_result.is_ok();

        let result = (|| {
            // SAFETY: see comment above; parameters are the documented
            // `CLSCTX_INPROC_SERVER` instantiation of the class `NetFwPolicy2`.
            let policy: INetFwPolicy2 =
                unsafe { CoCreateInstance(&NetFwPolicy2, None, CLSCTX_INPROC_SERVER) }.ok()?;
            let mut actions = Vec::new();
            for (kind, label) in [
                (PROFILE_TYPE_DOMAIN, "domaine".to_string()),
                (PROFILE_TYPE_PRIVATE, "privé".to_string()),
                (PROFILE_TYPE_PUBLIC, "public".to_string()),
            ] {
                let inbound = unsafe { policy.get_DefaultInboundAction(kind) }.ok()?.0;
                let outbound = unsafe { policy.get_DefaultOutboundAction(kind) }.ok()?.0;
                let to_label = |value: i32| match value & 0xFFFF {
                    0 => "bloquer".to_string(),
                    1 => "autoriser".to_string(),
                    // msdn `NET_FW_ACTION_MAX` — Windows reports
                    // "NotConfigured" through this value.
                    3 => "non configuré".to_string(),
                    other => format!("{other}"),
                };
                actions.push((
                    label,
                    to_label(inbound & 0xFFFF),
                    to_label(outbound & 0xFFFF),
                ));
            }
            // `CurrentProfileTypes` returns a bitmask that can combine several
            // profiles (e.g. private|public = 6), which single-profile enums
            // cannot represent — hence the direct read.
            let active_mask = unsafe { policy.CurrentProfileTypes() }
                .ok()
                .map(|value| super::profile_labels((value & 0xFFFF) as u32 & 0x7));
            Some((actions, active_mask))
        })();

        if owns_apartment {
            // SAFETY: balanced CoInitializeEx above.
            unsafe { CoUninitialize() };
        }
        result
    }

    /// Perform one billed read-only observation of the firewall configuration.
    pub fn inspect() -> Result<FirewallStatus, FirewallError> {
        let enabled_domain = windows_firewall::get_firewall_state(Profile::Domain);
        let enabled_private = windows_firewall::get_firewall_state(Profile::Private);
        let enabled_public = windows_firewall::get_firewall_state(Profile::Public);
        for attempt in [&enabled_domain, &enabled_private, &enabled_public] {
            if let Err(err) = attempt {
                return Err(FirewallError::Unavailable(err.to_string()));
            }
        }

        let (defaults, active_labels) = com_profile_details().unwrap_or_else(|| (Vec::new(), None));
        let total = windows_firewall::count_rules();
        let all_rules = windows_firewall::list_rules();
        if let Err(err) = &total {
            return Err(FirewallError::Unavailable(err.to_string()));
        }
        if let Err(err) = &all_rules {
            return Err(FirewallError::Unavailable(err.to_string()));
        }

        let mut listed: Vec<RuleSummary> = all_rules
            .unwrap()
            .iter()
            .map(rule_summary)
            .take(MAX_RULES_LISTED)
            .collect();
        let total_count = total.unwrap().max(0) as u32;
        listed.sort_by(|a, b| {
            a.name
                .to_lowercase()
                .cmp(&b.name.to_lowercase())
                .then_with(|| {
                    a.application_name
                        .to_lowercase()
                        .cmp(&b.application_name.to_lowercase())
                })
        });

        let get_default = |label: &str| -> (String, String) {
            defaults
                .iter()
                .find(|(candidate, _, _)| candidate == label)
                .map(|(_, inbound, outbound)| (inbound.clone(), outbound.clone()))
                .unwrap_or_else(|| ("inconnu".to_string(), "inconnu".to_string()))
        };
        let (in_domain, out_domain) = get_default("domaine");
        let (in_private, out_private) = get_default("privé");
        let (in_public, out_public) = get_default("public");

        let enabled = [
            enabled_domain.unwrap(),
            enabled_private.unwrap(),
            enabled_public.unwrap(),
        ];

        let profiles = vec![
            ProfileStatus {
                profile: "domaine".to_string(),
                enabled: enabled[0],
                inbound_default: in_domain,
                outbound_default: out_domain,
            },
            ProfileStatus {
                profile: "privé".to_string(),
                enabled: enabled[1],
                inbound_default: in_private,
                outbound_default: out_private,
            },
            ProfileStatus {
                profile: "public".to_string(),
                enabled: enabled[2],
                inbound_default: in_public,
                outbound_default: out_public,
            },
        ];
        let active_profiles = active_labels.unwrap_or_default();
        let rules_hash = rules_fingerprint(&listed, total_count);
        let profiles_hash = profiles_fingerprint(&profiles, &active_profiles);
        let configuration_hash =
            configuration_fingerprint(&profiles_hash, &rules_hash, total_count);

        Ok(FirewallStatus {
            checked_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
            profiles,
            active_profiles,
            rules_total_count: total_count,
            rules_hash,
            profiles_hash,
            configuration_hash,
            rules: listed,
        })
    }
}

#[cfg(windows)]
pub use inspect::inspect;

#[cfg(not(windows))]
pub fn inspect() -> Result<FirewallStatus, FirewallError> {
    Err(FirewallError::Unavailable(
        "disponible uniquement sous Windows".to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(name: &str, enabled: bool, direction: &str, action: &str) -> RuleSummary {
        RuleSummary {
            name: name.to_string(),
            grouping: String::new(),
            description: String::new(),
            application_name: String::new(),
            service_name: String::new(),
            direction: direction.to_string(),
            action: action.to_string(),
            enabled,
            protocol: "tout".to_string(),
            local_ports: String::new(),
            remote_ports: String::new(),
            profiles: "tous".to_string(),
        }
    }

    #[test]
    fn fingerprint_is_stable_and_detects_changes() {
        let rules = [
            rule("Alpha", true, "entrant", "bloquer"),
            rule("Beta", true, "sortant", "autoriser"),
        ];
        let fingerprint = rules_fingerprint(&rules, 2);
        // Enumeration order must not matter.
        let reordered = [rules[1].clone(), rules[0].clone()];
        assert_eq!(fingerprint, rules_fingerprint(&reordered, 2));

        // A disabled rule changes the fingerprint.
        let mut changed = rules.to_vec();
        changed[0].enabled = false;
        assert_ne!(fingerprint, rules_fingerprint(&changed, 2));

        // Adding a rule changes the fingerprint.
        let mut added = rules.to_vec();
        added.push(rule("Gamma", false, "entrant", "bloquer"));
        assert_ne!(fingerprint, rules_fingerprint(&added, 3));

        // A change in the true total is also captured.
        assert_ne!(fingerprint, rules_fingerprint(&rules, 3));
    }

    #[test]
    fn empty_rules_fingerprint_differs_from_nonempty() {
        assert_ne!(
            rules_fingerprint(&[], 0),
            rules_fingerprint(&[rule("x", true, "entrant", "bloquer")], 1)
        );
    }

    fn profile(label: &str, enabled: bool, inbound: &str) -> ProfileStatus {
        ProfileStatus {
            profile: label.to_string(),
            enabled,
            inbound_default: inbound.to_string(),
            outbound_default: "autoriser".to_string(),
        }
    }

    fn status(profiles: Vec<ProfileStatus>, active: Vec<&str>) -> FirewallStatus {
        let rules = vec![rule("Alpha", true, "entrant", "bloquer")];
        let rules_hash = rules_fingerprint(&rules, 1);
        let active = active.into_iter().map(str::to_string).collect::<Vec<_>>();
        let profiles_hash = profiles_fingerprint(&profiles, &active);
        FirewallStatus {
            checked_at: "2026-10-26T09:00:00Z".to_string(),
            profiles,
            active_profiles: active,
            rules,
            rules_total_count: 1,
            rules_hash: rules_hash.clone(),
            profiles_hash: profiles_hash.clone(),
            configuration_hash: configuration_fingerprint(&profiles_hash, &rules_hash, 1),
        }
    }

    #[test]
    fn profile_fingerprint_tracks_enable_and_default_changes() {
        let base = status(
            vec![
                profile("domaine", true, "bloquer"),
                profile("privé", true, "bloquer"),
                profile("public", true, "bloquer"),
            ],
            vec!["privé"],
        );
        let same = status(
            vec![
                profile("public", true, "bloquer"),
                profile("domaine", true, "bloquer"),
                profile("privé", true, "bloquer"),
            ],
            vec!["privé"],
        );
        assert_eq!(
            base.profiles_hash, same.profiles_hash,
            "profile order must not matter"
        );

        let mut disabled = base.clone();
        disabled.profiles[1].enabled = false;
        disabled.profiles_hash =
            profiles_fingerprint(&disabled.profiles, &disabled.active_profiles);
        assert_ne!(base.profiles_hash, disabled.profiles_hash);

        let mut inbound_allowed = base.clone();
        inbound_allowed.profiles[2].inbound_default = "autoriser".to_string();
        inbound_allowed.profiles_hash =
            profiles_fingerprint(&inbound_allowed.profiles, &inbound_allowed.active_profiles);
        assert_ne!(base.profiles_hash, inbound_allowed.profiles_hash);
    }

    #[test]
    fn configuration_fingerprint_covers_both_parts() {
        assert_eq!(
            configuration_fingerprint("profiles", "rules", 7),
            configuration_fingerprint("profiles", "rules", 7)
        );
        assert_ne!(
            configuration_fingerprint("profiles", "rules", 7),
            configuration_fingerprint("profiles", "rules", 8)
        );
        assert_ne!(
            configuration_fingerprint("profiles", "rules", 7),
            configuration_fingerprint("other", "rules", 7)
        );
    }

    #[test]
    fn alerts_report_each_disabled_profile() {
        let observed = status(
            vec![
                profile("domaine", true, "bloquer"),
                profile("privé", false, "bloquer"),
                profile("public", false, "bloquer"),
            ],
            vec!["domaine"],
        );
        let alerts = security_alerts(&observed);
        assert_eq!(
            alerts
                .iter()
                .filter(|alert| alert.code == "profile_disabled")
                .count(),
            2
        );
        assert_eq!(alerts[0].severity, "warning");
    }

    #[test]
    fn alerts_escalate_when_all_profiles_are_disabled() {
        let observed = status(
            vec![
                profile("domaine", false, "bloquer"),
                profile("privé", false, "bloquer"),
                profile("public", false, "bloquer"),
            ],
            vec![],
        );
        let alerts = security_alerts(&observed);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].code, "all_profiles_disabled");
        assert_eq!(alerts[0].severity, "danger");
    }

    #[test]
    fn alerts_report_an_inbound_allow_default() {
        let observed = status(
            vec![
                profile("domaine", true, "bloquer"),
                profile("privé", true, "autoriser"),
                profile("public", false, "bloquer"),
            ],
            vec!["privé"],
        );
        let alerts = security_alerts(&observed);
        assert!(alerts.iter().any(|alert| {
            alert.code == "inbound_default_allow" && alert.profile.as_deref() == Some("privé")
        }));
        assert!(!alerts
            .iter()
            .any(|alert| alert.code == "inbound_default_allow"
                && alert.profile.as_deref() == Some("domaine")));
    }

    #[cfg(windows)]
    #[test]
    fn inspect_returns_a_real_configuration() {
        let status = inspect().expect("the firewall COM must be available on Windows");
        assert_eq!(status.profiles.len(), 3);
        for profile in &status.profiles {
            if profile.inbound_default != "inconnu" {
                assert!(
                    profile.inbound_default == "autoriser" || profile.inbound_default == "bloquer"
                );
            }
        }
        assert!(status.rules.len() <= MAX_RULES_LISTED);
        assert!(status.rules.len() <= status.rules_total_count as usize);
        assert_ne!(status.rules_hash, String::new());
        assert_ne!(status.profiles_hash, String::new());
        assert_ne!(status.configuration_hash, String::new());

        // Rules are sorted by name (deterministic display).
        for pair in status.rules.windows(2) {
            assert!(
                pair[0].name.to_lowercase() <= pair[1].name.to_lowercase(),
                "rules must be sorted by name"
            );
        }
    }
}
