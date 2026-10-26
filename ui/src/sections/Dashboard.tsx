import { useEffect, useMemo, useState } from "react";
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
  Info,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "../components/Badge";
import { api, errorMessage } from "../lib/api";
import {
  formatBytes,
  formatDateTime,
  formatNumber,
  outcomeTone,
  signatureStateTone,
  truncateMiddle,
  type Tone,
} from "../lib/format";
import { useI18n, type TranslationKey } from "../lib/i18n";
import type {
  AppInfo,
  DashboardStats,
  EngineStatus,
  FirewallObservation,
  NetmonSnapshotRecord,
  QuarantineRecord,
  ScanRecord,
  SectionId,
  SignatureInventory,
} from "../types";

interface DashboardProps {
  engine: EngineStatus | null;
  inventory?: SignatureInventory | null;
  stats: DashboardStats | null;
  scans: ScanRecord[];
  quarantine: QuarantineRecord[];
  info: AppInfo | null;
  onNavigate: (section: SectionId) => void;
  refreshToken?: number;
}

const KNOWN_OUTCOMES = new Set([
  "clean",
  "detected",
  "cancelled",
  "completedWithErrors",
  "failed",
]);

interface DashEvent {
  key: string;
  at: string;
  title: string;
  detail: string;
  tone: Tone;
  icon: typeof CircleCheck;
  target: SectionId;
}

