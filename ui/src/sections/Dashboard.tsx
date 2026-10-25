import {
  Activity,
  ArrowRight,
  Archive,
  CircleAlert,
  CircleCheck,
  Clock,
  Database,
  FileSearch,
  Flame,
  ShieldCheck,
  TriangleAlert,
  WifiOff,
} from "lucide-react";

import {
  formatDateTime,
  formatNumber,
  outcomeLabel,
  outcomeTone,
  plural,
  signatureStateLabel,
  signatureStateTone,
  truncateMiddle,
} from "../lib/format";
import type {
  AppInfo,
  DashboardStats,
  EngineStatus,
  ScanRecord,
  SectionId,
} from "../types";
import { Badge } from "../components/Badge";
import { EmptyState } from "../components/EmptyState";

interface DashboardProps {
  engine: EngineStatus | null;
  stats: DashboardStats | null;
  scans: ScanRecord[];
  info: AppInfo | null;
  onNavigate: (section: SectionId) => void;
}

export function Dashboard({ engine, stats, scans, info, onNavigate }: DashboardProps) {
  const engineReady = Boolean(engine?.installed);
  const signatureReady = engine?.signatureState === "upToDate";
  const lastScan = stats?.lastScan ?? scans[0] ?? null;

  return (
    <div className="dashboard">
      <div className="banner banner--warning">
        <TriangleAlert size={19} aria-hidden="true" />
        <div>
          <strong>Version expérimentale — protection manuelle uniquement</strong>
          <span>
            CBS Shield ne fournit ni surveillance en temps réel, ni pilote noyau, ni
            pare-feu. Microsoft Defender reste votre protection principale et n'est pas
            modifié par cette application.
          </span>
        </div>
      </div>

      <section className="hero">
        <div className="hero__content">
          <div className="hero__badges">
            <Badge tone="info" dot>
              Phase 1
            </Badge>
            <Badge tone={engineReady ? "ok" : "danger"} dot>
              {engineReady ? "Moteur ClamAV détecté" : "Moteur ClamAV absent"}
            </Badge>
          </div>
          <h2>Scannez à la demande. Gardez le contrôle.</h2>
          <p>
            Sélectionnez un fichier ou un dossier, lancez une analyse réelle avec ClamAV,
            consultez les détections et isolez-les dans une quarantaine chiffrée. Aucun
            fichier n'est supprimé automatiquement.
          </p>
          <div className="hero__actions">
            <button
              type="button"
              className="button button--primary"
              onClick={() => onNavigate("antivirus")}
            >
              <ShieldCheck size={17} />
              Ouvrir l'antivirus
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => onNavigate("settings")}
            >
              Vérifier le moteur
              <ArrowRight size={16} />
            </button>
          </div>
          <div className="hero__meta">
            <span>
              <Database size={14} /> {info?.version ? `v${info.version}` : "v0.1.0"}
            </span>
            <span>
              <FileSearch size={14} /> Scans enregistrés localement
            </span>
            <span>
              <Clock size={14} /> Dernier scan :{" "}
              {lastScan ? formatDateTime(lastScan.startedAt) : "aucun"}
            </span>
          </div>
        </div>

        <div className="hero__visual" aria-hidden="true">
          <div className={`shield-orb ${engineReady ? "is-ready" : "is-warn"}`}>
            <div className="shield-orb__ring" />
            <ShieldCheck size={64} strokeWidth={1.2} />
          </div>
          <div className="hero__signal">
            <span className={`signal-dot ${engineReady ? "is-on" : "is-off"}`} />
            {engineReady ? "ClamAV opérationnel" : "ClamAV non configuré"}
          </div>
        </div>
      </section>

      <section className="stat-grid" aria-label="Statistiques locales">
        <article className="stat">
          <div className="stat__icon stat__icon--blue">
            <FileSearch size={19} />
          </div>
          <div>
            <span className="stat__label">Scans réalisés</span>
            <strong>{formatNumber(stats?.totalScans ?? 0)}</strong>
          </div>
        </article>
        <article className="stat">
          <div className="stat__icon stat__icon--cyan">
            <Database size={19} />
          </div>
          <div>
            <span className="stat__label">Fichiers analysés</span>
            <strong>{formatNumber(stats?.totalFilesScanned ?? 0)}</strong>
          </div>
        </article>
        <article className="stat">
          <div className="stat__icon stat__icon--red">
            <CircleAlert size={19} />
          </div>
          <div>
            <span className="stat__label">Détections historiques</span>
            <strong>{formatNumber(stats?.totalDetections ?? 0)}</strong>
          </div>
        </article>
        <article className="stat">
          <div className="stat__icon stat__icon--amber">
            <Archive size={19} />
          </div>
          <div>
            <span className="stat__label">Quarantaine active</span>
            <strong>{formatNumber(stats?.activeQuarantine ?? 0)}</strong>
          </div>
        </article>
      </section>

      <div className="dash-columns">
        <section className="panel">
          <div className="panel__head">
            <div>
              <span className="panel__eyebrow">Modules</span>
              <h2>État des fonctionnalités</h2>
            </div>
          </div>

          <div className="module-grid">
            <button
              type="button"
              className="module-card"
              onClick={() => onNavigate("antivirus")}
            >
              <div className="module-card__top">
                <ShieldCheck size={20} />
                <Badge tone={engineReady ? (signatureReady ? "ok" : "warning") : "danger"} dot>
                  {engineReady
                    ? signatureReady
                      ? "Disponible"
                      : "Attention"
                    : "Moteur requis"}
                </Badge>
              </div>
              <strong>Antivirus</strong>
              <span>Analyse manuelle par ClamAV (fichiers et dossiers).</span>
            </button>

            <button
              type="button"
              className="module-card"
              onClick={() => onNavigate("quarantine")}
            >
              <div className="module-card__top">
                <Archive size={20} />
                <Badge tone="ok" dot>
                  Disponible
                </Badge>
              </div>
              <strong>Quarantaine</strong>
              <span>Coffre AES-256-GCM, confirmation explicite, restauration possible.</span>
            </button>

            <div className="module-card module-card--disabled">
              <div className="module-card__top">
                <Flame size={20} />
                <Badge tone="neutral" dot>
                  Non disponible
                </Badge>
              </div>
              <strong>Firewall</strong>
              <span>Aucune règle Windows Firewall n'est lue ni modifiée.</span>
            </div>

            <div className="module-card module-card--disabled">
              <div className="module-card__top">
                <Activity size={20} />
                <Badge tone="neutral" dot>
                  Non disponible
                </Badge>
              </div>
              <strong>Network Monitor</strong>
              <span>Aucune capture réseau dans cette version.</span>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel__head">
            <div>
              <span className="panel__eyebrow">Moteur</span>
              <h2>ClamAV</h2>
            </div>
            <Badge tone={signatureStateTone(engine?.signatureState ?? "unknown")} dot>
              {signatureStateLabel(engine?.signatureState ?? "unknown")}
            </Badge>
          </div>

          <dl className="detail-list">
            <div>
              <dt>Moteur</dt>
              <dd>{engine?.engineVersion ?? "Non détecté"}</dd>
            </div>
            <div>
              <dt>Signatures</dt>
              <dd>{engine?.signatureVersion ?? "Absentes"}</dd>
            </div>
            <div>
              <dt>Date des signatures</dt>
              <dd>{engine?.signatureDate ?? "—"}</dd>
            </div>
            <div>
              <dt>Base locale</dt>
              <dd title={engine?.databasePath ?? undefined}>
                {engine?.databasePath
                  ? truncateMiddle(engine.databasePath, 42)
                  : "Introuvable"}
              </dd>
            </div>
          </dl>

          <p className="panel__note">
            {engine?.message ?? "Diagnostic du moteur en cours…"}
          </p>

          <button
            type="button"
            className="button button--ghost button--full"
            onClick={() => onNavigate("settings")}
          >
            Voir la configuration
            <ArrowRight size={16} />
          </button>
        </section>
      </div>

      <section className="panel">
        <div className="panel__head">
          <div>
            <span className="panel__eyebrow">Historique local</span>
            <h2>Derniers scans</h2>
          </div>
          <span className="muted">
            {stats ? plural(stats.totalScans, "scan enregistré", "scans enregistrés") : "—"}
          </span>
        </div>

        {scans.length === 0 ? (
          <EmptyState
            icon={FileSearch}
            title="Aucun scan enregistré"
            description="Lancez votre première analyse manuelle : le rapport sera conservé dans SQLite sur ce poste."
            action={
              <button
                type="button"
                className="button button--primary"
                onClick={() => onNavigate("antivirus")}
              >
                Lancer un scan
              </button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Cible</th>
                  <th className="num">Fichiers</th>
                  <th className="num">Menaces</th>
                  <th>Résultat</th>
                </tr>
              </thead>
              <tbody>
                {scans.slice(0, 6).map((scan) => (
                  <tr key={scan.id}>
                    <td>{formatDateTime(scan.startedAt)}</td>
                    <td title={scan.targets.join("\n")}>
                      {scan.targets.length > 1
                        ? `${truncateMiddle(scan.targets[0], 44)} +${scan.targets.length - 1}`
                        : truncateMiddle(scan.targets[0] ?? "—", 52)}
                    </td>
                    <td className="num">{formatNumber(scan.filesScanned)}</td>
                    <td className="num">{formatNumber(scan.infectedFiles)}</td>
                    <td>
                      <Badge tone={outcomeTone(scan.outcome)} dot>
                        {outcomeLabel(scan.outcome)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="status-notes">
        <div className="status-note">
          <CircleCheck size={17} aria-hidden="true" />
          <span>Rapports et réglages stockés localement, sans télémétrie.</span>
        </div>
        <div className="status-note">
          <WifiOff size={17} aria-hidden="true" />
          <span>Aucune communication réseau hors mise à jour explicite des signatures.</span>
        </div>
        <div className="status-note">
          <CircleAlert size={17} aria-hidden="true" />
          <span>Aucune protection automatique : l'utilisateur décide de chaque action.</span>
        </div>
      </div>
    </div>
  );
}
