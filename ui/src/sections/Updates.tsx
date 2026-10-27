import { useEffect, useState } from "react";
import {
  Database,
  Download,
  FileText,
  ListChecks,
  RefreshCw,
  ServerCog,
  Settings2,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "../components/Badge";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toasts";
import { api, errorMessage } from "../lib/api";
import {
  formatDateTime,
  formatNumber,
  freshnessText,
  signatureStateTone,
  truncateMiddle,
} from "../lib/format";
import { useI18n, type TranslationKey } from "../lib/i18n";
import type {
  EngineStatus,
  ProvisioningStatus,
  SettingsView,
  SignatureInventory,
  SignatureUpdateResult,
  UpdateLogs,
} from "../types";

interface UpdatesProps {
  engine: EngineStatus | null;
  settings: SettingsView | null;
  onEngineChanged: (status: EngineStatus) => void;
  onOpenSetup: () => void;
}

export function Updates({ engine, settings, onEngineChanged, onOpenSetup }: UpdatesProps) {
  const { t, language } = useI18n();
  const L = (fr: string, en: string) => (language === "en" ? en : fr);
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<SignatureUpdateResult | null>(null);
  const [inventory, setInventory] = useState<SignatureInventory | null>(null);
  const [logs, setLogs] = useState<UpdateLogs | null>(null);
  const [provisioning, setProvisioning] = useState<ProvisioningStatus | null>(null);
  const [logSource, setLogSource] = useState<"app" | "freshclam">("app");
  const [autoUpdate, setAutoUpdate] = useState(settings?.autoUpdate ?? false);
  const [autoHours, setAutoHours] = useState(String(settings?.autoUpdateHours ?? 24));
  const [savingAuto, setSavingAuto] = useState(false);

  const refreshMetadata = async () => {
    const [inventoryResult, logsResult, provisioningResult] = await Promise.allSettled([
      api.signatureInventory(),
      api.updateLogs(),
      api.provisioningStatus(),
    ]);
    if (inventoryResult.status === "fulfilled") setInventory(inventoryResult.value);
    if (logsResult.status === "fulfilled") setLogs(logsResult.value);
    if (provisioningResult.status === "fulfilled") setProvisioning(provisioningResult.value);
  };

  useEffect(() => {
    void refreshMetadata();
  }, [engine?.checkedAt]);

  useEffect(() => {
    if (!settings) return;
    setAutoUpdate(settings.autoUpdate);
    setAutoHours(String(settings.autoUpdateHours));
  }, [settings]);

  const installed = Boolean(engine?.installed);
  const state = engine?.signatureState ?? "unknown";
  const stateLabel = t(`signature.${state}` as TranslationKey);
  const threshold = settings?.signatureMaxAgeDays ?? 7;
  const ageRatio =
    engine?.signatureAgeDays !== null && engine?.signatureAgeDays !== undefined
      ? Math.min(engine.signatureAgeDays / threshold, 1)
      : null;

  const runUpdate = async () => {
    setConfirming(false);
    setRunning(true);
    setResult(null);
    setLog([]);
    try {
      const update = await api.updateSignatures(true);
      setLog(update.log);
      setResult(update);
      onEngineChanged(update.engine);
      void refreshMetadata();
      toast({
        tone: update.success ? "success" : "error",
        title: update.success ? t("updates.success") : t("updates.failure"),
        message: update.message,
      });
    } catch (failure) {
      const message = errorMessage(failure);
      setResult(null);
      setLog([message]);
      toast({ tone: "error", title: t("updates.failure"), message });
    } finally {
      setRunning(false);
    }
  };

  const saveAutoUpdate = async () => {
    const hours = Number(autoHours);
    if (!Number.isFinite(hours) || hours < 6 || hours > 168) {
      toast({
        tone: "error",
        title: t("common.error"),
        message: t("updates.auto.invalid"),
      });
      return;
    }
    setSavingAuto(true);
    try {
      await api.updateSettings({ autoUpdate, autoUpdateHours: hours });
      toast({
        tone: "success",
        title: t("updates.auto.saved"),
        message: autoUpdate
          ? t("updates.auto.savedOn", { count: hours })
          : t("updates.auto.savedOff"),
      });
    } catch (error) {
      toast({
        tone: "error",
        title: t("common.error"),
        message: errorMessage(error),
      });
    } finally {
      setSavingAuto(false);
    }
  };

  const openDocs = async () => {
    try {
      await api.openDocumentation("https://docs.clamav.net/");
    } catch (error) {
      toast({
        tone: "error",
        title: t("common.error"),
        message: errorMessage(error),
      });
    }
  };

  return (
    <div className="section-stack">
      <div className="banner banner--neutral">
        <ListChecks size={19} aria-hidden="true" />
        <div>
          <strong>
            {installed
              ? L("Vérifier ou réparer l'installation", "Verify or repair the installation")
              : L("Moteur et signatures non configurés ?", "Engine or signatures not configured?")}
          </strong>
          <span>
            {installed
              ? L(
                  "L'assistant revalide le moteur, l'intégrité des bases officielles et les mises à jour automatiques. Il ne lance rien sans votre accord.",
                  "The assistant revalidates the engine, official database integrity and automatic updates. It starts nothing without your consent.",
                )
              : L(
                  "L'assistant de préparation vérifie la présence de ClamAV, l'intégrité des bases officielles et les mises à jour automatiques. Aucune installation silencieuse.",
                  "The setup assistant checks ClamAV availability, official database integrity and automatic updates. No silent installation.",
                )}
          </span>
          <div className="banner__actions">
            <button type="button" className="button button--ghost" onClick={onOpenSetup}>
              <ListChecks size={15} />
              {L("Ouvrir l'assistant", "Open setup assistant")}
            </button>
          </div>
        </div>
      </div>
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
              <TriangleAlert size={18} aria-hidden="true" />
              <div>
                <strong>{t("updates.engineMissing")}</strong>
                <span>{t("updates.installHint")}</span>
                <div className="banner__actions">
                  <button type="button" className="button button--ghost button--small" onClick={onOpenSetup}>
                    <ListChecks size={14} />
                    {L("Ouvrir l'assistant", "Open setup assistant")}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <p className="panel__note" style={{ marginTop: 12 }}>
              {freshnessText(
                engine?.signatureState ?? "unknown",
                engine?.signatureAgeDays ?? null,
                settings?.signatureMaxAgeDays,
              )}
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
              <dd>{formatDateTime(engine?.signatureDate)}</dd>
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

          <div className="callout callout--info" style={{ marginTop: 12 }}>
            <strong>{t("updates.count.title")}</strong>
            <span>
              {inventory
                ? t("updates.count.body", {
                    count: formatNumber(inventory.officialSignatures),
                    version: engine?.signatureVersion ?? "—",
                  })
                : t("common.loading")}
            </span>
          </div>

          {inventory && inventory.officialComponents.length > 0 && (
            <details className="details" open>
              <summary>
                <Database size={15} />
                {t("updates.components.title")} ({inventory.officialComponents.length})
              </summary>
              <div className="table-wrap">
                <table className="table table--compact">
                  <thead>
                    <tr>
                      <th>{t("updates.components.file")}</th>
                      <th>{t("updates.components.version")}</th>
                      <th className="num">{t("updates.components.signatures")}</th>
                      <th>{t("updates.components.verified")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.officialComponents.map((component) => (
                      <tr key={component.file}>
                        <td className="mono">{component.file}</td>
                        <td>{component.version ?? "—"}</td>
                        <td className="num">{formatNumber(component.signatures)}</td>
                        <td>
                          <Badge tone={component.verified ? "ok" : "warning"} dot>
                            {component.verified
                              ? t("updates.components.ok")
                              : t("updates.components.unverified")}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {inventory.customSignatureFiles.length > 0 && (
                <div className="callout callout--warning" style={{ marginTop: 10 }}>
                  <strong>{t("updates.custom.title")}</strong>
                  <span>
                    {inventory.customSignatureFiles
                      .map((file) => `${file.file} (${file.signatures})`)
                      .join(", ")}
                  </span>
                </div>
              )}
              {inventory.notes.map((note) => (
                <p className="panel__note" key={note}>
                  {note}
                </p>
              ))}
            </details>
          )}

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
            <span className="panel__eyebrow">{t("updates.auto.eyebrow")}</span>
            <h2>{t("updates.auto.title")}</h2>
          </div>
          <Badge tone={autoUpdate ? "ok" : "neutral"} dot>
            {autoUpdate ? t("updates.auto.on") : t("updates.auto.off")}
          </Badge>
        </div>
        <label className="switch-row">
          <input
            type="checkbox"
            checked={autoUpdate}
            onChange={(event) => setAutoUpdate(event.target.checked)}
          />
          <span>
            <strong>{t("updates.auto.enable")}</strong>
            <small>{t("updates.auto.enableHint")}</small>
          </span>
        </label>
        <div className="limits-grid" style={{ marginTop: 12 }}>
          <label className="field">
            <span className="field__label">{t("updates.auto.interval")}</span>
            <input
              type="number"
              min={6}
              max={168}
              value={autoHours}
              onChange={(event) => setAutoHours(event.target.value)}
            />
            <span className="field__hint">{t("updates.auto.intervalHint")}</span>
          </label>
          <div className="field">
            <span className="field__label">&nbsp;</span>
            <button
              type="button"
              className="button button--primary"
              onClick={saveAutoUpdate}
              disabled={savingAuto}
            >
              {savingAuto ? <RefreshCw size={15} className="spin" /> : <Settings2 size={15} />}
              {t("updates.auto.save")}
            </button>
          </div>
        </div>
        <p className="panel__note">{t("updates.auto.note")}</p>
      </section>

      <section className="panel">
        <div className="panel__head">
          <div>
            <span className="panel__eyebrow">{t("updates.provision.eyebrow")}</span>
            <h2>{t("updates.provision.title")}</h2>
          </div>
          <Badge tone={provisioning?.wingetAvailable ? "ok" : "warning"} dot>
            {provisioning?.wingetAvailable
              ? t("updates.provision.wingetOk")
              : t("updates.provision.wingetMissing")}
          </Badge>
        </div>
        <dl className="detail-list detail-list--compact">
          <div>
            <dt>winget</dt>
            <dd>{provisioning?.wingetVersion ?? "—"}</dd>
          </div>
          <div>
            <dt>{t("updates.provision.clamav")}</dt>
            <dd>
              {provisioning?.clamavInstalled
                ? t("about.status.available")
                : t("about.status.unavailable")}
            </dd>
          </div>
          <div>
            <dt>{t("updates.provision.method")}</dt>
            <dd>{t("updates.provision.guided")}</dd>
          </div>
        </dl>
        <div className="button-row" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="button button--primary button--small"
            onClick={onOpenSetup}
          >
            <ListChecks size={14} />
            {t("updates.provision.openSetup")}
          </button>
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={openDocs}
          >
            <FileText size={14} />
            {t("updates.provision.docs")}
          </button>
        </div>
        <p className="panel__note">{t("updates.provision.license")}</p>
      </section>

      <section className="panel">
        <div className="panel__head">
          <div>
            <span className="panel__eyebrow">freshclam</span>
            <h2>{t("updates.logTitle")}</h2>
          </div>
          <div className="button-row">
            <button
              type="button"
              className={`button button--small ${logSource === "app" ? "button--primary" : "button--ghost"}`}
              onClick={() => setLogSource("app")}
            >
              {t("updates.log.app")}
            </button>
            <button
              type="button"
              className={`button button--small ${logSource === "freshclam" ? "button--primary" : "button--ghost"}`}
              onClick={() => setLogSource("freshclam")}
            >
              {t("updates.log.freshclam")}
            </button>
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => void refreshMetadata()}
            >
              <RefreshCw size={14} />
              {t("common.retry")}
            </button>
          </div>
        </div>

        {result ? (
          <Badge tone={result.success ? "ok" : "danger"} dot>
            {result.success ? t("updates.success") : t("updates.failure")}
          </Badge>
        ) : null}

        {result && (
          <p className="panel__note" style={{ marginTop: 8 }}>
            {result.success
              ? t("updates.result.success", {
                  path: result.engine.databasePath ?? "—",
                })
              : result.offline
                ? t("updates.result.offline")
                : t("updates.result.failure", {
                    detail: String(result.exitCode ?? "—"),
                  })}
            {result.offline ? ` — ${t("updates.offline")}` : ""}
            {result.databaseVerified ? ` — ${t("updates.verified")}` : ""}
            {result.staleTempRemoved > 0
              ? ` — ${t("updates.recovered", { count: result.staleTempRemoved })}`
              : ""}
          </p>
        )}

        {(() => {
          const stored =
            logSource === "app" ? (logs?.appLines ?? []) : (logs?.freshclamLines ?? []);
          const combined = stored.length > 0 ? stored : log;
          return combined.length === 0 ? (
            <p className="panel__note">{t("updates.noLog")}</p>
          ) : (
            <pre className="log-view">{combined.join("\n")}</pre>
          );
        })()}

        <p className="panel__note" style={{ marginTop: 10 }}>
          <ShieldCheck size={13} style={{ verticalAlign: "-2px", marginRight: 6 }} />
          database.clamav.net · {t("common.localOnly")} ·{" "}
          {logSource === "app"
            ? logs?.appLogPath ?? "—"
            : logs?.freshclamLogPath ?? "—"}
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
