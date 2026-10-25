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
import type {
  FirewallObservation,
  FirewallRuleSummary,
  FirewallStatus,
} from "../types";

function directionBadge(rule: FirewallRuleSummary) {
  return rule.direction === "entrant" ? (
    <Badge tone="info" dot>Entrant</Badge>
  ) : rule.direction === "sortant" ? (
    <Badge tone="warning" dot>Sortant</Badge>
  ) : (
    <Badge tone="neutral" dot>{rule.direction || "?"}</Badge>
  );
}

function actionBadge(rule: FirewallRuleSummary) {
  return rule.action === "bloquer" ? (
    <Badge tone="danger" dot>Bloquer</Badge>
  ) : rule.action === "autoriser" ? (
    <Badge tone="ok" dot>Autoriser</Badge>
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
          <strong>Observation lecture seule — aucune règle modifiée</strong>
          <span>
            Cette section lit l'état des profils et des règles du Pare-feu
            Windows via l'API documentée <code>INetFwPolicy2</code>. Aucune règle
            n'est ajoutée, supprimée, activée ou désactivée ; aucun pilote ni
            filtre réseau n'est installé ; Microsoft Defender n'est pas touché.
            Appliquer des règles reste du ressort de Windows.
          </span>
        </div>
      </div>

      {error && (
        <div className="banner banner--danger">
          <div>
            <strong>Pare-feu Windows indisponible</strong>
            <span>{error}</span>
            <div className="banner__actions">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => void inspect()}
              >
                <RefreshCw size={15} />
                Réessayer
              </button>
            </div>
          </div>
        </div>
      )}

      {observation?.changedSinceLast && (
        <div className="banner banner--warning">
          <TriangleAlert size={19} aria-hidden="true" />
          <div>
            <strong>Configuration différente depuis la dernière observation</strong>
            <span>
              {observation.previousCheckedAt
                ? `La dernière observation datée du ${formatDateTime(observation.previousCheckedAt)} a constaté un autre jeu de règles.`
                : "Une observation précédente a constaté un autre jeu de règles."}
              {" "}CBS Shield ne modifie rien : la vérification de la source du
              changement vous appartient.
            </span>
          </div>
        </div>
      )}

      <section className="panel">
        <div className="panel__head">
          <div>
            <span className="panel__eyebrow">Profils</span>
            <h2>État par profil</h2>
          </div>
          <div className="row-actions">
            {status && status.activeProfiles.length > 0 && (
              <Badge tone="info" dot>
                Actif : {status.activeProfiles.join(" + ")}
              </Badge>
            )}
            <button
              type="button"
              className="button button--ghost"
              onClick={() => void inspect()}
            >
              {loading ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
              Actualiser
            </button>
          </div>
        </div>

        {loading && !status ? (
          <div className="loading-row">
            <LoaderCircle size={18} className="spin" />
            Lecture de la configuration du pare-feu…
          </div>
        ) : status ? (
          <>
            <div className="module-grid">
              {status.profiles.map((profile) => (
                <article key={profile.profile} className="module-card">
                  <div className="module-card__top">
                    <Flame size={20} />
                    <Badge tone={profile.enabled ? "ok" : "danger"} dot>
                      {profile.enabled ? "Activé" : "Désactivé"}
                    </Badge>
                  </div>
                  <strong>{profile.profile}</strong>
                  <span>
                    Connexions entrantes par défaut : {profile.inboundDefault} ·
                    sortantes : {profile.outboundDefault}
                  </span>
                </article>
              ))}
            </div>
            <p className="panel__note">
              Observé à {formatDateTime(status.checkedAt)} ·{" "}
              {formatNumber(status.rulesTotalCount)} règle
              {status.rulesTotalCount > 1 ? "s" : ""} dans la stratégie.
            </p>
          </>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel__head">
          <div>
            <span className="panel__eyebrow">Règles</span>
            <h2>
              Règles existantes{" "}
              <span className="muted">
                {status
                  ? visibleRules.length === status.rules.length
                    ? `(${formatNumber(status.rules.length)} affichées)`
                    : `(${formatNumber(visibleRules.length)} sur ${formatNumber(status.rules.length)} affichées)`
                  : ""}
              </span>
            </h2>
          </div>
        </div>

        <div className="filter-row">
          <div className="field field--grow">
            <label className="field__label" htmlFor="firewall-search">
              Recherche locale
            </label>
            <input
              id="firewall-search"
              className="input"
              type="search"
              placeholder="Nom, programme, protocole, port, groupe…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>

        {observation?.listedTruncated && (
          <p className="panel__note">
            Affichage limité aux 1 000 premières règles par taille d'affichage ;
            le compteur de règles et l'empreinte de configuration portent sur
            l'intégralité.
          </p>
        )}

        {!status ? null : visibleRules.length === 0 ? (
          <EmptyState
            icon={Flame}
            title={status.rules.length === 0 ? "Aucune règle déclarée" : "Aucune règle correspondante"}
            description={
              status.rules.length === 0
                ? "La stratégie du pare-feu Windows ne contient pas de règle personnalisée."
                : "Modifiez la recherche pour élargir les résultats."
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Direction</th>
                  <th>Action</th>
                  <th>État</th>
                  <th>Proto</th>
                  <th>Ports</th>
                  <th>Profil</th>
                  <th>Programme</th>
                  <th>Groupe</th>
                </tr>
              </thead>
              <tbody>
                {visibleRules.map((rule, index) => (
                  <tr key={index} className={rule.enabled ? "" : "is-muted"}>
                    <td title={rule.description || rule.name}>
                      {truncateMiddle(rule.name, 42)}
                    </td>
                    <td>{directionBadge(rule)}</td>
                    <td>{actionBadge(rule)}</td>
                    <td>
                      <Badge tone={rule.enabled ? "ok" : "neutral"} dot>
                        {rule.enabled ? "Activée" : "Désactivée"}
                      </Badge>
                    </td>
                    <td className="mono">{rule.protocol}</td>
                    <td className="mono">
                      {rule.localPorts ? (
                        <span title={`distant : ${rule.remotePorts || "tout"}`}>
                          {truncateMiddle(rule.localPorts, 18)}
                        </span>
                      ) : (
                        <span className="muted">tout</span>
                      )}
                    </td>
                    <td>{rule.profiles}</td>
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
            <span className="panel__eyebrow">Garde-fous</span>
            <h2>Ce que CBS Shield ne fait pas</h2>
          </div>
        </div>
        <ul className="rule-list">
          <li>Aucune règle de pare-feu ajoutée, supprimée ou modifiée — jamais.</li>
          <li>Aucun pilote noyau, aucun filtre WFP, aucun pare-feu tiers (Portmaster…).</li>
          <li>Aucune modification de Microsoft Defender (ni exclusion, ni état).</li>
          <li>Aucune élévation de privilèges demandée pour cette lecture.</li>
        </ul>
        <p className="panel__note">
          Fondation Phase 2 : observation uniquement. La détection de
          modification repose sur une empreinte SHA-256 du jeu de règles stockée
          localement, comparée à chaque observation.
        </p>
      </section>
    </div>
  );
}
