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
import type {
  NetmonConnection,
  NetmonSnapshotPayload,
  NetmonSnapshotRecord,
} from "../types";

const REFRESH_INTERVAL_MS = 5_000;
const HISTORY_ROWS_FETCHED = 30;

type TransportFilter = "all" | "tcp" | "udp" | "established";

const FILTER_LABELS: Record<TransportFilter, string> = {
  all: "Tout",
  tcp: "TCP",
  udp: "UDP",
  established: "TCP établies",
};

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
  const [payload, setPayload] = useState<NetmonSnapshotPayload | null>(null);
  const [history, setHistory] = useState<NetmonSnapshotRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TransportFilter>("all");
  const captureBusy = useRef(false);

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
          <strong>Observation lecture seule — aucune capture de contenu</strong>
          <span>
            Ce module lit les connexions et ports via les API Windows documentées
            (tables IP Helper) et compte les octets cumulés par interface. Rien
            n'est bloqué, filtré ni intercepté ; aucun contenu de communication
            n'est lu. Les résumés restent dans la base locale de votre profil
            utilisateur (2 000 lignes maximum, purge automatique) et ne quittent
            jamais votre poste.
          </span>
        </div>
      </div>

      {error && (
        <div className="banner banner--danger">
          <div>
            <strong>Capture réseau indisponible</strong>
            <span>{error}</span>
            <div className="banner__actions">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => void capture()}
              >
                <RefreshCw size={15} />
                Réessayer
              </button>
            </div>
          </div>
        </div>
      )}

      {payload?.persistenceError && (
        <div className="banner banner--warning">
          <div>
            <strong>Historique local momentanément indisponible</strong>
            <span>{payload.persistenceError}</span>
          </div>
        </div>
      )}

      <section className="panel">
        <div className="panel__head">
          <div>
            <span className="panel__eyebrow">Instantané</span>
            <h2>
              {payload ? `Capturé à ${formatDateTime(payload.snapshot.capturedAt)}` : "Capture réseau"}
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
                <strong>Rafraîchissement auto 5 s</strong>
                <small>Mesure nouvelle toutes les 5 secondes, uniquement au premier plan.</small>
              </span>
            </label>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => void capture()}
            >
              {loading ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
              Actualiser
            </button>
          </div>
        </div>

        <div className="stat-grid" aria-label="Métriques mesurées de l'instantané">
          <article className="stat">
            <div className="stat__icon stat__icon--blue">
              <Activity size={19} />
            </div>
            <div>
              <span className="stat__label">Connexions TCP</span>
              <strong>{formatNumber(payload?.tcpTotal ?? 0)}</strong>
            </div>
          </article>
          <article className="stat">
            <div className="stat__icon stat__icon--cyan">
              <Eye size={19} />
            </div>
            <div>
              <span className="stat__label">TCP établies</span>
              <strong>{formatNumber(payload?.tcpEstablished ?? 0)}</strong>
            </div>
          </article>
          <article className="stat">
            <div className="stat__icon stat__icon--amber">
              <Activity size={19} />
            </div>
            <div>
              <span className="stat__label">Ports UDP liés</span>
              <strong>{formatNumber(payload?.udpTotal ?? 0)}</strong>
            </div>
          </article>
          <article className="stat">
            <div className="stat__icon stat__icon--red">
              <Database size={19} />
            </div>
            <div>
              <span className="stat__label">Historique local</span>
              <strong>{formatNumber(payload?.historyRows ?? 0)}</strong>
            </div>
          </article>
        </div>

        {payload && (
          <dl className="detail-list">
            <div>
              <dt
                title="Delta d'octets reçus mesuré entre cette capture et la précédente"
              >
                Octets reçus (delta mesuré)
              </dt>
              <dd className="mono">
                <ArrowDown size={13} /> {formatBytes(payload.rxBytesDelta)}
              </dd>
            </div>
            <div>
              <dt
                title="Delta d'octets émis mesuré entre cette capture et la précédente"
              >
                Octets émis (delta mesuré)
              </dt>
              <dd className="mono">
                <ArrowUp size={13} /> {formatBytes(payload.txBytesDelta)}
              </dd>
            </div>
            <div>
              <dt>Interfaces actives</dt>
              <dd>
                {payload.snapshot.interfaces.length === 0
                  ? "aucune interface opérationnelle relevée"
                  : payload.snapshot.interfaces
                      .map((interface_) => interface_.alias)
                      .join(", ")}
              </dd>
            </div>
            <div>
              <dt>Processus les plus connectés</dt>
              <dd>
                {payload.topProcesses.length === 0
                  ? "aucun processus identifiable"
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
            Les deltas ci-dessus comparent deux captures successives des compteurs
            cumulés de chaque interface : ce sont des mesures réelles, pas des
            estimations. À la première capture de cette session, aucun delta
            n'existe encore, il vaut 0.
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel__head">
          <div>
            <span className="panel__eyebrow">Connexions</span>
            <h2>
              Connexions de cette capture{" "}
              <span className="muted">
                {rows.length === totalRows
                  ? `(${formatNumber(totalRows)})`
                  : `(${formatNumber(rows.length)} affichées sur ${formatNumber(totalRows)})`}
              </span>
            </h2>
          </div>
        </div>

        <div className="filter-row">
          <div className="field field--grow">
            <label className="field__label" htmlFor="netmon-search">
              Recherche locale
            </label>
            <input
              id="netmon-search"
              className="input"
              type="search"
              placeholder="Processus, adresse, port, état…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="segmented" role="tablist" aria-label="Filtrer par transport">
            {(Object.keys(FILTER_LABELS) as TransportFilter[]).map((value) => (
              <button
                key={value}
                type="button"
                className={filter === value ? "is-active" : ""}
                onClick={() => setFilter(value)}
              >
                {FILTER_LABELS[value]}
              </button>
            ))}
          </div>
        </div>

        {loading && !payload ? (
          <div className="loading-row">
            <LoaderCircle size={18} className="spin" />
            Capture des tables réseau…
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={EyeOff}
            title="Aucune connexion correspondante"
            description="Modifiez la recherche ou relancez une capture pour actualiser la liste."
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Transport</th>
                  <th>Processus</th>
                  <th>Local</th>
                  <th>Distant</th>
                  <th>État</th>
                  <th className="num">PID</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((connection, index) => (
                  <tr key={`${connection.transport}-${index}`}>
                    <td>{connectionBadge(connection)}</td>
                    <td title={connection.processName ?? undefined}>
                      {connection.processName ?? (
                        <span className="muted">inconnu</span>
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
            <span className="panel__eyebrow">Historique</span>
            <h2>{HISTORY_ROWS_FETCHED} dernières mesures locales</h2>
          </div>
        </div>
        {history.length === 0 ? (
          <p className="panel__note">
            Aucune mesure stockée pour l'instant. L'historique se remplit à chaque
            capture (manuellement ou toutes les 5 secondes) et reste limité à
            2 000 lignes, purgées automatiquement.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Heure</th>
                  <th className="num">TCP</th>
                  <th className="num">Établies</th>
                  <th className="num">UDP</th>
                  <th className="num">↓ octets</th>
                  <th className="num">↑ octets</th>
                  <th>Processus dominants</th>
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
