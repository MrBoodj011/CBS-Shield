import {
  Activity,
  Archive,
  CheckCircle2,
  Download,
  FileCheck2,
  FileSearch,
  Filter,
  Flame,
  Gauge,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  Network,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "../components/Badge";
import { EmptyState } from "../components/EmptyState";
import { Modal } from "../components/Modal";
import { api, errorMessage } from "../lib/api";
import { formatDateTime, formatNumber, truncateMiddle } from "../lib/format";
import { useI18n } from "../lib/i18n";
import type {
  FirewallAlert,
  FirewallChange,
  FirewallConnections,
  FirewallObservation,
  FirewallRuleSummary,
  FirewallSnapshotExport,
  FirewallSnapshotInfo,
  FirewallSnapshotVerification,
  FirewallStatus,
  RuleManagementStatus,
} from "../types";

type Localize = (fr: string, en: string) => string;

function directionBadge(rule: FirewallRuleSummary, L: Localize) {
  return rule.direction === "entrant" ? (
    <Badge tone="info" dot>{L("Entrant", "Inbound")}</Badge>
  ) : rule.direction === "sortant" ? (
    <Badge tone="warning" dot>{L("Sortant", "Outbound")}</Badge>
  ) : (
    <Badge tone="neutral" dot>{rule.direction || "?"}</Badge>
  );
}

function actionBadge(rule: FirewallRuleSummary, L: Localize) {
  return rule.action === "bloquer" ? (
    <Badge tone="danger" dot>{L("Bloquer", "Block")}</Badge>
  ) : rule.action === "autoriser" ? (
    <Badge tone="ok" dot>{L("Autoriser", "Allow")}</Badge>
  ) : (
    <Badge tone="neutral" dot>{rule.action || "?"}</Badge>
  );
}

function ruleMatches(rule: FirewallRuleSummary, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return (
    rule.name.toLowerCase().includes(needle) ||
    rule.grouping.toLowerCase().includes(needle) ||
    rule.applicationName.toLowerCase().includes(needle) ||
    rule.description.toLowerCase().includes(needle) ||
    rule.protocol.toLowerCase().includes(needle) ||
    rule.localPorts.toLowerCase().includes(needle) ||
    rule.remotePorts.toLowerCase().includes(needle)
  );
}

type DirectionFilter = "all" | "inbound" | "outbound";
type ActionFilter = "all" | "allow" | "block";
type StateFilter = "all" | "enabled" | "disabled";
type ProtocolFilter = "all" | "tcp" | "udp" | "any";
type ProfileFilter = "all" | "domain" | "private" | "public";

interface RuleFilters {
  direction: DirectionFilter;
  action: ActionFilter;
  state: StateFilter;
  protocol: ProtocolFilter;
  profile: ProfileFilter;
}

const EMPTY_RULE_FILTERS: RuleFilters = {
  direction: "all",
  action: "all",
  state: "all",
  protocol: "all",
  profile: "all",
};

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

function ruleMatchesFilters(rule: FirewallRuleSummary, filters: RuleFilters): boolean {
  const direction = normalized(rule.direction);
  if (filters.direction === "inbound" && direction !== "entrant" && direction !== "inbound") {
    return false;
  }
  if (filters.direction === "outbound" && direction !== "sortant" && direction !== "outbound") {
    return false;
  }
  const action = normalized(rule.action);
  if (filters.action === "allow" && action !== "autoriser" && action !== "allow") return false;
  if (filters.action === "block" && action !== "bloquer" && action !== "block") return false;
  if (filters.state === "enabled" && !rule.enabled) return false;
  if (filters.state === "disabled" && rule.enabled) return false;

  const protocol = normalized(rule.protocol);
  if (filters.protocol === "tcp" && protocol !== "tcp") return false;
  if (filters.protocol === "udp" && protocol !== "udp") return false;
  if (filters.protocol === "any" && protocol !== "tout" && protocol !== "any") return false;

  const profiles = normalized(rule.profiles);
  if (filters.profile === "all") return true;
  if (profiles === "tous" || profiles === "all") return true;
  if (filters.profile === "domain") {
    return profiles.includes("domaine") || profiles.includes("domain");
  }
  if (filters.profile === "private") {
    return profiles.includes("privé") || profiles.includes("private");
  }
  return profiles.includes("public");
}

function toneForSeverity(severity: string): "danger" | "warning" | "info" {
  if (severity === "danger") return "danger";
  if (severity === "warning") return "warning";
  return "info";
}

interface ApplicationSummary {
  key: string;
  name: string;
  path: string | null;
  connections: number;
  established: number;
  mapped: number;
  rules: string[];
}

function summarizeApplications(connections: FirewallConnections | null): ApplicationSummary[] {
  if (!connections) return [];
  const groups = new Map<string, ApplicationSummary>();
  for (const row of connections.rows) {
    const key = (row.processPath || row.processName || `pid:${row.pid}`).toLowerCase();
    const current = groups.get(key) ?? {
      key,
      name: row.processName || row.processPath || `PID ${row.pid}`,
      path: row.processPath,
      connections: 0,
      established: 0,
      mapped: 0,
      rules: [],
    };
    current.connections += 1;
    if (row.state === "ESTABLISHED") current.established += 1;
    if (row.matchingRuleCount > 0) current.mapped += 1;
    for (const rule of row.matchingRules) {
      if (!current.rules.includes(rule)) current.rules.push(rule);
    }
    groups.set(key, current);
  }
  return [...groups.values()].sort(
    (left, right) =>
      right.connections - left.connections ||
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  );
}

export function Firewall() {
  const { language } = useI18n();
  const L = (fr: string, en: string) => (language === "en" ? en : fr);
  const actionLabel = (value: string) =>
    value === "bloquer"
      ? L("Bloquer", "Block")
      : value === "autoriser"
        ? L("Autoriser", "Allow")
        : value === "inconnu"
          ? L("Inconnu", "Unknown")
          : value;
  const profileLabel = (value: string) => {
    const normalized = value.toLowerCase();
    if (normalized === "domaine" || normalized === "domain") return L("Domaine", "Domain");
    if (normalized === "privé" || normalized === "private") return L("Privé", "Private");
    if (normalized === "public") return L("Public", "Public");
    if (normalized === "tous" || normalized === "all") return L("Tous", "All");
    return value;
  };
  const profilesLabel = (value: string) =>
    value
      .split(",")
      .map((part) => profileLabel(part.trim()))
      .join(", ");
  const protocolLabel = (value: string) =>
    value.toLowerCase() === "tout" ? L("Tout", "Any") : value.toUpperCase();
  const portLabel = (value: string) =>
    value.toLowerCase() === "tout" || value.toLowerCase() === "tous"
      ? L("Tout", "Any")
      : value;

  const [observation, setObservation] = useState<FirewallObservation | null>(null);
  const [status, setStatus] = useState<FirewallStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<RuleFilters>(EMPTY_RULE_FILTERS);
  const [selectedRule, setSelectedRule] = useState<FirewallRuleSummary | null>(null);
  const [connections, setConnections] = useState<FirewallConnections | null>(null);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);
  const [connectionQuery, setConnectionQuery] = useState("");
  const [establishedOnly, setEstablishedOnly] = useState(false);
  const [management, setManagement] = useState<RuleManagementStatus | null>(null);
  const [managementError, setManagementError] = useState<string | null>(null);
  const [exportInfo, setExportInfo] = useState<FirewallSnapshotExport | null>(null);
  const [exporting, setExporting] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<FirewallSnapshotInfo[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(true);
  const [snapshotsError, setSnapshotsError] = useState<string | null>(null);
  const [verifications, setVerifications] = useState<Record<string, FirewallSnapshotVerification>>({});
  const [verifyingPath, setVerifyingPath] = useState<string | null>(null);

  const inspect = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.firewallStatus();
      setObservation(result);
      setStatus(result.status);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadConnections = useCallback(async () => {
    setConnectionsLoading(true);
    try {
      const result = await api.firewallConnections();
      setConnections(result);
      setConnectionsError(null);
    } catch (err) {
      setConnectionsError(errorMessage(err));
    } finally {
      setConnectionsLoading(false);
    }
  }, []);

  const loadManagement = useCallback(async () => {
    try {
      setManagement(await api.firewallManagementStatus());
      setManagementError(null);
    } catch (err) {
      setManagementError(errorMessage(err));
    }
  }, []);

  const loadSnapshots = useCallback(async () => {
    setSnapshotsLoading(true);
    try {
      setSnapshots(await api.firewallSnapshotHistory());
      setSnapshotsError(null);
    } catch (err) {
      setSnapshotsError(errorMessage(err));
    } finally {
      setSnapshotsLoading(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([inspect(), loadConnections(), loadManagement(), loadSnapshots()]);
  }, [inspect, loadConnections, loadManagement, loadSnapshots]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const visibleRules = useMemo(
    () =>
      status?.rules.filter(
        (rule) => ruleMatches(rule, query) && ruleMatchesFilters(rule, filters),
      ) ?? [],
    [status, query, filters],
  );

  const activeFilterCount = useMemo(
    () => Object.values(filters).filter((value) => value !== "all").length,
    [filters],
  );
  const hasLocalFilter = activeFilterCount > 0 || query.trim().length > 0;

  const applications = useMemo(() => summarizeApplications(connections), [connections]);

  const visibleConnections = useMemo(() => {
    const rows = connections?.rows ?? [];
    const needle = connectionQuery.trim().toLowerCase();
    return rows.filter((row) => {
      if (establishedOnly && row.state !== "ESTABLISHED") return false;
      if (!needle) return true;
      return (
        (row.processName ?? "").toLowerCase().includes(needle) ||
        (row.processPath ?? "").toLowerCase().includes(needle) ||
        row.localEndpoint.toLowerCase().includes(needle) ||
        (row.remoteEndpoint ?? "").toLowerCase().includes(needle) ||
        row.matchingRules.some((rule) => rule.toLowerCase().includes(needle))
      );
    });
  }, [connections, connectionQuery, establishedOnly]);

  const alertMessage = (alert: FirewallAlert) => {
    const profile = alert.profile ? profileLabel(alert.profile) : "";
    switch (alert.code) {
      case "all_profiles_disabled":
        return {
          title: L(
            "Tous les profils du pare-feu Windows sont désactivés",
            "All Windows Firewall profiles are disabled",
          ),
          text: L(
            "Le filtrage réseau de Windows n'est pas actif sur cet appareil. CBS Shield ne modifie jamais le pare-feu : vérifiez ce choix dans Windows Security.",
            "Windows network filtering is not active on this device. CBS Shield never changes the firewall: review this setting in Windows Security.",
          ),
        };
      case "profile_disabled":
        return {
          title: L(
            `Profil ${profile} désactivé`,
            `${profile} profile disabled`,
          ),
          text: L(
            "La protection de ce profil n'est pas active. Cette observation est en lecture seule.",
            "Protection for this profile is not active. This observation is read-only.",
          ),
        };
      case "inbound_default_allow":
        return {
          title: L(
            `Connexions entrantes autorisées par défaut (${profile})`,
            `Inbound connections allowed by default (${profile})`,
          ),
          text: L(
            "Le profil est actif, mais son action entrante par défaut autorise le trafic non couvert par une règle de blocage.",
            "The profile is active, but its default inbound action allows traffic not covered by a block rule.",
          ),
        };
      default:
        return {
          title: L("Observation de sécurité", "Security observation"),
          text: alert.code,
        };
    }
  };

  const changeLabel = (change: FirewallChange) => {
    const profile = change.profile ? profileLabel(change.profile) : "";
    switch (change.code) {
      case "rules_changed":
        return L("Le jeu de règles a changé", "The rule set changed");
      case "profile_state_changed":
        return L(`Profil ${profile} : état activé/désactivé modifié`, `${profile} profile: enabled/disabled state changed`);
      case "profile_defaults_changed":
        return L(`Profil ${profile} : actions par défaut modifiées`, `${profile} profile: default actions changed`);
      case "profile_missing_from_baseline":
        return L(`Nouveau profil ${profile}`, `New ${profile} profile`);
      default:
        return change.code;
    }
  };

  const acknowledgeBaseline = async () => {
    setAcknowledging(true);
    setActionError(null);
    try {
      const result = await api.firewallAcknowledgeBaseline();
      setObservation(result);
      setStatus(result.status);
      await loadConnections();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setAcknowledging(false);
    }
  };

  const exportSnapshot = async () => {
    setExporting(true);
    setActionError(null);
    try {
      const result = await api.firewallExportSnapshot();
      setExportInfo(result);
      await Promise.all([loadManagement(), loadSnapshots()]);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  const verifySnapshot = async (path: string) => {
    setVerifyingPath(path);
    setActionError(null);
    try {
      const result = await api.firewallVerifySnapshot(path);
      setVerifications((current) => ({ ...current, [path]: result }));
      await loadManagement();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setVerifyingPath(null);
    }
  };

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  const integrityBadge = (integrity: string) => {
    if (integrity === "matched") {
      return (
        <Badge tone="ok" dot>
          {L("Empreinte vérifiée", "Digest matched")}
        </Badge>
      );
    }
    if (integrity === "mismatch") {
      return (
        <Badge tone="danger" dot>
          {L("Empreinte divergente", "Digest mismatch")}
        </Badge>
      );
    }
    if (integrity === "invalid") {
      return (
        <Badge tone="danger" dot>
          {L("Fichier non reconnu", "Unrecognized file")}
        </Badge>
      );
    }
    return (
      <Badge tone="warning" dot>
        {L("Sans empreinte de contrôle", "No control digest")}
      </Badge>
    );
  };

  const integrityNote = (integrity: string) => {
    if (integrity === "matched") {
      return L(
        "Le fichier .sha256 correspond aux octets du JSON. Cela détecte une altération accidentelle, pas une signature authentifiée.",
        "The .sha256 sidecar matches the JSON bytes. This detects accidental alteration, not an authenticated signature.",
      );
    }
    if (integrity === "mismatch") {
      return L(
        "Le fichier .sha256 ne correspond plus au JSON. Considérez l'instantané comme suspect et ne l'utilisez pas comme preuve.",
        "The .sha256 sidecar no longer matches the JSON. Treat the snapshot as suspect and do not use it as evidence.",
      );
    }
    if (integrity === "invalid") {
      return L(
        "Le fichier n'a pas le schéma d'un instantané CBS Shield en lecture seule.",
        "The file does not match the CBS Shield read-only snapshot schema.",
      );
    }
    return L(
      "Aucune empreinte de contrôle n'accompagne cet ancien instantané. Le fichier est lisible, mais son intégrité n'est pas attestée.",
      "No control digest accompanies this older snapshot. The file is readable, but its integrity is not attested.",
    );
  };

  const service = observation?.service;
  const serviceWarning = Boolean(
    service?.observed &&
      (service.mpsSvc !== "running" || service.bfe !== "running"),
  );
  const serviceUnknown = Boolean(service && !service.observed);
  const recovery = management?.recovery;
  const enabledProfiles = status?.profiles.filter((profile) => profile.enabled).length ?? 0;
  const alertCount = observation?.alerts.length ?? 0;
  const mappedConnections = connections?.mappedRows ?? 0;
  const totalConnections = connections?.tcpTotal ?? 0;

  return (
    <div className="section-stack">
      <div className="banner banner--info">
        <ShieldCheck size={19} aria-hidden="true" />
        <div>
          <strong>
            {L(
              "Observation lecture seule — aucune règle modifiée",
              "Read-only observation — no rule modified",
            )}
          </strong>
          <span>
            {L(
              "Cette section lit l'état des profils et des règles du Pare-feu Windows via l'API documentée",
              "This section reads the state of Windows Firewall profiles and rules through the documented",
            )}{" "}
            <code>INetFwPolicy2</code>
            {L(
              ". Aucune règle n'est ajoutée, supprimée, activée ou désactivée ; aucun pilote ni filtre réseau n'est installé ; Microsoft Defender n'est pas touché.",
              " API. No rule is added, removed, enabled or disabled; no driver or network filter is installed; Microsoft Defender is not touched.",
            )}
          </span>
        </div>
      </div>

      <section className="panel firewall-overview" id="firewall-overview">
        <div className="panel__head">
          <div>
            <span className="panel__eyebrow">{L("Posture observée", "Observed posture")}</span>
            <h2>{L("Vue d'ensemble du pare-feu", "Firewall overview")}</h2>
          </div>
          <div className="row-actions">
            <Badge tone="info" dot>
              {L("Lecture seule", "Read-only")}
            </Badge>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => void refreshAll()}
              disabled={loading || connectionsLoading || snapshotsLoading}
            >
              {loading || connectionsLoading || snapshotsLoading ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <RefreshCw size={15} />
              )}
              {L("Tout actualiser", "Refresh all")}
            </button>
          </div>
        </div>
        <div className="metric-strip metric-strip--firewall firewall-overview__metrics">
          <div>
            <span>{L("Profils actifs", "Enabled profiles")}</span>
            <strong>
              {loading ? "—" : `${enabledProfiles}/${status?.profiles.length ?? 0}`}
            </strong>
          </div>
          <div>
            <span>{L("Règles dans la stratégie", "Rules in policy")}</span>
            <strong>{status ? formatNumber(status.rulesTotalCount) : "—"}</strong>
          </div>
          <div>
            <span>{L("Connexions associées", "Mapped connections")}</span>
            <strong>
              {connections
                ? `${formatNumber(mappedConnections)}/${formatNumber(totalConnections)}`
                : "—"}
            </strong>
          </div>
          <div>
            <span>{L("Instantanés d'audit", "Audit snapshots")}</span>
            <strong>{snapshotsLoading ? "—" : formatNumber(snapshots.length)}</strong>
          </div>
          <div>
            <span>{L("Mutation des règles", "Rule mutation")}</span>
            <strong className="text-warning">{L("Désactivée", "Disabled")}</strong>
          </div>
        </div>
        <nav className="firewall-nav" aria-label={L("Sections du pare-feu", "Firewall sections")}>
          {[
            { id: "firewall-overview", label: L("Vue d'ensemble", "Overview"), Icon: LayoutDashboard },
            { id: "firewall-alerts", label: L("Alertes", "Alerts"), Icon: ShieldAlert },
            { id: "firewall-profiles", label: L("Profils", "Profiles"), Icon: Gauge },
            { id: "firewall-connections", label: L("Connexions", "Connections"), Icon: Network },
            { id: "firewall-rules", label: L("Règles", "Rules"), Icon: Filter },
            { id: "firewall-backup", label: L("Sauvegardes", "Backups"), Icon: Archive },
            { id: "firewall-diagnostics", label: L("Diagnostic", "Diagnostics"), Icon: Stethoscope },
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className="firewall-nav__item"
              onClick={() => scrollToSection(id)}
            >
              <Icon size={14} aria-hidden="true" />
              {label}
            </button>
          ))}
        </nav>
        <p className="panel__note">
          {L(
            `Dernière lecture : ${status ? formatDateTime(status.checkedAt) : "non disponible"} · ${alertCount} alerte${alertCount > 1 ? "s" : ""} active${alertCount > 1 ? "s" : ""} · la décision effective du noyau n'est pas calculée.`,
            `Latest read: ${status ? formatDateTime(status.checkedAt) : "not available"} · ${alertCount} active alert${alertCount > 1 ? "s" : ""} · the kernel's effective decision is not calculated.`,
          )}
        </p>
      </section>

      {error && (
        <div className="banner banner--danger">
          <TriangleAlert size={19} aria-hidden="true" />
          <div>
            <strong>{L("Pare-feu Windows indisponible", "Windows firewall unavailable")}</strong>
            <span>{error}</span>
            <div className="banner__actions">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => void refreshAll()}
              >
                <RefreshCw size={15} />
                {L("Réessayer", "Retry")}
              </button>
            </div>
          </div>
        </div>
      )}

      {serviceWarning && (
        <div className="banner banner--warning" role="alert">
          <ShieldAlert size={19} aria-hidden="true" />
          <div>
            <strong>
              {L(
                "Les services du pare-feu Windows ne sont pas tous en cours d'exécution",
                "The Windows Firewall services are not all running",
              )}
            </strong>
            <span>
              {L(
                `MpsSvc : ${service?.mpsSvc ?? "inconnu"} · BFE : ${service?.bfe ?? "inconnu"}. Une lecture des profils peut être incomplète ou obsolète. CBS Shield ne démarre ni n'arrête aucun service : vérifiez Windows Security et les services Windows.`,
                `MpsSvc: ${service?.mpsSvc ?? "unknown"} · BFE: ${service?.bfe ?? "unknown"}. A profile reading may be incomplete or stale. CBS Shield does not start or stop any service: review Windows Security and Windows services.`,
              )}
            </span>
          </div>
        </div>
      )}

      {serviceUnknown && (
        <div className="banner banner--neutral">
          <TriangleAlert size={19} aria-hidden="true" />
          <div>
            <strong>{L("État des services non vérifié", "Service state not verified")}</strong>
            <span>
              {L(
                "CBS Shield n'a pas pu lire l'état de MpsSvc et BFE. L'observation des profils reste affichée, mais sa fraîcheur n'est pas garantie.",
                "CBS Shield could not read the state of MpsSvc and BFE. Profile observations remain displayed, but their freshness is not guaranteed.",
              )}
            </span>
          </div>
        </div>
      )}

      <section
        id="firewall-alerts"
        className="security-alert-stack"
        aria-label={L("Alertes de sécurité", "Security alerts")}
      >
        <div className="section-heading">
          <span className="panel__eyebrow">{L("Alertes actives", "Active alerts")}</span>
          <h2>{L("Ce que l'état réel révèle", "What the real state reveals")}</h2>
        </div>
        {!observation ? (
          <div className="loading-row">
            <LoaderCircle size={16} className="spin" />
            {L("Lecture des alertes…", "Reading alerts…")}
          </div>
        ) : observation.alerts.length === 0 ? (
          <div className="callout callout--success">
            <strong>{L("Aucune alerte active", "No active alert")}</strong>
            <span>
              {L(
                "Les profils observés ne déclenchent aucune alerte de sécurité connue. Cela ne prouve pas que le filtrage effectif est optimal.",
                "The observed profiles trigger no known security alert. This does not prove that effective filtering is optimal.",
              )}
            </span>
          </div>
        ) : (
          observation.alerts.map((alert, index) => {
            const message = alertMessage(alert);
            return (
              <div
                key={`${alert.code}-${alert.profile ?? index}`}
                className={`banner banner--${toneForSeverity(alert.severity) === "danger" ? "danger" : toneForSeverity(alert.severity) === "warning" ? "warning" : "info"}`}
              >
                <ShieldAlert size={19} aria-hidden="true" />
                <div>
                  <strong>{message.title}</strong>
                  <span>{message.text}</span>
                </div>
              </div>
            );
          })
        )}
      </section>

      {observation?.changedSinceLast && (
        <div className="banner banner--warning">
          <TriangleAlert size={19} aria-hidden="true" />
          <div>
            <strong>
              {L(
                "Configuration différente depuis la référence acceptée",
                "Configuration different since the accepted baseline",
              )}
            </strong>
            <span>
              {observation.previousCheckedAt
                ? L(
                    `Référence acceptée le ${formatDateTime(observation.previousCheckedAt)}.`,
                    `Baseline accepted on ${formatDateTime(observation.previousCheckedAt)}.`,
                  )
                : L(
                    "Aucune date de référence disponible.",
                    "No baseline date available.",
                  )}{" "}
              {L(
                "CBS Shield ne modifie rien : vérifiez la source du changement.",
                "CBS Shield changes nothing: verify the source of the change.",
              )}
            </span>
            {observation.changes.length > 0 && (
              <ul className="inline-list">
                {observation.changes.map((change, index) => (
                  <li key={`${change.code}-${change.profile ?? index}`}>{changeLabel(change)}</li>
                ))}
              </ul>
            )}
            <div className="banner__actions">
              <button
                type="button"
                className="button button--ghost"
                disabled={acknowledging}
                onClick={() => void acknowledgeBaseline()}
              >
                {acknowledging ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <CheckCircle2 size={15} />
                )}
                {L(
                  "Accepter comme nouvelle référence",
                  "Accept as new baseline",
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {actionError && (
        <div className="banner banner--danger">
          <TriangleAlert size={19} aria-hidden="true" />
          <div>
            <strong>{L("Action non effectuée", "Action not completed")}</strong>
            <span>{actionError}</span>
          </div>
        </div>
      )}

      <section className="panel" id="firewall-profiles">
        <div className="panel__head">
          <div>
            <span className="panel__eyebrow">{L("Profils", "Profiles")}</span>
            <h2>{L("État par profil", "Status by profile")}</h2>
          </div>
          <div className="row-actions">
            {status && status.activeProfiles.length > 0 && (
              <Badge tone="info" dot>
                {L("Profil réseau : ", "Network profile: ")}
                {status.activeProfiles.map((value) => profileLabel(value)).join(" + ")}
              </Badge>
            )}
            <button
              type="button"
              className="button button--ghost"
              onClick={() => void refreshAll()}
            >
              {loading ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
              {L("Actualiser", "Refresh")}
            </button>
          </div>
        </div>

        {loading && !status ? (
          <div className="loading-row">
            <LoaderCircle size={18} className="spin" />
            {L("Lecture de la configuration du pare-feu…", "Reading firewall configuration…")}
          </div>
        ) : status ? (
          <>
            <div className="module-grid">
              {status.profiles.map((profile) => (
                <article
                  key={profile.profile}
                  className={`module-card ${profile.enabled ? "" : "module-card--danger"}`}
                >
                  <div className="module-card__top">
                    <Flame size={20} />
                    <Badge tone={profile.enabled ? "ok" : "danger"} dot>
                      {profile.enabled ? L("Activé", "Enabled") : L("Désactivé", "Disabled")}
                    </Badge>
                  </div>
                  <strong>{profileLabel(profile.profile)}</strong>
                  <span>
                    {L(
                      `Connexions entrantes par défaut : ${actionLabel(profile.inboundDefault)} · sortantes : ${actionLabel(profile.outboundDefault)}`,
                      `Default inbound connections: ${actionLabel(profile.inboundDefault)} · outbound: ${actionLabel(profile.outboundDefault)}`,
                    )}
                  </span>
                </article>
              ))}
            </div>
            <p className="panel__note">
              {L(
                `Observé à ${formatDateTime(status.checkedAt)} · ${formatNumber(status.rulesTotalCount)} règle${status.rulesTotalCount > 1 ? "s" : ""} dans la stratégie · hachages profils + règles calculés localement.`,
                `Observed at ${formatDateTime(status.checkedAt)} · ${formatNumber(status.rulesTotalCount)} rule${status.rulesTotalCount > 1 ? "s" : ""} in the policy · profile + rule hashes computed locally.`,
              )}
            </p>
          </>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel__head">
          <div>
            <span className="panel__eyebrow">
              {L("Référence et décision effective", "Reference and effective decision")}
            </span>
            <h2>{L("Une règle déclarée n'est pas un verdict", "A declared rule is not a verdict")}</h2>
          </div>
          <Badge tone="info" dot>
            {L("Décision non calculée", "Decision not calculated")}
          </Badge>
        </div>
        <div className="compare-grid">
          <article className="compare-card">
            <span className="panel__eyebrow">{L("Référence", "Reference")}</span>
            <h3>{L("Ce que CBS Shield lit", "What CBS Shield reads")}</h3>
            <ul className="rule-list">
              <li>{L("profils Windows et actions par défaut ;", "Windows profiles and default actions;")}</li>
              <li>{L("règles déclarées, direction, action et état activé ;", "declared rules, direction, action and enabled state;")}</li>
              <li>{L("programme, protocole, ports et profil ciblés ;", "program, protocol, ports and targeted profile;")}</li>
              <li>{L("empreintes locales pour détecter un changement.", "local fingerprints to detect changes.")}</li>
            </ul>
            <Badge tone="ok" dot>{L("Lu", "Read")}</Badge>
          </article>
          <article className="compare-card compare-card--muted">
            <span className="panel__eyebrow">{L("Décision effective", "Effective decision")}</span>
            <h3>{L("Ce que CBS Shield ne prétend pas calculer", "What CBS Shield does not claim to calculate")}</h3>
            <ul className="rule-list">
              <li>{L("priorité entre règles Autoriser et Bloquer ;", "precedence between Allow and Block rules;")}</li>
              <li>{L("filtres WFP, stratégie de groupe et renforcement du service ;", "WFP filters, Group Policy and service hardening;")}</li>
              <li>{L("IPsec, adresses locales/distantes et utilisateurs authentifiés ;", "IPsec, local/remote addresses and authenticated users;")}</li>
              <li>{L("décision réelle pour un paquet ou une connexion donnée.", "the real decision for a given packet or connection.")}</li>
            </ul>
            <Badge tone="warning" dot>{L("Non calculée", "Not calculated")}</Badge>
          </article>
        </div>
        <p className="panel__note">
          {L(
            "Une règle « Autoriser » visible ne prouve pas qu'un trafic est autorisé : une règle de blocage, un filtre WFP ou une stratégie plus spécifique peut s'appliquer. CBS Shield ne consulte pas les filtres effectifs du noyau et ne remplace pas Windows Security.",
            "A visible “Allow” rule does not prove that traffic is allowed: a block rule, a WFP filter or a more specific policy may apply. CBS Shield does not query the kernel's effective filters and does not replace Windows Security.",
          )}
        </p>
      </section>

      <section className="panel" id="firewall-connections">
        <div className="panel__head">
          <div>
            <span className="panel__eyebrow">{L("Observations réseau", "Network observations")}</span>
            <h2>{L("Connexions et applications", "Connections and applications")}</h2>
          </div>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => void loadConnections()}
            disabled={connectionsLoading}
          >
            {connectionsLoading ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Activity size={15} />
            )}
            {L("Mesurer maintenant", "Measure now")}
          </button>
        </div>

        <p className="panel__note">
          {L(
            "Capture TCP en lecture seule. La jointure associe le chemin d'image du processus aux règles actives qui référencent le même exécutable. C'est une référence, pas un verdict effectif d'autorisation ou de blocage.",
            "Read-only TCP capture. The join associates the process image path with enabled rules that reference the same executable. This is a reference, not an effective allow/block verdict.",
          )}
        </p>

        {connectionsError && (
          <div className="banner banner--warning">
            <TriangleAlert size={18} aria-hidden="true" />
            <div>
              <strong>{L("Capture réseau indisponible", "Network capture unavailable")}</strong>
              <span>{connectionsError}</span>
            </div>
          </div>
        )}

        {connections && (
          <>
            <div className="metric-strip metric-strip--firewall">
              <div>
                <span>{L("Connexions TCP", "TCP connections")}</span>
                <strong>{formatNumber(connections.tcpTotal)}</strong>
              </div>
              <div>
                <span>{L("Associées à une règle", "Mapped to a rule")}</span>
                <strong>{formatNumber(connections.mappedRows)}</strong>
              </div>
              <div>
                <span>{L("Sans règle homonyme", "No name-matched rule")}</span>
                <strong>{formatNumber(connections.unmappedRows)}</strong>
              </div>
              <div>
                <span>{L("Bindings UDP", "UDP bindings")}</span>
                <strong>{formatNumber(connections.udpTotal)}</strong>
              </div>
            </div>
            <p className="panel__note">
              {L(
                `Capturé à ${formatDateTime(connections.capturedAt)} · ${formatNumber(connections.rulesListed)} règles examinées sur ${formatNumber(connections.rulesTotalCount)}.`,
                `Captured at ${formatDateTime(connections.capturedAt)} · ${formatNumber(connections.rulesListed)} rules examined out of ${formatNumber(connections.rulesTotalCount)}.`,
              )}{" "}
              {!connections.mappingAvailable &&
                L(
                  "La configuration du pare-feu n'a pas pu être lue : aucune association n'est affichée.",
                  "The firewall configuration could not be read: no mapping is shown.",
                )}
              {connections.mappingLimited &&
                L(
                  "La liste des règles est tronquée : certaines associations peuvent manquer.",
                  "The rule list is truncated: some mappings may be missing.",
                )}
            </p>

            {applications.length > 0 && (
              <div className="firewall-applications">
                <div className="firewall-subhead">
                  <div>
                    <span className="panel__eyebrow">
                      {L("Applications observées", "Observed applications")}
                    </span>
                    <h3>{L("Regroupement des connexions par processus", "Connections grouped by process")}</h3>
                  </div>
                  <Badge tone="neutral">{formatNumber(applications.length)}</Badge>
                </div>
                <div className="table-wrap">
                  <table className="table table--compact">
                    <thead>
                      <tr>
                        <th>{L("Application", "Application")}</th>
                        <th>{L("Connexions", "Connections")}</th>
                        <th>{L("Établies", "Established")}</th>
                        <th>{L("Associées", "Mapped")}</th>
                        <th>{L("Règles", "Rules")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {applications.slice(0, 10).map((application) => (
                        <tr key={application.key}>
                          <td title={application.path ?? undefined}>
                            <strong>{application.name}</strong>
                            {application.path && (
                              <small className="table__sub">
                                {truncateMiddle(application.path, 46)}
                              </small>
                            )}
                          </td>
                          <td className="mono">{formatNumber(application.connections)}</td>
                          <td className="mono">{formatNumber(application.established)}</td>
                          <td>
                            <Badge tone={application.mapped > 0 ? "info" : "neutral"}>
                              {formatNumber(application.mapped)}
                            </Badge>
                          </td>
                          <td title={application.rules.join("\n")}>
                            {application.rules.length > 0
                              ? truncateMiddle(application.rules[0], 32)
                              : "—"}
                            {application.rules.length > 1 && (
                              <span className="muted"> +{application.rules.length - 1}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {applications.length > 10 && (
                  <p className="panel__note">
                    {L(
                      `Les ${formatNumber(applications.length - 10)} autres applications sont visibles dans le tableau des connexions.`,
                      `The other ${formatNumber(applications.length - 10)} applications are visible in the connection table.`,
                    )}
                  </p>
                )}
              </div>
            )}

            <div className="filter-row firewall-connection-filters">
              <div className="field field--grow">
                <label className="field__label" htmlFor="firewall-connection-search">
                  {L("Filtrer les connexions", "Filter connections")}
                </label>
                <input
                  id="firewall-connection-search"
                  className="input"
                  type="search"
                  placeholder={L("Processus, adresse, règle…", "Process, address, rule…")}
                  value={connectionQuery}
                  onChange={(event) => setConnectionQuery(event.target.value)}
                />
              </div>
              <label className="switch-row switch-row--inline" htmlFor="firewall-established-only">
                <input
                  id="firewall-established-only"
                  type="checkbox"
                  checked={establishedOnly}
                  onChange={(event) => setEstablishedOnly(event.target.checked)}
                />
                <span>
                  <strong>{L("Établies uniquement", "Established only")}</strong>
                  <small>{L("Filtre local, aucune capture supplémentaire", "Local filter, no extra capture")}</small>
                </span>
              </label>
              <Badge tone="neutral">
                {formatNumber(visibleConnections.length)}/{formatNumber(connections.rows.length)}
              </Badge>
            </div>

            {connections.rows.length === 0 ? (
              <EmptyState
                icon={Activity}
                title={L("Aucune connexion TCP visible", "No visible TCP connection")}
                description={L(
                  "La capture est réelle et en lecture seule. Aucune connexion TCP n'était active au moment de la mesure.",
                  "The capture is real and read-only. No TCP connection was active at measurement time.",
                )}
              />
            ) : visibleConnections.length === 0 ? (
              <EmptyState
                icon={Search}
                title={L("Aucune connexion correspondante", "No matching connection")}
                description={L(
                  "Modifiez le filtre local pour élargir les résultats.",
                  "Change the local filter to broaden the results.",
                )}
              />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{L("Processus", "Process")}</th>
                      <th>PID</th>
                      <th>{L("Local", "Local")}</th>
                      <th>{L("Distant", "Remote")}</th>
                      <th>{L("État", "State")}</th>
                      <th>{L("Règles référencées", "Referenced rules")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleConnections.map((row, index) => (
                      <tr key={`${row.pid}-${row.localEndpoint}-${row.remoteEndpoint ?? "none"}-${index}`}>
                        <td title={row.processPath ?? undefined}>
                          {row.processName ?? <span className="muted">{L("Inconnu", "Unknown")}</span>}
                        </td>
                        <td className="mono">{row.pid}</td>
                        <td className="mono">{row.localEndpoint}</td>
                        <td className="mono">{row.remoteEndpoint ?? "—"}</td>
                        <td>
                          <Badge tone={row.state === "ESTABLISHED" ? "ok" : "neutral"} dot>
                            {row.state ?? "UDP"}
                          </Badge>
                        </td>
                        <td>
                          {row.matchingRuleCount > 0 ? (
                            <span
                              title={row.matchingRules.join("\n")}
                              className="rule-reference"
                            >
                              <Badge tone="info">
                                {formatNumber(row.matchingRuleCount)}
                              </Badge>{" "}
                              {truncateMiddle(row.matchingRules[0] ?? "", 30)}
                              {row.matchingRuleCount > 1 && (
                                <span className="muted"> +{row.matchingRuleCount - 1}</span>
                              )}
                            </span>
                          ) : (
                            <span className="muted">{L("Aucune", "None")}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {connections.rowsTruncated && (
              <p className="panel__note">
                {L(
                  `Affichage limité à ${formatNumber(connections.rows.length)} connexions ; les compteurs couvrent la capture complète.`,
                  `Display limited to ${formatNumber(connections.rows.length)} connections; counters cover the complete capture.`,
                )}
              </p>
            )}
          </>
        )}
      </section>

      <section className="panel" id="firewall-backup">
        <div className="panel__head">
          <div>
            <span className="panel__eyebrow">{L("Gestion des règles", "Rule management")}</span>
            <h2>
              {L("Architecture verrouillée", "Locked architecture")}{" "}
              <Badge tone="danger" dot>
                {L("Désactivée", "Disabled")}
              </Badge>
            </h2>
          </div>
        </div>
        <div className="gate-grid">
          {management?.gates.map((gate) => (
            <div key={gate.code} className="gate-card">
              <span className={gate.satisfied ? "gate-card__dot is-ok" : "gate-card__dot"} />
              <div>
                <strong>
                  {gate.code === "explicit_authorization"
                    ? L("Autorisation explicite", "Explicit authorization")
                    : gate.code === "isolated_vm_test"
                      ? L("Test en VM isolée", "Isolated VM test")
                      : gate.code === "backup_snapshot"
                        ? L("Instantané de sauvegarde", "Backup snapshot")
                        : gate.code === "rollback_rehearsal"
                          ? L("Répétition de restauration", "Rollback rehearsal")
                          : gate.code}
                </strong>
                <span>
                  {gate.satisfied
                    ? L("Disponible", "Available")
                    : L("Non satisfait", "Not satisfied")}
                </span>
              </div>
            </div>
          ))}
        </div>
        {management ? (
          <>
            <p className="panel__note">
              {L(
                `Aucune API de mutation n'est exposée. Les instantanés JSON en lecture seule sont écrits dans ${management.backupDirectory} (${formatNumber(management.snapshotCount)} présent${management.snapshotCount > 1 ? "s" : ""}, ${formatNumber(management.verifiedSnapshotCount)} avec empreinte vérifiée).`,
                `No mutation API is exposed. Read-only JSON snapshots are written to ${management.backupDirectory} (${formatNumber(management.snapshotCount)} present, ${formatNumber(management.verifiedSnapshotCount)} with a matched digest).`,
              )}
            </p>
            {management.lastSnapshotAt && (
              <p className="panel__note">
                {L(
                  `Dernier instantané : ${formatDateTime(management.lastSnapshotAt)} · conception de restauration v${management.rollbackDesignVersion}.`,
                  `Latest snapshot: ${formatDateTime(management.lastSnapshotAt)} · rollback design v${management.rollbackDesignVersion}.`,
                )}
              </p>
            )}
            <div className="row-actions">
              <button
                type="button"
                className="button button--ghost"
                disabled={exporting}
                onClick={() => void exportSnapshot()}
              >
                {exporting ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}
                {L("Exporter un instantané lecture seule", "Export read-only snapshot")}
              </button>
              <Badge tone="neutral">
                <LockKeyhole size={13} /> {L("Restauration non implémentée", "Restore not implemented")}
              </Badge>
            </div>
            {exportInfo && (
              <div className="callout callout--info">
                <strong>{L("Instantané d'audit écrit", "Audit snapshot written")}</strong>
                <span>
                  {L(
                    `${exportInfo.path} · ${formatNumber(exportInfo.rulesSaved)}/${formatNumber(exportInfo.rulesTotalCount)} règles${exportInfo.truncated ? ", tronqué" : ""}.`,
                    `${exportInfo.path} · ${formatNumber(exportInfo.rulesSaved)}/${formatNumber(exportInfo.rulesTotalCount)} rules${exportInfo.truncated ? ", truncated" : ""}.`,
                  )}
                </span>
                <span>
                  <LockKeyhole size={13} />{" "}
                  {L(
                    "Fichier en lecture seule logique : aucune importation ni restauration n'est exposée.",
                    "Logically read-only file: no import or restore path is exposed.",
                  )}
                </span>
                <code className="snapshot-hash" title={exportInfo.sha256}>
                  SHA-256 · {exportInfo.sha256}
                </code>
                {exportInfo.sha256Sidecar ? (
                  <span>
                    <FileCheck2 size={13} />{" "}
                    {L(
                      "Empreinte de contrôle .sha256 écrite à côté de l'instantané.",
                      "A .sha256 control digest was written next to the snapshot.",
                    )}
                  </span>
                ) : (
                  <span>
                    <TriangleAlert size={13} />{" "}
                    {L(
                      "Empreinte de contrôle non écrite : l'instantané est lisible mais non attesté.",
                      "Control digest not written: the snapshot is readable but unverified.",
                    )}
                  </span>
                )}
              </div>
            )}

            <div className="firewall-snapshots">
              <div className="firewall-subhead">
                <div>
                  <span className="panel__eyebrow">{L("Instantanés d'audit", "Audit snapshots")}</span>
                  <h3>{L("Sauvegardes vérifiables, sans restauration", "Verifiable backups, no restore")}</h3>
                </div>
                <div className="row-actions">
                  <Badge tone="neutral">{formatNumber(snapshots.length)}</Badge>
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => void loadSnapshots()}
                    disabled={snapshotsLoading}
                  >
                    {snapshotsLoading ? (
                      <LoaderCircle size={14} className="spin" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                    {L("Actualiser", "Refresh")}
                  </button>
                </div>
              </div>
              <p className="panel__note">
                {L(
                  "Les fichiers JSON et leur empreinte .sha256 sont uniquement lus. Aucun import, aucune application et aucune suppression ne sont exposés. La vérification détecte une altération accidentelle, pas une signature authentifiée.",
                  "The JSON files and their .sha256 sidecars are read only. No import, apply or delete path is exposed. Verification detects accidental alteration, not an authenticated signature.",
                )}
              </p>
              {snapshotsError && (
                <div className="banner banner--warning">
                  <TriangleAlert size={18} aria-hidden="true" />
                  <div>
                    <strong>{L("Instantanés indisponibles", "Snapshots unavailable")}</strong>
                    <span>{snapshotsError}</span>
                  </div>
                </div>
              )}
              {!snapshotsError && snapshots.length === 0 && !snapshotsLoading && (
                <EmptyState
                  icon={Archive}
                  title={L("Aucun instantané d'audit", "No audit snapshot")}
                  description={L(
                    "Exportez un instantané lecture seule pour conserver une référence vérifiable de l'état observé.",
                    "Export a read-only snapshot to keep a verifiable reference of the observed state.",
                  )}
                />
              )}
              {snapshots.length > 0 && (
                <div className="table-wrap">
                  <table className="table table--compact">
                    <thead>
                      <tr>
                        <th>{L("Fichier", "File")}</th>
                        <th>{L("Observé", "Observed")}</th>
                        <th>{L("Règles", "Rules")}</th>
                        <th>{L("Intégrité", "Integrity")}</th>
                        <th>{L("Taille", "Size")}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {snapshots.map((snapshot) => {
                        const verification = verifications[snapshot.path];
                        const integrity = verification?.integrity ?? snapshot.integrity;
                        return (
                          <tr key={snapshot.path}>
                            <td title={snapshot.path}>
                              <strong>{truncateMiddle(snapshot.fileName, 42)}</strong>
                              <small className="table__sub">
                                {snapshot.modifiedAt ? formatDateTime(snapshot.modifiedAt) : "—"}
                              </small>
                            </td>
                            <td className="mono">
                              {snapshot.checkedAt ? formatDateTime(snapshot.checkedAt) : "—"}
                            </td>
                            <td className="mono">
                              {snapshot.rulesSaved === null
                                ? "—"
                                : `${formatNumber(snapshot.rulesSaved)}/${formatNumber(snapshot.rulesTotalCount ?? snapshot.rulesSaved)}`}
                            </td>
                            <td>{integrityBadge(integrity)}</td>
                            <td className="mono">
                              {formatNumber(snapshot.bytes)} {L("o", "B")}
                            </td>
                            <td>
                              <button
                                type="button"
                                className="button button--ghost button--small"
                                onClick={() => void verifySnapshot(snapshot.path)}
                                disabled={verifyingPath === snapshot.path}
                              >
                                {verifyingPath === snapshot.path ? (
                                  <LoaderCircle size={13} className="spin" />
                                ) : (
                                  <FileSearch size={13} />
                                )}
                                {L("Vérifier", "Verify")}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {Object.values(verifications).map((verification) => (
                <div className="callout callout--info" key={verification.snapshot.path}>
                  <strong>{verification.snapshot.fileName}</strong>
                  <span>{integrityNote(verification.integrity)}</span>
                  <code className="snapshot-hash" title={verification.snapshot.sha256}>
                    SHA-256 · {verification.snapshot.sha256}
                  </code>
                  {verification.sidecarSha256 && (
                    <code className="snapshot-hash" title={verification.sidecarSha256}>
                      .sha256 · {verification.sidecarSha256}
                    </code>
                  )}
                </div>
              ))}
            </div>

            <div className="recovery-plan">
              <div className="recovery-plan__head">
                <div>
                  <span className="panel__eyebrow">{L("Récupération", "Recovery")}</span>
                  <h3>{L("Plan de récupération — conception seulement", "Recovery plan — design only")}</h3>
                </div>
                <Badge tone="warning" dot>
                  {L("Non actif", "Not active")}
                </Badge>
              </div>
              <ol className="recovery-steps">
                <li className="is-ok">
                  <span>1</span>
                  <div>
                    <strong>{L("Instantané vérifiable", "Verifiable snapshot")}</strong>
                    <small>
                      {L(
                        "Copie JSON en lecture seule, empreinte SHA-256 affichée après export.",
                        "Read-only JSON copy, SHA-256 displayed after export.",
                      )}
                    </small>
                  </div>
                  <Badge tone="ok" dot>{L("Conçu", "Designed")}</Badge>
                </li>
                <li>
                  <span>2</span>
                  <div>
                    <strong>{L("Restauration absente", "Restore absent")}</strong>
                    <small>
                      {L(
                        "Aucun chemin de code ne peut importer ou appliquer un instantané.",
                        "No code path can import or apply a snapshot.",
                      )}
                    </small>
                  </div>
                  <Badge tone="danger" dot>{L("Non implémentée", "Not implemented")}</Badge>
                </li>
                <li>
                  <span>3</span>
                  <div>
                    <strong>{L("Répétition de restauration", "Rollback rehearsal")}</strong>
                    <small>
                      {L(
                        "À exécuter dans une VM Windows isolée, avec export avant/après et validation des règles.",
                        "To be run in an isolated Windows VM, with before/after export and rule validation.",
                      )}
                    </small>
                  </div>
                  <Badge tone="warning" dot>
                    {recovery?.rollbackRehearsed
                      ? L("Validée", "Validated")
                      : L("Non réalisée", "Not performed")}
                  </Badge>
                </li>
                <li>
                  <span>4</span>
                  <div>
                    <strong>{L("Autorisation explicite", "Explicit authorization")}</strong>
                    <small>
                      {L(
                        "Aucune mutation ne sera activée sans accord distinct et documenté.",
                        "No mutation will be enabled without separate, documented consent.",
                      )}
                    </small>
                  </div>
                  <Badge tone="danger" dot>{L("Requise", "Required")}</Badge>
                </li>
              </ol>
              <p className="panel__note">
                {L(
                  "Architecture future : schéma versionné, refus des fichiers non reconnus, journal d'audit, sauvegarde préalable obligatoire, test isolé et retour arrière explicite. Aucun de ces mécanismes de mutation n'est exposé dans cette version.",
                  "Future architecture: versioned schema, rejection of unknown files, audit log, mandatory prior backup, isolated test and explicit rollback. None of these mutation mechanisms is exposed in this version.",
                )}
              </p>
            </div>
          </>
        ) : managementError ? (
          <p className="panel__note">{managementError}</p>
        ) : (
          <div className="loading-row">
            <LoaderCircle size={16} className="spin" />
            {L("Lecture du verrouillage…", "Reading lock status…")}
          </div>
        )}
        <p className="panel__note">
          {L(
            "La restauration et toute modification du pare-feu restent indisponibles jusqu'à autorisation explicite, test isolé et validation d'un cycle de récupération.",
            "Restore and any firewall mutation remain unavailable until explicit authorization, isolated testing and a validated recovery cycle.",
          )}
        </p>
      </section>

      <section className="panel" id="firewall-rules">
        <div className="panel__head">
          <div>
            <span className="panel__eyebrow">{L("Règles", "Rules")}</span>
            <h2>
              {L("Règles existantes", "Existing rules")}{" "}
              <span className="muted">
                {status
                  ? visibleRules.length === status.rules.length
                    ? L(
                        `(${formatNumber(status.rules.length)} affichées)`,
                        `(${formatNumber(status.rules.length)} shown)`,
                      )
                    : L(
                        `(${formatNumber(visibleRules.length)} sur ${formatNumber(status.rules.length)} affichées)`,
                        `(${formatNumber(visibleRules.length)} of ${formatNumber(status.rules.length)} shown)`,
                      )
                  : ""}
              </span>
            </h2>
          </div>
          {hasLocalFilter && (
            <button
              type="button"
              className="button button--ghost"
              onClick={() => {
                setFilters(EMPTY_RULE_FILTERS);
                setQuery("");
              }}
            >
              <X size={14} />
              {L("Réinitialiser les filtres", "Reset filters")}
            </button>
          )}
        </div>

        <div className="filter-row firewall-rule-filters">
          <div className="field field--grow">
            <label className="field__label" htmlFor="firewall-search">
              {L("Recherche locale", "Local search")}
            </label>
            <input
              id="firewall-search"
              className="input"
              type="search"
              placeholder={L(
                "Nom, programme, protocole, port, groupe…",
                "Name, program, protocol, port, group…",
              )}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="firewall-direction-filter">
              {L("Direction", "Direction")}
            </label>
            <select
              id="firewall-direction-filter"
              className="input"
              value={filters.direction}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  direction: event.target.value as DirectionFilter,
                }))
              }
            >
              <option value="all">{L("Toutes", "All")}</option>
              <option value="inbound">{L("Entrantes", "Inbound")}</option>
              <option value="outbound">{L("Sortantes", "Outbound")}</option>
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="firewall-action-filter">
              {L("Action", "Action")}
            </label>
            <select
              id="firewall-action-filter"
              className="input"
              value={filters.action}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  action: event.target.value as ActionFilter,
                }))
              }
            >
              <option value="all">{L("Toutes", "All")}</option>
              <option value="allow">{L("Autoriser", "Allow")}</option>
              <option value="block">{L("Bloquer", "Block")}</option>
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="firewall-state-filter">
              {L("État", "State")}
            </label>
            <select
              id="firewall-state-filter"
              className="input"
              value={filters.state}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  state: event.target.value as StateFilter,
                }))
              }
            >
              <option value="all">{L("Tous", "All")}</option>
              <option value="enabled">{L("Activées", "Enabled")}</option>
              <option value="disabled">{L("Désactivées", "Disabled")}</option>
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="firewall-protocol-filter">
              {L("Protocole", "Protocol")}
            </label>
            <select
              id="firewall-protocol-filter"
              className="input"
              value={filters.protocol}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  protocol: event.target.value as ProtocolFilter,
                }))
              }
            >
              <option value="all">{L("Tous", "All")}</option>
              <option value="tcp">TCP</option>
              <option value="udp">UDP</option>
              <option value="any">{L("Tout protocole", "Any protocol")}</option>
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="firewall-profile-filter">
              {L("Profil", "Profile")}
            </label>
            <select
              id="firewall-profile-filter"
              className="input"
              value={filters.profile}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  profile: event.target.value as ProfileFilter,
                }))
              }
            >
              <option value="all">{L("Tous", "All")}</option>
              <option value="domain">{L("Domaine", "Domain")}</option>
              <option value="private">{L("Privé", "Private")}</option>
              <option value="public">Public</option>
            </select>
          </div>
        </div>
        <div className="firewall-filter-summary">
          <Filter size={14} aria-hidden="true" />
          <span>
            {L(
              `${formatNumber(visibleRules.length)} règle${visibleRules.length > 1 ? "s" : ""} correspond${visibleRules.length > 1 ? "ent" : ""} aux filtres locaux.`,
              `${formatNumber(visibleRules.length)} rule${visibleRules.length > 1 ? "s" : ""} match the local filters.`,
            )}
          </span>
          {activeFilterCount > 0 && (
            <Badge tone="info">
              {L(
                `${activeFilterCount} filtre${activeFilterCount > 1 ? "s" : ""} actif${activeFilterCount > 1 ? "s" : ""}`,
                `${activeFilterCount} active filter${activeFilterCount > 1 ? "s" : ""}`,
              )}
            </Badge>
          )}
        </div>

        {observation?.listedTruncated && (
          <p className="panel__note">
            {L(
              "Affichage limité aux 1 000 premières règles par taille d'affichage ; le compteur de règles et l'empreinte de configuration portent sur l'intégralité.",
              "Display limited to the first 1,000 rules to keep the view light; the rule count and configuration fingerprint cover the entire set.",
            )}
          </p>
        )}

        {!status ? null : visibleRules.length === 0 ? (
          <EmptyState
            icon={Flame}
            title={
              status.rules.length === 0
                ? L("Aucune règle déclarée", "No rule declared")
                : L("Aucune règle correspondante", "No matching rule")
            }
            description={
              status.rules.length === 0
                ? L(
                    "La stratégie du pare-feu Windows ne contient pas de règle personnalisée.",
                    "The Windows firewall policy contains no custom rule.",
                  )
                : L(
                    "Modifiez la recherche pour élargir les résultats.",
                    "Change the search to broaden the results.",
                  )
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{L("Nom", "Name")}</th>
                  <th>{L("Direction", "Direction")}</th>
                  <th>{L("Action", "Action")}</th>
                  <th>{L("État", "State")}</th>
                  <th>{L("Proto", "Proto")}</th>
                  <th>{L("Ports", "Ports")}</th>
                  <th>{L("Profil", "Profile")}</th>
                  <th>{L("Programme", "Program")}</th>
                  <th>{L("Groupe", "Group")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleRules.map((rule, index) => (
                  <tr key={`${rule.name}-${rule.grouping}-${index}`} className={rule.enabled ? "" : "is-muted"}>
                    <td title={rule.description || rule.name}>
                      {truncateMiddle(rule.name, 42)}
                    </td>
                    <td>{directionBadge(rule, L)}</td>
                    <td>{actionBadge(rule, L)}</td>
                    <td>
                      <Badge tone={rule.enabled ? "ok" : "neutral"} dot>
                        {rule.enabled ? L("Activée", "Enabled") : L("Désactivée", "Disabled")}
                      </Badge>
                    </td>
                    <td className="mono">{protocolLabel(rule.protocol)}</td>
                    <td className="mono">
                      {rule.localPorts ? (
                        <span
                          title={L(
                            `distant : ${portLabel(rule.remotePorts || "tout")}`,
                            `remote: ${portLabel(rule.remotePorts || "tout")}`,
                          )}
                        >
                          {truncateMiddle(portLabel(rule.localPorts), 18)}
                        </span>
                      ) : (
                        <span className="muted">{L("tout", "all")}</span>
                      )}
                    </td>
                    <td>{profilesLabel(rule.profiles)}</td>
                    <td title={rule.applicationName || undefined}>
                      {rule.applicationName
                        ? truncateMiddle(rule.applicationName, 34)
                        : <span className="muted">—</span>}
                    </td>
                    <td title={rule.grouping || undefined}>{rule.grouping || "—"}</td>
                    <td>
                      <button
                        type="button"
                        className="button button--ghost button--small"
                        onClick={() => setSelectedRule(rule)}
                        aria-label={L(
                          `Détails de la règle ${rule.name}`,
                          `Details for rule ${rule.name}`,
                        )}
                      >
                        <FileSearch size={13} />
                        {L("Détails", "Details")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel" id="firewall-diagnostics">
        <div className="panel__head">
          <div>
            <span className="panel__eyebrow">{L("Diagnostic", "Diagnostics")}</span>
            <h2>{L("Capacités et empreintes observées", "Observed capabilities and fingerprints")}</h2>
          </div>
          <div className="row-actions">
            <Badge tone="info" dot>
              {L("API documentée", "Documented API")}
            </Badge>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => void refreshAll()}
              disabled={loading || snapshotsLoading}
            >
              {loading || snapshotsLoading ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Stethoscope size={15} />
              )}
              {L("Relancer le diagnostic", "Run diagnostics")}
            </button>
          </div>
        </div>
        <div className="diagnostic-grid">
          <div>
            <span>{L("Profils actifs", "Active profiles")}</span>
            <strong>
              {status?.activeProfiles.length
                ? status.activeProfiles.map((value) => profileLabel(value)).join(" + ")
                : L("Aucun", "None")}
            </strong>
          </div>
          <div>
            <span>{L("MpsSvc", "MpsSvc")}</span>
            <strong>{service?.mpsSvc ?? L("non vérifié", "not verified")}</strong>
          </div>
          <div>
            <span>{L("BFE", "BFE")}</span>
            <strong>{service?.bfe ?? L("non vérifié", "not verified")}</strong>
          </div>
          <div>
            <span>{L("Règles listées", "Listed rules")}</span>
            <strong>
              {status
                ? `${formatNumber(status.rules.length)} / ${formatNumber(status.rulesTotalCount)}`
                : "—"}
            </strong>
          </div>
          <div>
            <span>{L("Empreinte des règles", "Rule fingerprint")}</span>
            <code title={status?.rulesHash}>{status ? truncateMiddle(status.rulesHash, 26) : "—"}</code>
          </div>
          <div>
            <span>{L("Empreinte des profils", "Profile fingerprint")}</span>
            <code title={status?.profilesHash}>{status ? truncateMiddle(status.profilesHash, 26) : "—"}</code>
          </div>
          <div>
            <span>{L("Empreinte composite", "Composite fingerprint")}</span>
            <code title={status?.configurationHash}>
              {status ? truncateMiddle(status.configurationHash, 26) : "—"}
            </code>
          </div>
          <div>
            <span>{L("Dossier des instantanés", "Snapshot directory")}</span>
            <code title={management?.backupDirectory}>{management?.backupDirectory ?? "—"}</code>
          </div>
          <div>
            <span>{L("Mutation des règles", "Rule mutation")}</span>
            <strong className="text-warning">{L("Non exposée", "Not exposed")}</strong>
          </div>
          <div>
            <span>{L("Dernier instantané", "Latest snapshot")}</span>
            <strong>
              {management?.lastSnapshotAt
                ? formatDateTime(management.lastSnapshotAt)
                : L("Aucun", "None")}
            </strong>
          </div>
        </div>
        <div className="capability-grid">
          <article className="capability-card">
            <CheckCircle2 size={18} />
            <strong>{L("Lecture des profils et règles", "Read profiles and rules")}</strong>
            <span>{L("Active, sans élévation", "Enabled, no elevation")}</span>
            <Badge tone="ok" dot>{L("Disponible", "Available")}</Badge>
          </article>
          <article className="capability-card">
            <CheckCircle2 size={18} />
            <strong>{L("Instantané + empreinte .sha256", "Snapshot + .sha256 digest")}</strong>
            <span>{L("Écrit dans le dossier de données", "Written under the data directory")}</span>
            <Badge tone="ok" dot>{L("Disponible", "Available")}</Badge>
          </article>
          <article className="capability-card capability-card--muted">
            <LockKeyhole size={18} />
            <strong>{L("Création ou modification de règle", "Create or modify a rule")}</strong>
            <span>{L("Aucune API de mutation exposée", "No mutation API exposed")}</span>
            <Badge tone="danger" dot>{L("Indisponible", "Unavailable")}</Badge>
          </article>
          <article className="capability-card capability-card--muted">
            <LockKeyhole size={18} />
            <strong>{L("Restauration automatique", "Automatic restore")}</strong>
            <span>{L("Aucun chemin d'import ou d'application", "No import or apply path")}</span>
            <Badge tone="danger" dot>{L("Indisponible", "Unavailable")}</Badge>
          </article>
        </div>
        <p className="panel__note">
          {L(
            "La lecture utilise INetFwPolicy2 via le wrapper audité. CBS Shield ne consulte pas les filtres WFP effectifs, ne remplace pas Windows Security et ne demande aucun privilège administratif pour cette page.",
            "Reading uses INetFwPolicy2 through the audited wrapper. CBS Shield does not query effective WFP filters, does not replace Windows Security, and requests no administrative privilege for this page.",
          )}
        </p>
      </section>

      <section className="panel">
        <div className="panel__head">
          <div>
            <span className="panel__eyebrow">{L("Garde-fous", "Safeguards")}</span>
            <h2>{L("Ce que CBS Shield ne fait pas", "What CBS Shield does not do")}</h2>
          </div>
        </div>
        <ul className="rule-list">
          <li>
            {L(
              "Aucune règle de pare-feu ajoutée, supprimée ou modifiée — jamais.",
              "No firewall rule added, removed or modified — ever.",
            )}
          </li>
          <li>
            {L(
              "Aucun pilote noyau, aucun filtre WFP, aucun pare-feu tiers (Portmaster…).",
              "No kernel driver, no WFP filter, no third-party firewall (Portmaster…).",
            )}
          </li>
          <li>
            {L(
              "Aucune modification de Microsoft Defender (ni exclusion, ni état).",
              "No change to Microsoft Defender (neither exclusions nor state).",
            )}
          </li>
          <li>
            {L(
              "Aucune élévation de privilèges demandée pour cette lecture.",
              "No privilege elevation requested for this read.",
            )}
          </li>
          <li>
            {L(
              "L'instantané JSON est une copie d'audit en lecture seule ; aucune restauration n'est exposée.",
              "The JSON snapshot is a read-only audit copy; no restore path is exposed.",
            )}
          </li>
        </ul>
        <p className="panel__note">
          {L(
            "Sprint 7 : ajout des filtres de règles, du détail en lecture seule, du regroupement par application, de l'historique d'instantanés avec empreinte .sha256 et du diagnostic des capacités. La modification du pare-feu reste hors périmètre tant que le cycle de récupération n'est pas validé.",
            "Sprint 7: adds rule filters, read-only rule details, application grouping, snapshot history with .sha256 digests, and capability diagnostics. Firewall mutation remains out of scope until the recovery cycle is validated.",
          )}
        </p>
      </section>

      <Modal
        open={selectedRule !== null}
        title={selectedRule?.name ?? ""}
        eyebrow={L("Détail de la règle observée", "Observed rule detail")}
        tone={selectedRule?.action === "bloquer" ? "danger" : "info"}
        wide
        onClose={() => setSelectedRule(null)}
        footer={
          <>
            <Badge tone="info" dot>
              {L("Lecture seule", "Read-only")}
            </Badge>
            <button
              type="button"
              className="button button--primary"
              onClick={() => setSelectedRule(null)}
            >
              {L("Fermer", "Close")}
            </button>
          </>
        }
      >
        {selectedRule && (
          <div className="rule-detail">
            <div className="rule-detail__summary">
              {directionBadge(selectedRule, L)}
              {actionBadge(selectedRule, L)}
              <Badge tone={selectedRule.enabled ? "ok" : "neutral"} dot>
                {selectedRule.enabled
                  ? L("Activée", "Enabled")
                  : L("Désactivée", "Disabled")}
              </Badge>
              <Badge tone="neutral">{profilesLabel(selectedRule.profiles)}</Badge>
            </div>
            {selectedRule.description && (
              <p className="rule-detail__description">{selectedRule.description}</p>
            )}
            <dl className="rule-detail__grid">
              <div>
                <dt>{L("Nom", "Name")}</dt>
                <dd>{selectedRule.name}</dd>
              </div>
              <div>
                <dt>{L("Groupe", "Group")}</dt>
                <dd>{selectedRule.grouping || "—"}</dd>
              </div>
              <div>
                <dt>{L("Direction", "Direction")}</dt>
                <dd>{directionBadge(selectedRule, L)}</dd>
              </div>
              <div>
                <dt>{L("Action", "Action")}</dt>
                <dd>{actionBadge(selectedRule, L)}</dd>
              </div>
              <div>
                <dt>{L("Protocole", "Protocol")}</dt>
                <dd className="mono">{protocolLabel(selectedRule.protocol)}</dd>
              </div>
              <div>
                <dt>{L("Ports locaux", "Local ports")}</dt>
                <dd className="mono">{portLabel(selectedRule.localPorts || "tout")}</dd>
              </div>
              <div>
                <dt>{L("Ports distants", "Remote ports")}</dt>
                <dd className="mono">{portLabel(selectedRule.remotePorts || "tout")}</dd>
              </div>
              <div>
                <dt>{L("Profils", "Profiles")}</dt>
                <dd>{profilesLabel(selectedRule.profiles)}</dd>
              </div>
              <div className="rule-detail__wide">
                <dt>{L("Programme", "Program")}</dt>
                <dd className="mono">{selectedRule.applicationName || "—"}</dd>
              </div>
              <div className="rule-detail__wide">
                <dt>{L("Service", "Service")}</dt>
                <dd className="mono">{selectedRule.serviceName || "—"}</dd>
              </div>
              <div className="rule-detail__wide">
                <dt>{L("Description", "Description")}</dt>
                <dd>{selectedRule.description || "—"}</dd>
              </div>
            </dl>
            <div className="callout callout--info">
              <strong>{L("Ce détail est une observation", "This detail is an observation")}</strong>
              <span>
                {L(
                  "La règle est affichée telle que lue dans la stratégie Windows. CBS Shield ne calcule pas la priorité entre règles, les filtres WFP, IPsec ou la décision effective pour un paquet.",
                  "The rule is displayed as read from Windows policy. CBS Shield does not calculate precedence between rules, WFP filters, IPsec or the effective decision for a packet.",
                )}
              </span>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
