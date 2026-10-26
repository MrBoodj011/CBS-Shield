import { useEffect, useState } from "react";
import {
  Check,
  CircleAlert,
  CircleCheck,
  Copy,
  Database,
  Download,
  ServerCog,
  ShieldCheck,
  Terminal,
} from "lucide-react";

import { Badge } from "../components/Badge";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toasts";
import { api, errorMessage } from "../lib/api";
import {
  formatDateTime,
  formatNumber,
  signatureStateTone,
  truncateMiddle,
} from "../lib/format";
import { useI18n, type TranslationKey } from "../lib/i18n";
import type { EngineStatus, SettingsView } from "../types";

interface UpdatesProps {
  engine: EngineStatus | null;
  settings: SettingsView | null;
  onEngineChanged: (status: EngineStatus) => void;
}

export function Updates({ engine, settings, onEngineChanged }: UpdatesProps) {
  const { t } = useI18n();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<"success" | "failure" | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const installed = Boolean(engine?.installed);
  const state = engine?.signatureState ?? "unknown";
  const stateLabel = t(`signature.${state}` as TranslationKey);
  const threshold = settings?.signatureMaxAgeDays ?? 7;
  const ageRatio =
    engine?.signatureAgeDays !== null && engine?.signatureAgeDays !== undefined
      ? Math.min(engine.signatureAgeDays / threshold, 1)
      : null;

  const copyInstallCommand = async () => {
    try {
      await navigator.clipboard.writeText(t("updates.installCommand"));
      setCopied(true);
    } catch (error) {
      toast({ tone: "error", title: t("common.error"), message: errorMessage(error) });
    }
  };

  const runUpdate = async () => {
    setConfirming(false);
    setRunning(true);
    setResult(null);
    setLog([]);
    try {
      const update = await api.updateSignatures(true);
      setLog(update.log);
      setResult(update.success ? "success" : "failure");
      onEngineChanged(update.engine);
      toast({
        tone: update.success ? "success" : "error",
        title: update.success ? t("updates.success") : t("updates.failure"),
        message: update.message,
      });
    } catch (failure) {
      const message = errorMessage(failure);
      setResult("failure");
      setLog([message]);
      toast({ tone: "error", title: t("updates.failure"), message });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="section-stack">
      <div className="update-grid">
        <section className="panel">
          <div className="panel__head">
            <div>
              <span className="panel__eyebrow">{t("section.antivirus.title")}</span>
              <h2>{t("updates.engineTitle")}</h2>
            </div>
            <Badge tone={installed ? "ok" : "danger"} dot>
              {installed ? t("about.status.available") : t("about.status.unavailable")}
            </Badge>
          </div>

          <dl className="detail-list">
            <div>
              <dt>{t("history.details.engine")}</dt>
              <dd>{engine?.engineVersion ?? t("common.unknown")}</dd>
            </div>
            <div>
              <dt>clamscan</dt>
              <dd title={engine?.clamscanPath ?? undefined}>
                {engine?.clamscanPath
                  ? truncateMiddle(engine.clamscanPath, 46)
                  : t("updates.notConfigured")}
              </dd>
            </div>
            <div>
              <dt>freshclam</dt>
              <dd title={engine?.freshclamPath ?? undefined}>
                {engine?.freshclamPath
                  ? truncateMiddle(engine.freshclamPath, 46)
                  : t("updates.notConfigured")}
              </dd>
            </div>
            <div>
              <dt>{t("updates.status.database")}</dt>
              <dd title={engine?.databasePath ?? undefined}>
                {engine?.databasePath
                  ? `${truncateMiddle(engine.databasePath, 38)} · ${formatNumber(
                      engine.databaseFileCount,
                    )}`
                  : t("common.none")}
              </dd>
            </div>
          </dl>

          {!installed ? (
            <div className="banner banner--warning" style={{ marginTop: 14 }}>
              <Terminal size={18} aria-hidden="true" />
              <div>
                <strong>{t("updates.engineMissing")}</strong>
                <span>{t("updates.installHint")}</span>
                <div className="banner__actions">
                  <code className="inline-code">{t("updates.installCommand")}</code>
                  <button type="button" className="button button--ghost button--small" onClick={copyInstallCommand}>
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? t("common.copied") : t("common.copy")}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <p className="panel__note" style={{ marginTop: 12 }}>
              {engine?.message}
            </p>
          )}
        </section>

        <section className="panel">
          <div className="panel__head">
            <div>
              <span className="panel__eyebrow">ClamAV</span>
              <h2>{t("updates.signaturesTitle")}</h2>
            </div>
            <Badge tone={signatureStateTone(state)} dot>
              {stateLabel}
            </Badge>
          </div>

          <dl className="detail-list">
            <div>
              <dt>Version</dt>
              <dd>{engine?.signatureVersion ?? t("signature.missing")}</dd>
            </div>
            <div>
              <dt>{t("updates.signatureDate")}</dt>
              <dd>{engine?.signatureDate ?? "—"}</dd>
            </div>
            <div>
              <dt>{t("updates.freshness")}</dt>
              <dd>
                {engine?.signatureAgeDays !== null && engine?.signatureAgeDays !== undefined
                  ? t("common.days", { count: engine.signatureAgeDays })
                  : t("common.unknown")}
              </dd>
            </div>
            <div>
              <dt>{t("updates.threshold")}</dt>
              <dd>{t("common.days", { count: threshold })}</dd>
            </div>
          </dl>

          {ageRatio !== null ? (
            <div style={{ marginTop: 12 }}>
              <div className="freshness-bar" aria-hidden="true">
                <span
                  className={`freshness-bar__fill ${
                    ageRatio >= 1
                      ? "is-stale"
                      : ageRatio > 0.6
                        ? "is-aging"
                        : "is-fresh"
                  }`}
                  style={{ width: `${Math.max(ageRatio * 100, 4)}%` }}
                />
              </div>
              <p className="panel__note" style={{ marginTop: 6 }}>
                {t("updates.lastCheck")} {engine?.checkedAt ? formatDateTime(engine.checkedAt) : "—"}
              </p>
            </div>
          ) : null}

          <div className="button-row" style={{ marginTop: 14 }}>
            <button
              type="button"
              className="button button--primary"
              onClick={() => setConfirming(true)}
              disabled={!installed || running}
            >
              <Download size={16} className={running ? "spin" : undefined} />
              {running ? t("updates.updating") : t("updates.updateButton")}
            </button>
            {engine?.freshclamPath ? (
              <Badge tone="info">
                <ServerCog size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                freshclam
              </Badge>
            ) : null}
          </div>

          {!installed ? (
            <p className="panel__note" style={{ marginTop: 10 }}>
              {t("updates.engineMissing")}
            </p>
          ) : null}
        </section>
      </div>

      <section className="panel">
        <div className="panel__head">
          <div>
            <span className="panel__eyebrow">freshclam</span>
            <h2>{t("updates.logTitle")}</h2>
          </div>
          {result ? (
            <Badge tone={result === "success" ? "ok" : "danger"} dot>
              {result === "success" ? (
                <>
                  <CircleCheck size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                  {t("updates.success")}
                </>
              ) : (
                <>
                  <CircleAlert size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                  {t("updates.failure")}
                </>
              )}
            </Badge>
          ) : (
            <Badge tone="neutral">{t("common.localOnly")}</Badge>
          )}
        </div>

        {log.length === 0 ? (
          <p className="panel__note">{t("updates.noLog")}</p>
        ) : (
          <pre className="log-view">{log.join("\n")}</pre>
        )}

        <p className="panel__note" style={{ marginTop: 10 }}>
          <ShieldCheck size={13} style={{ verticalAlign: "-2px", marginRight: 6 }} />
          database.clamav.net · {t("common.localOnly")} ·{" "}
          {installed ? t("updates.status.configured") : t("updates.status.auto")}
        </p>
      </section>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t("updates.confirmTitle")}
        eyebrow="freshclam"
        tone="info"
        footer={
          <>
            <button type="button" className="button button--ghost" onClick={() => setConfirming(false)}>
              {t("common.cancel")}
            </button>
            <button type="button" className="button button--primary" onClick={() => void runUpdate()}>
              <Download size={15} />
              {t("updates.confirmAction")}
            </button>
          </>
        }
      >
        <p style={{ color: "var(--text-soft)", fontSize: 13 }}>{t("updates.confirmBody")}</p>
        <p className="panel__note" style={{ marginTop: 10 }}>
          <Database size={13} style={{ verticalAlign: "-2px", marginRight: 6 }} />
          {engine?.databasePath ?? t("common.none")}
        </p>
      </Modal>
    </div>
  );
}
