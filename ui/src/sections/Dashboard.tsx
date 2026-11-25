import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Archive,
  ArrowRight,
  CircleAlert,
  Files,
  Flame,
  Globe2,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "../components/Badge";
import { api } from "../lib/api";
import { formatDateTime, formatNumber, outcomeTone, type Tone } from "../lib/format";
import { useI18n, type TranslationKey } from "../lib/i18n";
import type {
  DashboardStats,
  EngineStatus,
  FirewallObservation,
  NetmonSnapshotRecord,
  SectionId,
  WebGuardView,
} from "../types";

interface DashboardProps {
  engine: EngineStatus | null;
  onNavigate: (section: SectionId) => void;
  stats?: DashboardStats | null;
  refreshToken?: number;
}

type Posture = "manual" | "degraded" | "unavailable";

const POSTURE_TONE: Record<Posture, Tone> = {
  manual: "ok",
  degraded: "warning",
  unavailable: "danger",
};

const POSTURE_ICON: Record<Posture, LucideIcon> = {
  manual: ShieldCheck,
  degraded: ShieldAlert,
  unavailable: ShieldX,
};

const SIGNATURE_TONE: Record<string, Tone> = {
  upToDate: "ok",
  outdated: "warning",
  missing: "danger",
  unknown: "neutral",
};

interface ModuleCard {
  id: SectionId;
  name: string;
  icon: LucideIcon;
  status: string;
  tone: Tone;
  hint: string;
  meta: string;
}

/** Calls an API method lazily so a missing command never throws synchronously. */
function settle<T>(call: () => Promise<T>): Promise<T> {
  return Promise.resolve().then(call);
}

