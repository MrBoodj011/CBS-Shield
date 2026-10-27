import { useEffect, useState } from "react";
import {
  Activity,
  Archive,
  ExternalLink,
  Flame,
  FolderOpen,
  HardDrive,
  Info,
  ServerCog,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "../components/Badge";
import { useToast } from "../components/Toasts";
import { api, errorMessage } from "../lib/api";
import { formatNumber, signatureStateTone } from "../lib/format";
import { useI18n, type TranslationKey } from "../lib/i18n";
import type {
  AppInfo,
  DashboardStats,
  EngineStatus,
  FirewallObservation,
  SettingsView,
} from "../types";

interface AboutProps {
  info: AppInfo | null;
  engine: EngineStatus | null;
  settings: SettingsView | null;
  stats: DashboardStats | null;
  refreshToken?: number;
}

export function About({ info, engine, settings, stats, refreshToken = 0 }: AboutProps) {
  const { t } = useI18n();
  const toast = useToast();
  const [firewall, setFirewall] = useState<FirewallObservation | null>(null);
  const [firewallError, setFirewallError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFirewallError(null);
    void api
      .firewallStatus()
      .then((observation) => {
        if (!cancelled) setFirewall(observation);
      })
      .catch((failure: unknown) => {
        if (!cancelled) setFirewallError(errorMessage(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const openDataDir = async () => {
    setOpening(true);
    try {
      await api.openDataDir();
    } catch (failure) {
      toast({ tone: "error", title: t("about.dataDir"), message: errorMessage(failure) });
    } finally {
      setOpening(false);
    }
  };

  const enabledProfiles = firewall?.status.profiles.filter((profile) => profile.enabled).length ?? 0;
  const activeQuarantine = stats?.activeQuarantine ?? 0;
  const stateLabel = t(
    `signature.${engine?.signatureState ?? "unknown"}` as TranslationKey,
  );

  return (
    <div className="section-stack">
      <div className="about-grid">
        <section className="panel">
          <div className="panel__head">
            <div>
              <span className="panel__eyebrow">Cybrense</span>
              <h2>{info?.product ?? "CBS Shield"}</h2>
            </div>
            <Badge tone="info" dot>
              v{info?.version ?? "0.6.0-dev"}
            </Badge>
          </div>

          <div className="info-grid">
            <div className="info-cell">
              <span className="info-cell__label">{t("about.product")}</span>
              <span className="info-cell__value">{info?.product ?? "CBS Shield"}</span>
            </div>
            <div className="info-cell">
              <span className="info-cell__label">{t("about.version")}</span>
              <span className="info-cell__value">v{info?.version ?? "0.6.0-dev"}</span>
            </div>
            <div className="info-cell">
              <span className="info-cell__label">{t("about.phase")}</span>
              <span className="info-cell__value">{t("about.phaseName")}</span>
            </div>
            <div className="info-cell">
              <span className="info-cell__label">{t("about.tech")}</span>
              <span className="info-cell__value">{t("about.techValue")}</span>
            </div>
          </div>

          <div className="banner banner--warning" style={{ marginTop: 14 }}>
            <TriangleAlert size={18} aria-hidden="true" />
            <div>
              <strong>{t("about.disclaimer")}</strong>
              <span>{t("about.disclaimerBody")}</span>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel__head">
            <div>
              <span className="panel__eyebrow">{t("common.localOnly")}</span>
              <h2>{t("about.storage")}</h2>
            </div>
            <HardDrive size={16} aria-hidden="true" />
          </div>

          <dl className="detail-list">
            <div>
              <dt>{t("about.dataDir")}</dt>
              <dd className="mono" title={settings?.dataDir}>
                {settings?.dataDir ?? "—"}
              </dd>
            </div>
            <div>
              <dt>{t("about.historyDb")}</dt>
              <dd className="mono" title={settings?.historyPath}>
                {settings?.historyPath ?? "—"}
              </dd>
            </div>
            <div>
              <dt>{t("about.quarantineDir")}</dt>
              <dd className="mono" title={settings?.quarantinePath}>
                {settings?.quarantinePath ?? "—"}
              </dd>
            </div>
            <div>
              <dt>{t("about.signatureDir")}</dt>
              <dd className="mono" title={settings?.signatureDbPath}>
                {settings?.signatureDbPath ?? "—"}
              </dd>
            </div>
            <div>
              <dt>{t("about.freshclamConf")}</dt>
              <dd className="mono" title={settings?.freshclamConfPath}>
                {settings?.freshclamConfPath ?? "—"}
              </dd>
            </div>
          </dl>

          <button
            type="button"
            className="button button--ghost button--full"
            style={{ marginTop: 12 }}
            onClick={() => void openDataDir()}
            disabled={opening}
          >
            <FolderOpen size={16} />
            {t("about.openDataDir")}
            <ExternalLink size={14} />
          </button>
        </section>
      </div>

      <section className="panel">
        <div className="panel__head">
          <div>
            <span className="panel__eyebrow">{t("about.diagnosticsHint")}</span>
            <h2>{t("about.diagnostics")}</h2>
          </div>
          <Info size={16} aria-hidden="true" />
        </div>

        <div className="status-row">
          <div className="status-row__label">
            <strong>
              <ShieldCheck size={13} style={{ verticalAlign: "-2px", marginRight: 6 }} />
              {t("about.engine")}
            </strong>
            <span>
              {engine?.engineVersion ?? t("common.unknown")} · {stateLabel}
            </span>
          </div>
          <Badge
            tone={
              engine?.installed
                ? signatureStateTone(engine.signatureState)
                : "danger"
            }
            dot
          >
            {engine?.installed
              ? engine.signatureState === "upToDate"
                ? t("about.status.available")
                : t("about.status.degraded")
              : t("about.status.unavailable")}
          </Badge>
        </div>

        <div className="status-row">
          <div className="status-row__label">
            <strong>
              <Archive size={13} style={{ verticalAlign: "-2px", marginRight: 6 }} />
              {t("about.quarantineModule")}
            </strong>
            <span>
              {t("about.counts", { count: activeQuarantine })} · {t("common.localOnly")}
            </span>
          </div>
          <Badge tone="ok" dot>
            {t("about.status.available")}
          </Badge>
        </div>

        <div className="status-row">
          <div className="status-row__label">
            <strong>
              <Flame size={13} style={{ verticalAlign: "-2px", marginRight: 6 }} />
              {t("about.firewallModule")}
            </strong>
            <span>
              {firewall
                ? `${t("dashboard.firewallOn", { count: enabledProfiles })} · ${t(
                    "about.profiles",
                  )}`
                : firewallError ?? t("common.loading")}
            </span>
          </div>
          {firewall ? (
            <Badge tone={enabledProfiles > 0 ? "ok" : "warning"} dot>
              {t("about.status.readOnly")}
            </Badge>
          ) : (
            <Badge tone="neutral">{t("about.status.readOnly")}</Badge>
          )}
        </div>

        <div className="status-row">
          <div className="status-row__label">
            <strong>
              <Activity size={13} style={{ verticalAlign: "-2px", marginRight: 6 }} />
              {t("about.networkModule")}
            </strong>
            <span>{t("section.network.subtitle")}</span>
          </div>
          <Badge tone="info" dot>
            {t("about.status.readOnly")}
          </Badge>
        </div>

        <div className="status-row">
          <div className="status-row__label">
            <strong>
              <ServerCog size={13} style={{ verticalAlign: "-2px", marginRight: 6 }} />
              freshclam
            </strong>
            <span>
              {engine?.freshclamPath ?? settings?.freshclamConfPath ?? t("updates.notConfigured")}
            </span>
          </div>
          <Badge tone={engine?.freshclamPath ? "ok" : "warning"} dot>
            {engine?.freshclamPath ? t("updates.status.configured") : t("common.none")}
          </Badge>
        </div>
      </section>

      <section className="panel panel--muted">
        <div className="status-notes">
          <div className="status-note">
            <ShieldCheck size={17} aria-hidden="true" />
            <span>{t("posture.defender")}</span>
          </div>
          <div className="status-note">
            <HardDrive size={17} aria-hidden="true" />
            <span>{t("about.storageHint")}</span>
          </div>
          <div className="status-note">
            <Info size={17} aria-hidden="true" />
            <span>
              {t("dashboard.stat.scans")} : {formatNumber(stats?.totalScans ?? 0)} ·{" "}
              {t("dashboard.stat.files")} : {formatNumber(stats?.totalFilesScanned ?? 0)}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
