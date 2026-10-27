import {
  Activity,
  CheckCircle2,
  Download,
  Flame,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "../components/Badge";
import { EmptyState } from "../components/EmptyState";
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

function toneForSeverity(severity: string): "danger" | "warning" | "info" {
  if (severity === "danger") return "danger";
  if (severity === "warning") return "warning";
  return "info";
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
  const [connections, setConnections] = useState<FirewallConnections | null>(null);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);
  const [management, setManagement] = useState<RuleManagementStatus | null>(null);
  const [managementError, setManagementError] = useState<string | null>(null);
  const [exportInfo, setExportInfo] = useState<FirewallSnapshotExport | null>(null);
  const [exporting, setExporting] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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

  const refreshAll = useCallback(async () => {
    await Promise.all([inspect(), loadConnections(), loadManagement()]);
  }, [inspect, loadConnections, loadManagement]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const visibleRules = useMemo(
    () => status?.rules.filter((rule) => ruleMatches(rule, query)) ?? [],
    [status, query],
  );

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
      await loadManagement();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

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

      {observation && observation.alerts.length > 0 && (
        <section className="security-alert-stack" aria-label={L("Alertes de sécurité", "Security alerts")}>
          {observation.alerts.map((alert, index) => {
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
          })}
        </section>
      )}

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

      <section className="panel">
        <div className="panel__head">
          <div>
            <span className="panel__eyebrow">{L("Profils", "Profiles")}</span>
            <h2>{L("État par profil", "Status by profile")}</h2>
          </div>
          <div className="row-actions">
            {status && status.activeProfiles.length > 0 && (
              <Badge tone="info" dot>
                {L("Actif : ", "Active: ")}
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

            {connections.rows.length === 0 ? (
              <EmptyState
                icon={Activity}
                title={L("Aucune connexion TCP visible", "No visible TCP connection")}
                description={L(
                  "La capture est réelle et en lecture seule. Aucune connexion TCP n'était active au moment de la mesure.",
                  "The capture is real and read-only. No TCP connection was active at measurement time.",
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
                    {connections.rows.map((row, index) => (
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

      <section className="panel">
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
                `Aucune API de mutation n'est exposée. Les instantanés JSON en lecture seule sont écrits dans ${management.backupDirectory} (${formatNumber(management.snapshotCount)} présent${management.snapshotCount > 1 ? "s" : ""}).`,
                `No mutation API is exposed. Read-only JSON snapshots are written to ${management.backupDirectory} (${formatNumber(management.snapshotCount)} present).`,
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
              <p className="panel__note panel__note--success">
                <CheckCircle2 size={14} />{" "}
                {L(
                  `Instantané écrit : ${exportInfo.path} (${formatNumber(exportInfo.rulesSaved)}/${formatNumber(exportInfo.rulesTotalCount)} règles${exportInfo.truncated ? ", tronqué" : ""}).`,
                  `Snapshot written: ${exportInfo.path} (${formatNumber(exportInfo.rulesSaved)}/${formatNumber(exportInfo.rulesTotalCount)} rules${exportInfo.truncated ? ", truncated" : ""}).`,
                )}
              </p>
            )}
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

      <section className="panel">
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
        </div>

        <div className="filter-row">
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
                </tr>
              </thead>
              <tbody>
                {visibleRules.map((rule, index) => (
                  <tr key={index} className={rule.enabled ? "" : "is-muted"}>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
            "Fondation Sprint 5 : observation, alertes réelles, détection de changement composite et association processus-règles. La modification du pare-feu reste hors périmètre.",
            "Sprint 5 foundation: observation, real alerts, composite change detection and process-to-rule mapping. Firewall mutation remains out of scope.",
          )}
        </p>
      </section>
    </div>
  );
}
