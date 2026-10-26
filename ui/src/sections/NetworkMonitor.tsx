import {
  Activity,
  ArrowDown,
  ArrowUp,
  Database,
  Eye,
  EyeOff,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "../components/Badge";
import { EmptyState } from "../components/EmptyState";
import { api, errorMessage } from "../lib/api";
import {
  formatBytes,
  formatDateTime,
  formatNumber,
  truncateMiddle,
} from "../lib/format";
import { useI18n } from "../lib/i18n";
import type {
  NetmonConnection,
  NetmonSnapshotPayload,
  NetmonSnapshotRecord,
} from "../types";

const REFRESH_INTERVAL_MS = 5_000;
const HISTORY_ROWS_FETCHED = 30;

type TransportFilter = "all" | "tcp" | "udp" | "established";

const TRANSPORT_FILTERS: readonly TransportFilter[] = [
  "all",
  "tcp",
  "udp",
  "established",
];

function matchesQuery(connection: NetmonConnection, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return (
    connection.localIp.toLowerCase().includes(needle) ||
    connection.processName?.toLowerCase().includes(needle) ||
    (connection.remoteIp?.toLowerCase().includes(needle) ?? false) ||
    (connection.state?.toLowerCase().includes(needle) ?? false) ||
    String(connection.localPort).includes(query) ||
    String(connection.remotePort ?? "").includes(query)
  );
}

function passesFilter(connection: NetmonConnection, filter: TransportFilter, query: string): boolean {
  if (!matchesQuery(connection, query)) return false;
  switch (filter) {
    case "tcp":
      return connection.transport === "tcp";
    case "udp":
      return connection.transport === "udp";
    case "established":
      return connection.transport === "tcp" && connection.state === "ESTABLISHED";
    default:
      return true;
  }
}

function endpointLabel(ip: string | null, port: number | null): string {
  if (ip === null && port === null) return "—";
  const shownIp = ip === null ? "?" : ip;
  const shownPort = port === null ? "?" : String(port);
  if (ip !== null && ip.includes(":")) {
    return `[${shownIp}]:${shownPort}`;
  }
  return `${shownIp}:${shownPort}`;
}

function connectionBadge(connection: NetmonConnection) {
  if (connection.transport === "udp") {
    return <Badge tone="info" dot>UDP</Badge>;
  }
  if (connection.state === "ESTABLISHED") {
    return <Badge tone="warning" dot>TCP</Badge>;
  }
  return <Badge tone="neutral" dot>TCP</Badge>;
}

export function NetworkMonitor() {
  const { language } = useI18n();
  const L = (fr: string, en: string) => (language === "en" ? en : fr);

  const [payload, setPayload] = useState<NetmonSnapshotPayload | null>(null);
  const [history, setHistory] = useState<NetmonSnapshotRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TransportFilter>("all");
  const captureBusy = useRef(false);

  const filterLabels: Record<TransportFilter, string> = {
    all: L("Tout", "All"),
    tcp: "TCP",
    udp: "UDP",
    established: L("TCP établies", "Established TCP"),
  };

  const capture = useCallback(async () => {
    // Overlap guard: a manual refresh while the 5-second timer fires must not
    // push two captures into the same instant (measured deltas need spacing).
    if (captureBusy.current) return;
    captureBusy.current = true;
    try {
      const [snapshotPayload, historyRows] = await Promise.all([
        api.netmonSnapshot(),
        api.netmonHistory(HISTORY_ROWS_FETCHED),
      ]);
      setPayload(snapshotPayload);
      setHistory(historyRows);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      captureBusy.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void capture();
  }, [capture]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void capture();
      }
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [autoRefresh, capture]);

  const rows = useMemo(() => {
    if (!payload) return [];
    return [
      ...payload.snapshot.tcpConnections,
      ...payload.snapshot.udpBindings,
    ].filter((connection) => passesFilter(connection, filter, query));
  }, [payload, filter, query]);

  const totalRows = payload
    ? payload.snapshot.tcpConnections.length + payload.snapshot.udpBindings.length
    : 0;

  return (
    <div className="section-stack">
      <div className="banner banner--info">
        <Eye size={19} aria-hidden="true" />
        <div>
          <strong>
            {L(
              "Observation lecture seule — aucune capture de contenu",
              "Read-only observation — no content capture",
            )}
          </strong>
          <span>
            {L(
              "Ce module lit les connexions et ports via les API Windows documentées (tables IP Helper) et compte les octets cumulés par interface. Rien n'est bloqué, filtré ni intercepté ; aucun contenu de communication n'est lu. Les résumés restent dans la base locale de votre profil utilisateur (2 000 lignes maximum, purge automatique) et ne quittent jamais votre poste.",
              "This module reads connections and ports through documented Windows APIs (IP Helper tables) and counts cumulative bytes per interface. Nothing is blocked, filtered or intercepted; no communication content is read. Summaries stay in the local database of your user profile (2,000 rows maximum, automatic purge) and never leave your machine.",
            )}
          </span>
        </div>
      </div>

      {error && (
        <div className="banner banner--danger">
          <div>
            <strong>{L("Capture réseau indisponible", "Network capture unavailable")}</strong>
            <span>{error}</span>
            <div className="banner__actions">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => void capture()}
              >
                <RefreshCw size={15} />
                {L("Réessayer", "Retry")}
              </button>
            </div>
          </div>
        </div>
      )}

      {payload?.persistenceError && (
        <div className="banner banner--warning">
          <div>
            <strong>
              {L(
                "Historique local momentanément indisponible",
                "Local history temporarily unavailable",
              )}
            </strong>
            <span>{payload.persistenceError}</span>
          </div>
        </div>
      )}

      <section className="panel">
        <div className="panel__head">
          <div>
            <span className="panel__eyebrow">{L("Instantané", "Snapshot")}</span>
            <h2>
              {payload
                ? L(
                    `Capturé à ${formatDateTime(payload.snapshot.capturedAt)}`,
                    `Captured at ${formatDateTime(payload.snapshot.capturedAt)}`,
                  )
                : L("Capture réseau", "Network capture")}
            </h2>
          </div>
          <div className="row-actions">
            <label className="switch-row switch-row--inline">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(event) => setAutoRefresh(event.target.checked)}
              />
              <span>
                <strong>{L("Rafraîchissement auto 5 s", "Auto-refresh 5 s")}</strong>
                <small>
                  {L(
                    "Mesure nouvelle toutes les 5 secondes, uniquement au premier plan.",
                    "New measurement every 5 seconds, foreground only.",
                  )}
                </small>
              </span>
            </label>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => void capture()}
            >
              {loading ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
              {L("Actualiser", "Refresh")}
            </button>
          </div>
        </div>

        <div
          className="stat-grid"
          aria-label={L("Métriques mesurées de l'instantané", "Measured snapshot metrics")}
        >
          <article className="stat">
            <div className="stat__icon stat__icon--blue">
              <Activity size={19} />
            </div>
            <div>
              <span className="stat__label">{L("Connexions TCP", "TCP connections")}</span>
              <strong>{formatNumber(payload?.tcpTotal ?? 0)}</strong>
            </div>
          </article>
          <article className="stat">
            <div className="stat__icon stat__icon--cyan">
              <Eye size={19} />
            </div>
            <div>
              <span className="stat__label">{L("TCP établies", "Established TCP")}</span>
              <strong>{formatNumber(payload?.tcpEstablished ?? 0)}</strong>
            </div>
          </article>
          <article className="stat">
            <div className="stat__icon stat__icon--amber">
              <Activity size={19} />
            </div>
            <div>
              <span className="stat__label">{L("Ports UDP liés", "Bound UDP ports")}</span>
              <strong>{formatNumber(payload?.udpTotal ?? 0)}</strong>
            </div>
          </article>
          <article className="stat">
            <div className="stat__icon stat__icon--red">
              <Database size={19} />
            </div>
            <div>
              <span className="stat__label">{L("Historique local", "Local history")}</span>
              <strong>{formatNumber(payload?.historyRows ?? 0)}</strong>
            </div>
          </article>
        </div>

        {payload && (
          <dl className="detail-list">
            <div>
              <dt
                title={L(
                  "Delta d'octets reçus mesuré entre cette capture et la précédente",
                  "Received byte delta measured between this capture and the previous one",
                )}
              >
                {L("Octets reçus (delta mesuré)", "Bytes received (measured delta)")}
              </dt>
              <dd className="mono">
                <ArrowDown size={13} /> {formatBytes(payload.rxBytesDelta)}
              </dd>
            </div>
            <div>
              <dt
                title={L(
                  "Delta d'octets émis mesuré entre cette capture et la précédente",
                  "Sent byte delta measured between this capture and the previous one",
                )}
              >
                {L("Octets émis (delta mesuré)", "Bytes sent (measured delta)")}
              </dt>
              <dd className="mono">
                <ArrowUp size={13} /> {formatBytes(payload.txBytesDelta)}
              </dd>
            </div>
            <div>
              <dt>{L("Interfaces actives", "Active interfaces")}</dt>
              <dd>
                {payload.snapshot.interfaces.length === 0
                  ? L(
                      "aucune interface opérationnelle relevée",
                      "no operational interface found",
                    )
                  : payload.snapshot.interfaces
                      .map((interface_) => interface_.alias)
                      .join(", ")}
              </dd>
            </div>
            <div>
              <dt>
                {L("Processus les plus connectés", "Most connected processes")}
              </dt>
              <dd>
                {payload.topProcesses.length === 0
                  ? L("aucun processus identifiable", "no identifiable process")
                  : payload.topProcesses
                      .map(
                        (entry) => `${entry.name} (${formatNumber(entry.connections)})`,
                      )
                      .join(", ")}
              </dd>
            </div>
          </dl>
        )}
        {payload && (
          <p className="panel__note">
            {L(
              "Les deltas ci-dessus comparent deux captures successives des compteurs cumulés de chaque interface : ce sont des mesures réelles, pas des estimations. À la première capture de cette session, aucun delta n'existe encore, il vaut 0.",
              "The deltas above compare two successive captures of each interface's cumulative counters: these are real measurements, not estimates. On the first capture of a session no delta exists yet, and it is 0.",
            )}
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel__head">
          <div>
            <span className="panel__eyebrow">{L("Connexions", "Connections")}</span>
            <h2>
              {L("Connexions de cette capture", "Connections in this capture")}{" "}
              <span className="muted">
                {rows.length === totalRows
                  ? `(${formatNumber(totalRows)})`
                  : L(
                      `(${formatNumber(rows.length)} affichées sur ${formatNumber(totalRows)})`,
                      `(${formatNumber(rows.length)} shown of ${formatNumber(totalRows)})`,
                    )}
              </span>
            </h2>
          </div>
        </div>

        <div className="filter-row">
          <div className="field field--grow">
            <label className="field__label" htmlFor="netmon-search">
              {L("Recherche locale", "Local search")}
            </label>
            <input
              id="netmon-search"
              className="input"
              type="search"
              placeholder={L(
                "Processus, adresse, port, état…",
                "Process, address, port, state…",
              )}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div
            className="segmented"
            role="tablist"
            aria-label={L("Filtrer par transport", "Filter by transport")}
          >
            {TRANSPORT_FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                className={filter === value ? "is-active" : ""}
                onClick={() => setFilter(value)}
              >
                {filterLabels[value]}
              </button>
            ))}
          </div>
        </div>

        {loading && !payload ? (
          <div className="loading-row">
            <LoaderCircle size={18} className="spin" />
            {L("Capture des tables réseau…", "Capturing network tables…")}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={EyeOff}
            title={L("Aucune connexion correspondante", "No matching connection")}
            description={L(
              "Modifiez la recherche ou relancez une capture pour actualiser la liste.",
              "Change the search or run a new capture to refresh the list.",
            )}
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{L("Transport", "Transport")}</th>
                  <th>{L("Processus", "Process")}</th>
                  <th>{L("Local", "Local")}</th>
                  <th>{L("Distant", "Remote")}</th>
                  <th>{L("État", "State")}</th>
                  <th className="num">PID</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((connection, index) => (
                  <tr key={`${connection.transport}-${index}`}>
                    <td>{connectionBadge(connection)}</td>
                    <td title={connection.processName ?? undefined}>
                      {connection.processName ?? (
                        <span className="muted">{L("inconnu", "unknown")}</span>
                      )}
                    </td>
                    <td className="mono">
                      {endpointLabel(connection.localIp, connection.localPort)}
                    </td>
                    <td className="mono">
                      {endpointLabel(connection.remoteIp, connection.remotePort)}
                    </td>
                    <td>{connection.state ?? <span className="muted">—</span>}</td>
                    <td className="num">{connection.pid === 0 ? "—" : connection.pid}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel panel--muted">
        <div className="panel__head">
          <div>
            <span className="panel__eyebrow">{L("Historique", "History")}</span>
            <h2>
              {L(
                `${HISTORY_ROWS_FETCHED} dernières mesures locales`,
                `Last ${HISTORY_ROWS_FETCHED} local measurements`,
              )}
            </h2>
          </div>
        </div>
        {history.length === 0 ? (
          <p className="panel__note">
            {L(
              "Aucune mesure stockée pour l'instant. L'historique se remplit à chaque capture (manuellement ou toutes les 5 secondes) et reste limité à 2 000 lignes, purgées automatiquement.",
              "No measurement stored yet. History fills up on every capture (manually or every 5 seconds) and is capped at 2,000 rows, purged automatically.",
            )}
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{L("Heure", "Time")}</th>
                  <th className="num">TCP</th>
                  <th className="num">{L("Établies", "Established")}</th>
                  <th className="num">UDP</th>
                  <th className="num">{L("↓ octets", "↓ bytes")}</th>
                  <th className="num">{L("↑ octets", "↑ bytes")}</th>
                  <th>{L("Processus dominants", "Top processes")}</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTime(row.capturedAt)}</td>
                    <td className="num">{row.tcpTotal}</td>
                    <td className="num">{row.tcpEstablished}</td>
                    <td className="num">{row.udpTotal}</td>
                    <td className="num">{formatBytes(row.rxBytesDelta)}</td>
                    <td className="num">{formatBytes(row.txBytesDelta)}</td>
                    <td>
                      {row.topProcesses.length === 0
                        ? "—"
                        : truncateMiddle(
                            row.topProcesses
                              .map((entry) => `${entry.name} (${entry.connections})`)
                              .join(", "),
                            48,
                          )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
