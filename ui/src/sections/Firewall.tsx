import {
  Flame,
  LoaderCircle,
  RefreshCw,
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
  FirewallObservation,
  FirewallRuleSummary,
  FirewallStatus,
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

export function Firewall() {
  const { language } = useI18n();
  const L = (fr: string, en: string) => (language === "en" ? en : fr);
  const actionLabel = (value: string) =>
    value === "bloquer"
      ? L("Bloquer", "Block")
      : value === "autoriser"
        ? L("Autoriser", "Allow")
        : value;
  const profileLabel = (value: string) =>
    value === "domaine"
      ? L("Domaine", "Domain")
      : value === "privé"
        ? L("Privé", "Private")
        : value === "public"
          ? L("Public", "Public")
          : value === "tous"
            ? L("Tous", "All")
            : value;
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

  useEffect(() => {
    void inspect();
  }, [inspect]);

  const visibleRules = useMemo(
    () => status?.rules.filter((rule) => ruleMatches(rule, query)) ?? [],
    [status, query],
  );

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
              ". Aucune règle n'est ajoutée, supprimée, activée ou désactivée ; aucun pilote ni filtre réseau n'est installé ; Microsoft Defender n'est pas touché. Appliquer des règles reste du ressort de Windows.",
              " API. No rule is added, removed, enabled or disabled; no driver or network filter is installed; Microsoft Defender is not touched. Applying rules remains Windows' responsibility.",
            )}
          </span>
        </div>
      </div>

      {error && (
        <div className="banner banner--danger">
          <div>
            <strong>{L("Pare-feu Windows indisponible", "Windows firewall unavailable")}</strong>
            <span>{error}</span>
            <div className="banner__actions">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => void inspect()}
              >
                <RefreshCw size={15} />
                {L("Réessayer", "Retry")}
              </button>
            </div>
          </div>
        </div>
      )}

      {observation?.changedSinceLast && (
        <div className="banner banner--warning">
          <TriangleAlert size={19} aria-hidden="true" />
          <div>
            <strong>
              {L(
                "Configuration différente depuis la dernière observation",
                "Configuration different since the last observation",
              )}
            </strong>
            <span>
              {observation.previousCheckedAt
                ? L(
                    `La dernière observation datée du ${formatDateTime(observation.previousCheckedAt)} a constaté un autre jeu de règles.`,
                    `The last observation, dated ${formatDateTime(observation.previousCheckedAt)}, found a different rule set.`,
                  )
                : L(
                    "Une observation précédente a constaté un autre jeu de règles.",
                    "A previous observation found a different rule set.",
                  )}
              {" "}
              {L(
                "CBS Shield ne modifie rien : la vérification de la source du changement vous appartient.",
                "CBS Shield changes nothing: verifying the source of the change is up to you.",
              )}
            </span>
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
              onClick={() => void inspect()}
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
                <article key={profile.profile} className="module-card">
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
                `Observé à ${formatDateTime(status.checkedAt)} · ${formatNumber(status.rulesTotalCount)} règle${status.rulesTotalCount > 1 ? "s" : ""} dans la stratégie.`,
                `Observed at ${formatDateTime(status.checkedAt)} · ${formatNumber(status.rulesTotalCount)} rule${status.rulesTotalCount > 1 ? "s" : ""} in the policy.`,
              )}
            </p>
          </>
        ) : null}
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
        </ul>
        <p className="panel__note">
          {L(
            "Fondation Phase 2 : observation uniquement. La détection de modification repose sur une empreinte SHA-256 du jeu de règles stockée localement, comparée à chaque observation.",
            "Phase 2 foundation: observation only. Change detection relies on a locally stored SHA-256 fingerprint of the rule set, compared on every observation.",
          )}
        </p>
      </section>
    </div>
  );
}
