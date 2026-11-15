import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CircleAlert, ShieldCheck } from "lucide-react";

import { api } from "../lib/api";
import { useI18n, type TranslationKey } from "../lib/i18n";
import type {
  EngineStatus,
  FirewallObservation,
  NetmonSnapshotRecord,
  SectionId,
} from "../types";

interface DashboardProps {
  engine: EngineStatus | null;
  onNavigate: (section: SectionId) => void;
  refreshToken?: number;
}

function toneClass(tone: "ok" | "warning" | "danger" | "info" | "neutral"): string {
  return `tone-${tone}`;
}

export function Dashboard({
  engine,
  onNavigate,
  refreshToken = 0,
}: DashboardProps) {
  const { t, language } = useI18n();
  const [firewall, setFirewall] = useState<FirewallObservation | null>(null);
  const [netmon, setNetmon] = useState<NetmonSnapshotRecord | null>(null);

  useEffect(() => {
    let cancelled = false;

    void Promise.allSettled([api.firewallStatus(), api.netmonHistory(1)]).then(
      ([firewallResult, netmonResult]) => {
        if (cancelled) return;
        if (firewallResult.status === "fulfilled") {
          setFirewall(firewallResult.value);
        }
        if (netmonResult.status === "fulfilled") {
          setNetmon(netmonResult.value[0] ?? null);
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const installed = Boolean(engine?.installed);
  const signaturesFresh = engine?.signatureState === "upToDate";
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

  const L = (fr: string, en: string) => (language === "en" ? en : fr);

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
      const inboundAllow = firewall.alerts.some((alert) => alert.code === "inbound_default_allow");
      if (inboundAllow) {
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
  }, [engine, installed, firewall, language]);

  const signatureStateText = t(`signature.${engine?.signatureState ?? "unknown"}` as TranslationKey);

  const navigateWithKey = (e: React.KeyboardEvent, target: SectionId) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onNavigate(target);
    }
  };

  return (
    <div className="dashboard">
      {/* Direction A hero */}
      <section className="direction-hero">
        <div className="direction-hero__content">
          <div className="direction-hero__status">
            <span className="direction-hero__dot" aria-hidden="true" />
            <span className="direction-hero__tag">{postureLabel}</span>
          </div>
          <h2 className="direction-hero-headline">{t("dashboard.heroTitle")}</h2>
          <p className="direction-hero__why">{t("dashboard.heroBody")}</p>
          <p className="direction-hero__limits">{postureHint}</p>

          <div className="direction-hero__actions">
            <button
              type="button"
              className="direction-hero__scan"
              onClick={() => onNavigate("antivirus")}
            >
              {t("dashboard.heroAction")}
              <small>{t("dashboard.heroSecondary")}</small>
            </button>
          </div>
        </div>

        <div className="direction-hero__visual">
          <div className={`shield-orb ${posture === "manual" ? "is-ready" : posture === "degraded" ? "is-warn" : "is-off"}`}>
            <ShieldCheck size={56} strokeWidth={1.25} />
            <div className="shield-orb__ring" aria-hidden="true" />
          </div>
          <div className="shield-orb-caption">
            <strong>{installed ? `ClamAV ${engine?.engineVersion ?? ""}`.trim() : t("engine.missing")}</strong>
            <span>{signatureStateText}</span>
          </div>
        </div>
      </section>

      {securityAlerts.length > 0 && (
        <section className="security-alert-stack" aria-label={L("Alertes de sécurité", "Security alerts")}>
          {securityAlerts.map((alert) => (
            <div key={alert.key} className={`banner ${alert.tone === "danger" ? "banner--danger" : "banner--warning"}`}>
              <CircleAlert size={19} aria-hidden="true" />
              <div>
                <strong>{alert.title}</strong>
                <span>{alert.detail}</span>
                <div className="banner__actions">
                  <button type="button" className="button button--ghost" onClick={() => onNavigate(alert.target)}>
                    {t("topbar.diagnostics")}
                    <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Three category cards */}
      <div className="categories">
        <article
          className="category-card"
          role="button"
          tabIndex={0}
          aria-label={language === "fr" ? "Antivirus · moteur ClamAV" : "Antivirus · ClamAV engine"}
          onClick={() => onNavigate("antivirus")}
          onKeyDown={(e) => navigateWithKey(e, "antivirus")}
        >
          <h3>Antivirus</h3>
          <div className="category-state">{installed ? `ClamAV ${engine?.engineVersion ?? ""}` : t("engine.missing")}</div>
          <span className={`chip ${toneClass(installed ? "ok" : "danger")} dot`}>
            {installed ? engine?.signatureVersion ?? t("signature.missing") : t("posture.unavailable")}
          </span>
          <p>{installed ? t("dashboard.engineHint") : t("av.engineMissing.body")}</p>
          <footer>
            <span className={`chip ${toneClass(installed ? "ok" : "danger")}`}>
              {installed ? t("posture.manual") : t("posture.unavailable")}
            </span>
            <span className="mono">{t("common.localOnly")}</span>
          </footer>
        </article>
        <article
          className="category-card"
          role="button"
          tabIndex={0}
          aria-label={language === "fr" ? "Web Guard · filtrage DNS local" : "Web Guard · local DNS filtering"}
          onClick={() => onNavigate("webguard")}
          onKeyDown={(e) => navigateWithKey(e, "webguard")}
        >
          <h3>Web Guard</h3>
          <div className="category-state">Filtrage DNS local</div>
          <span className={`chip ${toneClass("info")}`}>{netmon ? "Actif" : "Inactif"}</span>
          <p>Filtrage DNS local uniquement, si vous le démarrez. Ne couvre pas le trafic système.</p>
          <footer>
            <span className={`chip ${toneClass("info")}`}>Proxy 127.0.0.1</span>
          </footer>
        </article>
        <article
          className="category-card"
          role="button"
          tabIndex={0}
          aria-label={language === "fr" ? "Pare-feu · observation seule" : "Firewall · read-only observation"}
          onClick={() => onNavigate("firewall")}
          onKeyDown={(e) => navigateWithKey(e, "firewall")}
        >
          <h3>Pare-feu</h3>
          <div className="category-state">Observation seule</div>
          <span className={`chip ${toneClass("info")}`}>{firewallKnown ? (firewallOn ? `${enabledProfiles}/3` : "3/3") : "—"}</span>
          <p>{firewallKnown ? "3 profils lus, règles lues. Aucune règle n'est créée ni modifiée par CBS Shield." : "Observation des profils et règles en cours…"}</p>
          <footer>
            <span className={`chip ${toneClass("neutral")}`}>Aucune action</span>
          </footer>
        </article>
      </div>

      {/* Next actions */}
      <section className="next-actions">
        <div className="next-actions__head">
          <h2>A faire ensuite</h2>
          <span className="next-actions__hint">Une seule action recommandée à la fois</span>
        </div>
        <div className="panel">
          <div className="row">
            <div>
              <div className="row__key">{t("dashboard.quickScan")}</div>
              <div className="row__val">Une analyse rapide vérifie Téléchargements, Bureau, Documents, Temp et le démarrage.</div>
            </div>
            <button className="button button--primary button--lg" onClick={() => onNavigate("antivirus")}>
              {t("dashboard.heroAction")}
            </button>
          </div>
          <div className="row">
            <div>
              <div className="row__key">{t("dashboard.quickUpdate")}</div>
              <div className="row__val">Nécessite votre consentement explicite. Observation en lecture seule, sans blocage.</div>
            </div>
            <span className={`chip ${toneClass("info")}`}>Consentement requis</span>
          </div>
        </div>
      </section>
    </div>
  );
}