export function Dashboard({ engine, onNavigate, stats = null, refreshToken = 0 }: DashboardProps) {
  const { t, language } = useI18n();
  const [firewall, setFirewall] = useState<FirewallObservation | null>(null);
  const [netmon, setNetmon] = useState<NetmonSnapshotRecord | null>(null);
  const [webguard, setWebguard] = useState<WebGuardView | null>(null);

  useEffect(() => {
    let cancelled = false;

    void Promise.allSettled([
      settle(() => api.firewallStatus()),
      settle(() => api.netmonHistory(1)),
      settle(() => api.webguardSnapshot()),
    ]).then(([firewallResult, netmonResult, webguardResult]) => {
      if (cancelled) return;
      if (firewallResult.status === "fulfilled") setFirewall(firewallResult.value);
      if (netmonResult.status === "fulfilled") setNetmon(netmonResult.value[0] ?? null);
      if (webguardResult.status === "fulfilled") setWebguard(webguardResult.value);
    });

    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const L = (fr: string, en: string) => (language === "en" ? en : fr);

  const installed = Boolean(engine?.installed);
  const signatureState = engine?.signatureState ?? "unknown";
  const posture: Posture = !installed
    ? "unavailable"
    : signatureState === "upToDate"
      ? "manual"
      : "degraded";
  const postureTone = POSTURE_TONE[posture];
  const PostureIcon = POSTURE_ICON[posture];

  const profiles = firewall?.status.profiles ?? [];
  const enabledProfiles = profiles.filter((profile) => profile.enabled).length;

  const securityAlerts = useMemo(() => {
    const alerts: Array<{
      key: string;
      title: string;
      detail: string;
      tone: "danger" | "warning";
      target: SectionId;
    }> = [];
    if (!engine) {
      // Still loading: do not invent an alert.
    } else if (!installed) {
      alerts.push({
        key: "engine-missing",
        title: L("Moteur ClamAV absent", "ClamAV engine missing"),
        detail: L(
          "Les analyses manuelles sont indisponibles. Aucune protection en temps réel n'est active.",
          "Manual scans are unavailable. No real-time protection is active.",
        ),
        tone: "danger",
        target: "antivirus",
      });
    } else if (engine.signatureState === "missing" || engine.signatureState === "outdated") {
      alerts.push({
        key: "signatures",
        title:
          engine.signatureState === "missing"
            ? L("Signatures absentes", "Signatures missing")
            : L("Signatures anciennes", "Outdated signatures"),
        detail: L(
          "Les analyses reposent sur une base incomplète ou ancienne. Vérifiez les mises à jour.",
          "Scans rely on an incomplete or old database. Check updates.",
        ),
        tone: "warning",
        target: "updates",
      });
    }

    if (firewall) {
      const allDisabled = firewall.alerts.some((alert) => alert.code === "all_profiles_disabled");
      if (allDisabled) {
        alerts.push({
          key: "firewall-disabled",
          title: L("Pare-feu Windows désactivé", "Windows Firewall disabled"),
          detail: L(
            "Tous les profils observés sont désactivés. CBS Shield ne modifie pas le pare-feu : vérifiez Windows Security.",
            "All observed profiles are disabled. CBS Shield does not change the firewall: review Windows Security.",
          ),
          tone: "danger",
          target: "firewall",
        });
      } else {
        const disabled = firewall.alerts.filter((alert) => alert.code === "profile_disabled").length;
        if (disabled > 0) {
          alerts.push({
            key: "firewall-profile",
            title: L(
              `${disabled} profil(s) de pare-feu désactivé(s)`,
              `${disabled} firewall profile(s) disabled`,
            ),
            detail: L(
              "La protection réseau n'est pas active sur tous les profils. Observation en lecture seule.",
              "Network protection is not active on every profile. Read-only observation.",
            ),
            tone: "warning",
            target: "firewall",
          });
        }
      }
      if (firewall.alerts.some((alert) => alert.code === "inbound_default_allow")) {
        alerts.push({
          key: "firewall-inbound",
          title: L("Entrant autorisé par défaut", "Inbound allowed by default"),
          detail: L(
            "Un profil actif autorise les connexions entrantes non couvertes par une règle.",
            "An enabled profile allows inbound connections not covered by a rule.",
          ),
          tone: "warning",
          target: "firewall",
        });
      }
    }
    return alerts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, installed, firewall, language]);

  const lastScan = stats?.lastScan ?? null;

  const modules: ModuleCard[] = [
    {
      id: "antivirus",
      name: "Antivirus",
      icon: ShieldCheck,
      status: installed ? `ClamAV ${engine?.engineVersion ?? ""}`.trim() : t("engine.missing"),
      tone: installed ? "ok" : "danger",
      hint: installed ? t("dashboard.avHint") : t("posture.unavailableHint"),
      meta: t(`signature.${signatureState}` as TranslationKey),
    },
    {
      id: "webguard",
      name: "Web Guard",
      icon: Globe2,
      status: webguard
        ? webguard.proxy.running
          ? t("dashboard.webguardOn")
          : t("dashboard.webguardOff")
        : t("dashboard.firewallUnknown"),
      tone: webguard?.proxy.running ? "ok" : "neutral",
      hint: t("dashboard.webguardHint"),
      meta: webguard
        ? t("dashboard.webguardRules", { count: formatNumber(webguard.counts.blocklist) })
        : "—",
    },
    {
      id: "firewall",
      name: t("nav.firewall"),
      icon: Flame,
      status: !firewall
        ? t("dashboard.firewallUnknown")
        : enabledProfiles === 0
          ? t("dashboard.firewallOff")
          : `${enabledProfiles}/${profiles.length} ${L("profils actifs", "profiles on")}`,
      tone: !firewall
        ? "neutral"
        : enabledProfiles === 0
          ? "danger"
          : enabledProfiles < profiles.length
            ? "warning"
            : "ok",
      hint: t("dashboard.firewallModuleHint"),
      meta: firewall
        ? t("dashboard.firewallRules", { count: formatNumber(firewall.status.rulesTotalCount) })
        : t("common.readOnly"),
    },
    {
      id: "network",
      name: t("nav.network"),
      icon: Activity,
      status: netmon
        ? t("dashboard.networkConnections", { count: formatNumber(netmon.tcpTotal) })
        : t("dashboard.networkNone"),
      tone: netmon ? "info" : "neutral",
      hint: t("dashboard.networkModuleHint"),
      meta: netmon ? formatDateTime(netmon.capturedAt) : t("common.readOnly"),
    },
  ];

  const metrics: Array<{
    label: string;
    value: string;
    icon: LucideIcon;
    tone: "" | "ok" | "warn" | "danger";
    target: SectionId;
  }> = [
    {
      label: t("dashboard.stat.scans"),
      value: stats ? formatNumber(stats.totalScans) : "—",
      icon: ScanLine,
      tone: "",
      target: "history",
    },
    {
      label: t("dashboard.stat.files"),
      value: stats ? formatNumber(stats.totalFilesScanned) : "—",
      icon: Files,
      tone: "",
      target: "history",
    },
    {
      label: t("dashboard.stat.detections"),
      value: stats ? formatNumber(stats.totalDetections) : "—",
      icon: ShieldAlert,
      tone: stats && stats.totalDetections > 0 ? "warn" : "ok",
      target: "history",
    },
    {
      label: t("dashboard.stat.quarantine"),
      value: stats ? formatNumber(stats.activeQuarantine) : "—",
      icon: Archive,
      tone: stats && stats.activeQuarantine > 0 ? "danger" : "ok",
      target: "quarantine",
    },
  ];

  return (
    <div className="dashboard">
      <section className={`dash-hero is-${postureTone}`} aria-labelledby="dash-hero-title">
        <div className="dash-hero__main">
          <div className="dash-hero__icon" aria-hidden="true">
            <PostureIcon size={28} strokeWidth={1.7} />
          </div>
          <div className="dash-hero__body">
            <Badge tone={postureTone} dot>
              {t(`posture.${posture}` as TranslationKey)}
            </Badge>
            <h2 id="dash-hero-title">{t("dashboard.heroTitle")}</h2>
            <p>{t(`posture.${posture}Hint` as TranslationKey)}</p>
          </div>
          <div className="dash-hero__actions">
            <button
              type="button"
              className="button button--primary button--lg"
              onClick={() => onNavigate("antivirus")}
            >
              <ScanLine size={17} aria-hidden="true" />
              {t("dashboard.heroAction")}
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => onNavigate("updates")}
            >
              <RefreshCw size={14} aria-hidden="true" />
              {t("dashboard.heroSecondary")}
            </button>
          </div>
        </div>

        <dl className="dash-hero__checks">
          <div>
            <dt>{t("dashboard.engine")}</dt>
            <dd>
              <strong>
                {installed ? `ClamAV ${engine?.engineVersion ?? ""}`.trim() : t("engine.missing")}
              </strong>
              <Badge tone={installed ? "ok" : "danger"} subtle>
                {installed ? t("engine.ready") : t("posture.unavailable")}
              </Badge>
            </dd>
          </div>
          <div>
            <dt>{t("dashboard.signatures")}</dt>
            <dd>
              <strong className="mono">{engine?.signatureVersion ?? "—"}</strong>
              <Badge tone={SIGNATURE_TONE[signatureState] ?? "neutral"} subtle>
                {t(`signature.${signatureState}` as TranslationKey)}
              </Badge>
            </dd>
          </div>
          <div>
            <dt>{t("dashboard.lastScan")}</dt>
            <dd>
              <strong>{lastScan ? formatDateTime(lastScan.finishedAt) : t("dashboard.neverScanned")}</strong>
              {lastScan && (
                <Badge tone={outcomeTone(lastScan.outcome)} subtle>
                  {t("dashboard.scanFiles", { count: formatNumber(lastScan.filesScanned) })}
                </Badge>
              )}
            </dd>
          </div>
        </dl>
      </section>

      {securityAlerts.length > 0 && (
        <section className="security-alert-stack" aria-label={t("dashboard.alerts")}>
          {securityAlerts.map((alert) => (
            <div
              key={alert.key}
              className={`banner ${alert.tone === "danger" ? "banner--danger" : "banner--warning"}`}
            >
              <CircleAlert size={18} aria-hidden="true" />
              <div className="dash-alert">
                <div>
                  <strong>{alert.title}</strong>
                  <span>{alert.detail}</span>
                </div>
                <button
                  type="button"
                  className="button button--ghost button--small"
                  onClick={() => onNavigate(alert.target)}
                >
                  {t("dashboard.review")}
                  <ArrowRight size={13} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="dash-section" aria-labelledby="dash-overview">
        <header className="dash-section__head">
          <h2 id="dash-overview">{t("dashboard.overview")}</h2>
          <span>{t("common.localOnly")}</span>
        </header>
        <div className="metric-grid">
          {metrics.map(({ label, value, icon: Icon, tone, target }) => (
            <button
              key={label}
              type="button"
              className="metric-card dash-metric"
              onClick={() => onNavigate(target)}
            >
              <div className="metric-card__top">
                <span className="metric-card__label">{label}</span>
                <span
                  className={`metric-card__icon${tone ? ` metric-card__icon--${tone}` : ""}`}
                  aria-hidden="true"
                >
                  <Icon size={16} strokeWidth={1.9} />
                </span>
              </div>
              <span className="metric-card__value">{value}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="dash-section" aria-labelledby="dash-modules">
        <header className="dash-section__head">
          <h2 id="dash-modules">{t("dashboard.modules")}</h2>
          <span>{t("dashboard.modulesHint")}</span>
        </header>
        <div className="dash-modules">
          {modules.map(({ id, name, icon: Icon, status, tone, hint, meta }) => (
            <button
              key={id}
              type="button"
              className="dash-module"
              onClick={() => onNavigate(id)}
              aria-label={`${name} · ${status}`}
            >
              <div className="dash-module__head">
                <span className="dash-module__icon" aria-hidden="true">
                  <Icon size={18} strokeWidth={1.8} />
                </span>
                <h3>{name}</h3>
              </div>
              <Badge tone={tone} dot>
                {status}
              </Badge>
              <p>{hint}</p>
              <footer>
                <span>{meta}</span>
                <span className="dash-module__open">
                  {t("dashboard.open")}
                  <ArrowRight size={13} aria-hidden="true" />
                </span>
              </footer>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