export function Dashboard({
  engine,
  inventory = null,
  stats,
  scans,
  quarantine,
  info,
  onNavigate,
  refreshToken = 0,
}: DashboardProps) {
  const { t, language } = useI18n();
  const [firewall, setFirewall] = useState<FirewallObservation | null>(null);
  const [netmon, setNetmon] = useState<NetmonSnapshotRecord | null>(null);
  const [sideLoading, setSideLoading] = useState(true);
  const [sideError, setSideError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSideLoading(true);

    void Promise.allSettled([api.firewallStatus(), api.netmonHistory(1)]).then(
      ([firewallResult, netmonResult]) => {
        if (cancelled) return;
        if (firewallResult.status === "fulfilled") {
          setFirewall(firewallResult.value);
        }
        if (netmonResult.status === "fulfilled") {
          setNetmon(netmonResult.value[0] ?? null);
        }
        const failure =
          firewallResult.status === "rejected"
            ? firewallResult.reason
            : netmonResult.status === "rejected"
              ? netmonResult.reason
              : null;
        setSideError(failure ? errorMessage(failure) : null);
        setSideLoading(false);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const installed = Boolean(engine?.installed);
  const signaturesFresh = engine?.signatureState === "upToDate";
  const lastScan = stats?.lastScan ?? scans[0] ?? null;
  const enabledProfiles = firewall?.status.profiles.filter((profile) => profile.enabled).length ?? 0;
  const firewallKnown = firewall !== null;
  const firewallOn = firewallKnown && enabledProfiles > 0;

  const posture = !installed ? "unavailable" : signaturesFresh ? "manual" : "degraded";
  const postureLabel = t(
    posture === "manual"
      ? "posture.manual"
      : posture === "degraded"
        ? "posture.degraded"
        : "posture.unavailable",
  );
  const postureHint = t(
    posture === "manual"
      ? "posture.manualHint"
      : posture === "degraded"
        ? "posture.degradedHint"
        : "posture.unavailableHint",
  );

  const outcomeText = (outcome: string) =>
    KNOWN_OUTCOMES.has(outcome) ? t(`outcome.${outcome}` as TranslationKey) : outcome;

  const signatureStateText = t(
    `signature.${engine?.signatureState ?? "unknown"}` as TranslationKey,
  );

  const events = useMemo<DashEvent[]>(() => {
    const fromScans: DashEvent[] = scans.slice(0, 8).map((scan) => {
      const base = {
        key: `scan-${scan.id}`,
        at: scan.startedAt,
        target: "history" as SectionId,
      };
      if (scan.cancelled) {
        return {
          ...base,
          title: t("outcome.cancelled"),
          detail: truncateMiddle(scan.targets[0] ?? "—", 72),
          tone: "warning" as Tone,
          icon: Clock,
        };
      }
      if (scan.outcome === "failed") {
        return {
          ...base,
          title: t("dashboard.event.failed"),
          detail: scan.fatalError ?? truncateMiddle(scan.targets[0] ?? "—", 72),
          tone: "danger" as Tone,
          icon: CircleAlert,
        };
      }
      if (scan.outcome === "completedWithErrors") {
        return {
          ...base,
          title: t("dashboard.event.scanError"),
          detail: `${formatNumber(scan.errorCount)} · ${truncateMiddle(scan.targets[0] ?? "—", 56)}`,
          tone: "warning" as Tone,
          icon: TriangleAlert,
        };
      }
      if (scan.infectedFiles > 0) {
        return {
          ...base,
          title: t("dashboard.event.scanThreats", { count: formatNumber(scan.infectedFiles) }),
          detail: truncateMiddle(scan.targets[0] ?? "—", 72),
          tone: "danger" as Tone,
          icon: CircleAlert,
        };
      }
      return {
        ...base,
        title: t("dashboard.event.scanClean"),
        detail: `${formatNumber(scan.filesScanned)} · ${truncateMiddle(scan.targets[0] ?? "—", 56)}`,
        tone: "ok" as Tone,
        icon: CircleCheck,
      };
    });

    const fromQuarantine: DashEvent[] = quarantine
      .filter((item) => item.status === "active")
      .slice(0, 4)
      .map((item) => ({
        key: `quarantine-${item.id}`,
        at: item.createdAt,
        title: t("dashboard.event.quarantine"),
        detail: `${truncateMiddle(item.fileName, 44)} · ${item.threatName}`,
        tone: "warning" as Tone,
        icon: Archive,
        target: "quarantine" as SectionId,
      }));

    return [...fromScans, ...fromQuarantine]
      .sort((left, right) => (left.at < right.at ? 1 : -1))
      .slice(0, 6);
  }, [quarantine, scans, t]);

  const quarantineActive = quarantine.filter((item) => item.status === "active").length;

  return (
    <div className="dashboard">
      <section className="dash-hero">
        <div className="dash-hero__content">
          <div className="dash-hero__badges">
            <Badge
              tone={posture === "manual" ? "ok" : posture === "degraded" ? "warning" : "danger"}
              dot
            >
              {postureLabel}
            </Badge>
            <Badge tone="neutral">{t("posture.realtime")}</Badge>
            <Badge tone="info">{t("dashboard.version", { version: info?.version ?? "0.3.0-dev" })}</Badge>
          </div>

          <h2>{t("dashboard.heroTitle")}</h2>
          <p className="dash-hero__body">{t("dashboard.heroBody")}</p>
          <p className="panel__note">{postureHint}</p>

          <div className="dash-hero__actions">
            <button
              type="button"
              className="button button--primary"
              onClick={() => onNavigate("antivirus")}
            >
              <ScanLine size={17} />
              {t("dashboard.heroAction")}
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => onNavigate("updates")}
            >
              <RefreshCw size={16} />
              {t("dashboard.heroSecondary")}
            </button>
          </div>

          <div className="dash-hero__meta">
            <span>
              <ShieldCheck size={14} />
              {t("posture.defender")}
            </span>
            <span>
              <Database size={14} />
              {t("common.localOnly")}
            </span>
          </div>
        </div>

        <div className="dash-hero__visual">
          <div
            className={`posture-orb ${
              posture === "manual" ? "is-ready" : posture === "degraded" ? "is-warn" : "is-off"
            }`}
          >
            <ShieldCheck size={56} strokeWidth={1.25} />
          </div>
          <div className="posture-caption">
            <strong>{installed ? `ClamAV ${engine?.engineVersion ?? ""}`.trim() : t("engine.missing")}</strong>
            <span>{signatureStateText}</span>
          </div>
        </div>
      </section>

      <section className="metric-grid" aria-label={t("dashboard.recent")}>
        <button
          type="button"
          className="metric-card metric-card--link"
          onClick={() => onNavigate("antivirus")}
        >
          <div className="metric-card__top">
            <div className={`metric-card__icon ${installed ? "metric-card__icon--ok" : "metric-card__icon--danger"}`}>
              <ShieldCheck size={17} />
            </div>
            <Badge tone={installed ? "ok" : "danger"} dot>
              {installed ? t("about.status.available") : t("about.status.unavailable")}
            </Badge>
          </div>
          <span className="metric-card__label">{t("dashboard.engine")}</span>
          <span className="metric-card__value">
            {engine === null ? "—" : installed ? engine.engineVersion ?? "ClamAV" : t("common.none")}
          </span>
          <span className="metric-card__hint">{t("dashboard.engineHint")}</span>
        </button>

        <button
          type="button"
          className="metric-card metric-card--link"
          onClick={() => onNavigate("updates")}
        >
          <div className="metric-card__top">
            <div
              className={`metric-card__icon ${
                signaturesFresh
                  ? "metric-card__icon--ok"
                  : engine?.signatureState === "missing"
                    ? "metric-card__icon--danger"
                    : "metric-card__icon--warn"
              }`}
            >
              <Database size={17} />
            </div>
            <Badge tone={signatureStateTone(engine?.signatureState ?? "unknown")} dot>
              {signatureStateText}
            </Badge>
          </div>
          <span className="metric-card__label">{t("dashboard.signatures")}</span>
          <span className="metric-card__value">
            {inventory && inventory.officialSignatures > 0
              ? formatNumber(inventory.officialSignatures)
              : (engine?.signatureVersion ?? "—")}
          </span>
          <span className="metric-card__hint">
            {inventory && inventory.officialSignatures > 0
              ? `CVD v${engine?.signatureVersion ?? "—"} · ${
                  engine?.signatureAgeDays !== null &&
                  engine?.signatureAgeDays !== undefined
                    ? t("common.days", { count: engine.signatureAgeDays })
                    : t("dashboard.signaturesHint")
                }`
              : engine?.signatureAgeDays !== null &&
                  engine?.signatureAgeDays !== undefined
                ? t("common.days", { count: engine.signatureAgeDays })
                : t("dashboard.signaturesHint")}
          </span>
        </button>

        <button
          type="button"
          className="metric-card metric-card--link"
          onClick={() => onNavigate("history")}
        >
          <div className="metric-card__top">
            <div className="metric-card__icon">
              <Clock size={17} />
            </div>
            {lastScan ? (
              <Badge tone={outcomeTone(lastScan.outcome)} dot>
                {outcomeText(lastScan.outcome)}
              </Badge>
            ) : null}
          </div>
          <span className="metric-card__label">{t("dashboard.lastScan")}</span>
          <span className="metric-card__value">
            {lastScan ? formatDateTime(lastScan.startedAt) : t("dashboard.neverScanned")}
          </span>
          <span className="metric-card__hint">
            {lastScan
              ? `${formatNumber(lastScan.filesScanned)} · ${t("history.details.files")}`
              : t("dashboard.lastScanHint")}
          </span>
        </button>

        <button
          type="button"
          className="metric-card metric-card--link"
          onClick={() => onNavigate("quarantine")}
        >
          <div className="metric-card__top">
            <div className={`metric-card__icon ${quarantineActive > 0 ? "metric-card__icon--warn" : "metric-card__icon--ok"}`}>
              <Archive size={17} />
            </div>
            <Badge tone={quarantineActive > 0 ? "warning" : "ok"} dot>
              {quarantineActive > 0
                ? t("about.counts", { count: quarantineActive })
                : t("common.none")}
            </Badge>
          </div>
          <span className="metric-card__label">{t("dashboard.quarantine")}</span>
          <span className="metric-card__value">{formatNumber(quarantineActive)}</span>
          <span className="metric-card__hint">{t("dashboard.quarantineHint")}</span>
        </button>
      </section>

      <div className="dash-grid">
        <section className="panel">
          <div className="panel__head">
            <div>
              <span className="panel__eyebrow">{t("dashboard.recentHint")}</span>
              <h2>{t("dashboard.recent")}</h2>
            </div>
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => onNavigate("history")}
            >
              {t("dashboard.seeHistory")}
              <ArrowRight size={14} />
            </button>
          </div>

          {events.length === 0 ? (
            <p className="panel__note">{t("dashboard.noEvents")}</p>
          ) : (
            <div className="event-list">
              {events.map((event) => {
                const Icon = event.icon;
                return (
                  <button
                    key={event.key}
                    type="button"
                    className="event-row"
                    onClick={() => onNavigate(event.target)}
                  >
                    <span
                      className={`event-row__icon ${
                        event.tone === "danger"
                          ? "event-row__icon--danger"
                          : event.tone === "warning"
                            ? "event-row__icon--warn"
                            : "event-row__icon--ok"
                      }`}
                    >
                      <Icon size={15} />
                    </span>
                    <span className="event-row__text">
                      <strong>{event.title}</strong>
                      <span>{event.detail}</span>
                    </span>
                    <time dateTime={event.at}>{formatDateTime(event.at)}</time>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel__head">
            <div>
              <span className="panel__eyebrow">{t("dashboard.quick")}</span>
              <h2>{t("topbar.diagnostics")}</h2>
            </div>
            <Info size={16} aria-hidden="true" />
          </div>

          <div className="quick-list">
            <button type="button" className="quick-link" onClick={() => onNavigate("antivirus")}>
              <ScanLine size={17} />
              <strong>{t("dashboard.quickScan")}</strong>
              <ArrowRight size={14} />
            </button>
            <button type="button" className="quick-link" onClick={() => onNavigate("updates")}>
              <RefreshCw size={17} />
              <strong>{t("dashboard.quickUpdate")}</strong>
              <ArrowRight size={14} />
            </button>
            <button type="button" className="quick-link" onClick={() => onNavigate("quarantine")}>
              <Archive size={17} />
              <strong>{t("dashboard.quickQuarantine")}</strong>
              <ArrowRight size={14} />
            </button>
            <button type="button" className="quick-link" onClick={() => onNavigate("about")}>
              <Info size={17} />
              <strong>{t("dashboard.quickDiag")}</strong>
              <ArrowRight size={14} />
            </button>
          </div>

          <div className="status-row" style={{ marginTop: 8 }}>
            <div className="status-row__label">
              <strong>
                <Flame size={13} style={{ verticalAlign: "-2px", marginRight: 6 }} />
                {t("dashboard.firewall")}
              </strong>
              <span>{t("dashboard.firewallHint")}</span>
            </div>
            {sideLoading && !firewallKnown ? (
              <span className="skeleton" style={{ width: 86, height: 18 }} />
            ) : firewallKnown ? (
              <Badge tone={firewallOn ? "ok" : "warning"} dot>
                {firewallOn
                  ? t("dashboard.firewallOn", { count: enabledProfiles })
                  : t("dashboard.firewallOff")}
              </Badge>
            ) : (
              <Badge tone="neutral">{t("dashboard.firewallUnknown")}</Badge>
            )}
          </div>

          <div className="status-row">
            <div className="status-row__label">
              <strong>
                <Activity size={13} style={{ verticalAlign: "-2px", marginRight: 6 }} />
                {t("dashboard.network")}
              </strong>
              <span>
                {netmon
                  ? `${t("dashboard.networkDown", { value: formatBytes(netmon.rxBytesDelta) })} · ${t(
                      "dashboard.networkUp",
                      { value: formatBytes(netmon.txBytesDelta) },
                    )}`
                  : t("dashboard.networkHint")}
              </span>
            </div>
            {sideLoading && netmon === null ? (
              <span className="skeleton" style={{ width: 60, height: 18 }} />
            ) : netmon ? (
              <Badge tone="info" dot>
                {formatDateTime(netmon.capturedAt)}
              </Badge>
            ) : (
              <Badge tone="neutral">{t("common.none")}</Badge>
            )}
          </div>

          <div className="status-row">
            <div className="status-row__label">
              <strong>
                <FileSearch size={13} style={{ verticalAlign: "-2px", marginRight: 6 }} />
                {t("dashboard.stat.files")}
              </strong>
              <span>{t("dashboard.stat.detections")}</span>
            </div>
            <span className="mono">
              {formatNumber(stats?.totalFilesScanned ?? 0)} / {formatNumber(stats?.totalDetections ?? 0)}
            </span>
          </div>

          <div className="status-row">
            <div className="status-row__label">
              <strong>{t("about.version")}</strong>
              <span>
                {language === "en" ? "English" : "Français"} · v{info?.version ?? "0.3.0-dev"}
              </span>
            </div>
            <Badge tone="neutral">{t("common.experimental")}</Badge>
          </div>

          {sideError ? <p className="panel__note">{sideError}</p> : null}
        </section>
      </div>
    </div>
  );
}
